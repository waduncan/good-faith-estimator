import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

const CPT_PATTERN = /^[0-9A-Z]{5}$/;
const INCLUDED_SETTINGS = new Set(['outpatient', 'both']);

function clean(value) {
  return String(value ?? '').trim();
}

function findCode(record, codePairs, type) {
  for (const pair of codePairs) {
    if (clean(record[pair.type]).toUpperCase() === type) {
      const code = clean(record[pair.code]).toUpperCase();
      if (code && (type !== 'CPT' || CPT_PATTERN.test(code))) return code;
    }
  }
  return null;
}

function parseMoney(value, rowNumber) {
  const normalized = clean(value).replaceAll(',', '').replace(/^\$/, '');
  if (!/^\d+(\.\d{1,4})?$/.test(normalized)) {
    throw new Error(`Row ${rowNumber}: standard_charge|gross must be a nonnegative number.`);
  }
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`Row ${rowNumber}: standard_charge|gross is outside the supported range.`);
  }
  return (cents / 100).toFixed(2);
}


async function* parseCsv(chunks, hash) {
  const decoder = new StringDecoder('utf8');
  let row = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let skipLf = false;
  let atStart = true;

  function* consume(source) {
    if (atStart && source.length) {
      source = source.replace(/^\uFEFF/, '');
      atStart = false;
    }
    for (const character of source) {
      if (skipLf) {
        skipLf = false;
        if (character === '\n') continue;
      }
      if (quoted) {
        if (character === '"') {
          quoted = false;
          afterQuote = true;
        } else field += character;
        continue;
      }
      if (afterQuote && character === '"') {
        field += '"';
        quoted = true;
        afterQuote = false;
        continue;
      }
      if (character === ',') {
        row.push(field);
        field = '';
      } else if (character === '\n' || character === '\r') {
        row.push(field);
        if (row.some(Boolean)) yield row;
        row = [];
        field = '';
        skipLf = character === '\r';
      } else if (afterQuote || (character === '"' && field.length)) {
        throw new Error('CSV contains an invalid quote.');
      } else if (character === '"') quoted = true;
      else field += character;
      afterQuote = false;
    }
  }

  for await (const chunk of chunks) {
    hash.update(chunk);
    yield* consume(decoder.write(chunk));
  }
  yield* consume(decoder.end());
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  row.push(field);
  if (row.some(Boolean)) yield row;
}


export async function parseCdmCsv(input) {
  const services = new Map();
  const errors = [];
  let headers;
  let codePairs;
  let csvRow = 0;
  let skipMetadata = false;
  let rowCount = 0;
  let skippedCount = 0;
  let missingGrossCount = 0;
  const hash = createHash('sha256');

  try {
    for await (const values of parseCsv(Buffer.isBuffer(input) ? [input] : input, hash)) {
      csvRow += 1;
      if (!headers) {
        const columns = values.map(clean);
        if (csvRow === 1 && columns.includes('hospital_name') && !columns.includes('description')) {
          skipMetadata = true;
          continue;
        }
        if (skipMetadata && csvRow === 2) continue;
        headers = columns;
        if (!['description', 'setting', 'standard_charge|gross'].every((header) => headers.includes(header))) {
          throw new Error('CSV must include description, setting and standard_charge|gross columns.');
        }
        codePairs = headers
          .filter((header) => /^code\|\d+$/.test(header))
          .map((code) => ({ code, type: `${code}|type` }))
          .filter(({ type }) => headers.includes(type));
        if (!codePairs.length) throw new Error('CSV must include at least one paired code|n and code|n|type column.');
        continue;
      }
      if (values.length !== headers.length) {
        throw new Error(`Row ${csvRow}: expected ${headers.length} columns but found ${values.length}.`);
      }
      rowCount += 1;
      const record = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
      const cptCode = findCode(record, codePairs, 'CPT');
      const setting = clean(record.setting).toLowerCase();
      if (!cptCode || !INCLUDED_SETTINGS.has(setting)) {
        skippedCount += 1;
        continue;
      }
      if (!clean(record['standard_charge|gross'])) {
        skippedCount += 1;
        missingGrossCount += 1;
        continue;
      }

      try {
        const description = clean(record.description);
        if (!description) throw new Error(`Row ${csvRow}: description is required.`);
        const modifiers = clean(record.modifiers).toUpperCase();
        const grossCharge = parseMoney(record['standard_charge|gross'], csvRow);
        const cdmCode = findCode(record, codePairs, 'CDM') ?? '';
        const service = { cptCode, description, modifiers, setting, cdmCode, grossCharge };
        const identity = chargeKey(service);
        const existing = services.get(identity);

        if (existing && (existing.grossCharge !== grossCharge || existing.description !== description)) {
          throw new Error(
            `Row ${csvRow}: CPT ${cptCode}, CDM ${cdmCode || '(missing)'} has conflicting descriptions or gross charges for the same setting and modifiers.`,
          );
        }
        services.set(identity, service);
      } catch (error) {
        errors.push(error.message);
        if (errors.length >= 25) break;
      }
    }
  } catch (error) {
    if (!errors.includes(error.message)) errors.push(error.message);
  }

  if (rowCount === 0 && errors.length === 0) errors.push('CSV contains no data rows.');
  if (services.size === 0 && errors.length === 0) {
    errors.push('CSV contains no usable outpatient CPT records.');
  }

  return {
    checksum: errors.length ? null : hash.digest('hex'),
    errors,
    rowCount,
    skippedCount,
    missingGrossCount,
    services: [...services.values()],
  };
}

export function chargeKey({ cptCode, modifiers, setting = '', cdmCode = '' }) {
  return JSON.stringify([cptCode, modifiers, setting, cdmCode]);
}

export function createChargeResolver(services) {
  const exact = new Map();
  const legacy = new Map();
  for (const service of services) {
    exact.set(chargeKey(service), service);
    const key = chargeKey({ cptCode: service.cptCode, modifiers: service.modifiers });
    legacy.set(key, legacy.has(key) ? null : service);
  }
  return (item) => (item.setting ? exact : legacy).get(chargeKey(item));
}

export function compareBundleCodes(services, bundleItems) {
  const resolve = createChargeResolver(services);
  return bundleItems.filter((item) => !resolve(item));
}
