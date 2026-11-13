import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../db/client.js';
import { locations } from '../db/schema.js';
import { parseCdmCsv } from '../services/cdm.js';
import { bundleImpact, publishCdmImport } from '../services/cdm-import.js';

const usage = 'npm run cdm:import -- --location HHM --file "C:\\path\\charges.csv" [--publish]';

async function main() {
  const { values } = parseArgs({
    options: {
      location: { type: 'string' },
      file: { type: 'string' },
      publish: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const locationCode = values.location?.trim().toUpperCase();
  if (!locationCode || !values.file) throw new Error(usage);
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in the project’s .env file.');

  const database = createDatabase(process.env.DATABASE_URL, console);
  try {
    const [location] = await database.db.select({ id: locations.id, name: locations.name })
      .from(locations).where(eq(locations.code, locationCode));
    if (!location) throw new Error(`Location ${locationCode} was not found. Add it in Administration first.`);

    console.log(`Reading ${basename(values.file)} for ${location.name} (${locationCode})…`);
    const parsed = await parseCdmCsv(createReadStream(values.file));
    if (parsed.errors.length) throw new Error(parsed.errors.join('\n'));
    parsed.fileName = basename(values.file);

    const published = values.publish ? await publishCdmImport(database.db, location.id, parsed) : null;
    const affectedBundles = published?.affectedBundles ?? await bundleImpact(database.db, location.id, parsed.services);
    console.log(`${parsed.rowCount} rows read, ${parsed.skippedCount} skipped, ${parsed.services.length} unique CPT charges.`);
    if (parsed.missingGrossCount) console.log(`${parsed.missingGrossCount} eligible CPT rows had no gross charge and were skipped.`);
    for (const bundle of affectedBundles) {
      const missing = bundle.missing.map(({ cptCode, modifiers, setting, cdmCode }) =>
        [cptCode, modifiers, setting, cdmCode && `CDM ${cdmCode}`].filter(Boolean).join(' '));
      console.log(`${bundle.appointmentType}: unavailable CPT entries ${missing.join(', ')}`);
    }
    console.log(published
      ? `Published CDM version ${published.id} for ${locationCode}.`
      : 'Preview complete. Add --publish to activate this CDM.');
  } finally {
    await database.close();
  }
}

try {
  await main();
} catch (error) {
  const code = error.cause?.code ?? error.code;
  console.error(error.cause
    ? `Database operation failed${code ? ` (${code})` : ''}. Check DATABASE_URL, migrations, and database permissions.`
    : error.message);
  process.exitCode = 1;
}
