const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function printable(value) {
  return String(value ?? '').replaceAll('—', '-').replaceAll('·', '-').replaceAll(/[^ -~]/g, '?');
}

function escapePdf(value) {
  return printable(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function wrap(value, max = 88) {
  const words = printable(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= max) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['Not provided'];
}

function fullAddress(entity) {
  return [entity.addressLine1, entity.addressLine2, `${entity.city}, ${entity.state} ${entity.postalCode}`].filter(Boolean).join(', ');
}

function estimateLines(estimate) {
  const lines = [];
  const add = (text, style = 'normal', gap = 0) => lines.push({ text, style, gap });
  const paragraph = (text) => wrap(text, 92).forEach((line, index) => add(line, 'normal', index === 0 ? 2 : 0));
  const section = (title) => { add('', 'normal', 5); add(title, 'heading', 2); };
  const field = (label, value) => wrap(`${label}: ${String(value ?? '').trim() || 'Not provided'}`, 92).forEach((line) => add(line));

  add('GOOD FAITH ESTIMATE', 'title', 3);
  add('For uninsured or self-pay individuals', 'subtitle', 5);
  field('Estimate reference', estimate.reference); field('Estimate date', estimate.estimateDate); field('Expected service date', estimate.serviceDate);
  section('PATIENT INFORMATION');
  field('Patient', estimate.patient.name); field('Date of birth', estimate.patient.dateOfBirth); field('Address', estimate.patient.address); field('Phone', estimate.patient.phone); field('Email', estimate.patient.email);
  if (estimate.representative?.name) { field('Authorized representative', estimate.representative.name); field('Representative contact', estimate.representative.contact); }
  section('CONVENING PROVIDER OR FACILITY');
  field('Organization', estimate.organization.name); field('Service location', estimate.location.name); field('Location address', fullAddress(estimate.location));
  field('NPI', estimate.location.npi || estimate.organization.npi); field('TIN', estimate.organization.tin); field('Contact', `${estimate.location.phone || estimate.organization.phone}${estimate.organization.email ? ` / ${estimate.organization.email}` : ''}`);
  section('SCHEDULED CARE');
  field('Appointment type', estimate.appointmentType); field('Primary service', estimate.primaryService);
  field('Diagnosis', estimate.diagnoses.length ? estimate.diagnoses.map((item) => `${item.code}${item.description ? ` - ${item.description}` : ''}`).join('; ') : 'Not known or not required for this estimate');
  section('EXPECTED ITEMS AND SERVICES');
  add('CPT     DESCRIPTION                                                   MODIFIERS      CHARGE', 'tableHeader', 2);
  for (const service of estimate.services) {
    const description = wrap(service.description, 48);
    add(`${service.cptCode.padEnd(8)}${description[0].padEnd(60)}${(service.modifiers || '-').padEnd(15)}${dollars.format(service.grossCharge)}`, 'table');
    for (const continuation of description.slice(1)) add(`${''.padEnd(8)}${continuation}`, 'table');
  }
  add(`TOTAL EXPECTED CHARGES: ${dollars.format(estimate.total)}`, 'total', 5);
  section('ITEMS OR SERVICES REQUIRING SEPARATE SCHEDULING');
  paragraph(estimate.separateServices || 'None identified based on the information known when this estimate was prepared.');
  section('IMPORTANT INFORMATION');
  [
    'This Good Faith Estimate shows the costs of items and services that are reasonably expected for your health care needs for the item or service listed. The estimate is based on information known when it was created.',
    'This estimate does not include unknown or unexpected costs that may arise during treatment. You could be charged more if complications or special circumstances occur.',
    'If the billed charges from this provider or facility are at least $400 more than this Good Faith Estimate, you may have the right to dispute the bill through the federal patient-provider dispute resolution process. Keep a copy of this estimate.',
    'This estimate is not a contract and does not require you to obtain the listed items or services from this provider or facility.',
    'For questions or more information about your rights, visit cms.gov/nosurprises or call 1-800-985-3059.',
  ].forEach((notice) => paragraph(`- ${notice}`));
  if (estimate.notes) { section('ADDITIONAL NOTES'); paragraph(estimate.notes); }
  return lines;
}

function paginate(lines) {
  const pages = [[]];
  let y = 742;
  const metrics = { title: [19, 25], subtitle: [10, 15], heading: [12, 18], tableHeader: [8, 13], table: [8, 11], total: [11, 17], normal: [9, 13] };
  for (const line of lines) {
    const [size, height] = metrics[line.style] ?? metrics.normal;
    y -= line.gap;
    if (y - height < 50) { pages.push([]); y = 742; }
    pages.at(-1).push({ ...line, size, y });
    y -= height;
  }
  return pages;
}

function contentStream(page, pageNumber, pageCount, reference) {
  const commands = ['0.08 0.17 0.23 rg'];
  for (const line of page) {
    const font = ['title', 'heading', 'tableHeader', 'total'].includes(line.style) ? 'F2' : 'F1';
    commands.push(`BT /${font} ${line.size} Tf 54 ${line.y} Td (${escapePdf(line.text)}) Tj ET`);
    if (line.style === 'heading') commands.push(`0.72 0.79 0.82 RG 54 ${line.y - 4} m 558 ${line.y - 4} l S`);
  }
  commands.push(`0.40 0.48 0.53 rg BT /F1 8 Tf 54 28 Td (${escapePdf(`${reference}  -  Page ${pageNumber} of ${pageCount}`)}) Tj ET`);
  return commands.join('\n');
}

export async function createEstimatePdf(estimate) {
  const pages = paginate(estimateLines(estimate));
  const objects = new Map();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.set(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageIds = [];
  pages.forEach((page, index) => {
    const pageId = 5 + index * 2;
    const contentId = pageId + 1;
    pageIds.push(`${pageId} 0 R`);
    const stream = contentStream(page, index + 1, pages.length, estimate.reference);
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.set(contentId, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  objects.set(2, `<< /Type /Pages /Kids [${pageIds.join(' ')}] /Count ${pages.length} >>`);

  const maxId = Math.max(...objects.keys());
  let output = '%PDF-1.4\n%GFE\n';
  const offsets = [0];
  for (let id = 1; id <= maxId; id += 1) {
    offsets[id] = Buffer.byteLength(output);
    output += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output, 'binary');
}
