import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createChargeResolver } from '../src/services/cdm.js';
import test from 'node:test';
import { parseCdmCsv } from '../src/services/cdm.js';

const header = 'description,code|1,code|1|type,code|2,code|2|type,modifiers,setting,standard_charge|gross,payer_name';

test('streams a CMS CSV across UTF-8, quote and CRLF boundaries', async () => {
  const csv = Buffer.from([
    '\uFEFFhospital_name,version',
    'Test Hospital,1.0',
    header,
    '"Café, ""test""\nvisit",70490,CPT,,,,both,10.00,AETNA',
  ].join('\r\n'));
  async function* chunks() {
    for (let index = 0; index < csv.length; index += 1) yield csv.subarray(index, index + 1);
  }
  const result = await parseCdmCsv(chunks());
  assert.deepEqual(result.errors, []);
  assert.equal(result.services[0].description, 'Café, "test"\nvisit');
  assert.equal(result.checksum, createHash('sha256').update(csv).digest('hex'));
});

test('normalizes CPT rows, filters inpatient rows, and collapses payer duplicates', async () => {
  const csv = [
    header,
    'CT NECK,70490,CPT,351,RC,,both,2119.50,AETNA',
    'CT NECK,70490,CPT,351,RC,,both,2119.50,BCBS',
    'INPATIENT TEST,12345,CPT,,,26,inpatient,99.00,AETNA',
    'NO CPT,ABC,CDM,351,RC,,outpatient,10.00,AETNA',
  ].join('\n');
  const result = await parseCdmCsv(Buffer.from(csv));
  assert.deepEqual(result.errors, []);
  assert.equal(result.rowCount, 4);
  assert.equal(result.skippedCount, 2);
  assert.deepEqual(result.services, [{
    cptCode: '70490', description: 'CT NECK', modifiers: '', setting: 'both', cdmCode: '', grossCharge: '2119.50',
  }]);
});

test('finds CPT in any paired code column', async () => {
  const csv = [header, 'XRAY,internal,CDM,71045,CPT,,outpatient,125.00,AETNA'].join('\n');
  const result = await parseCdmCsv(Buffer.from(csv));
  assert.equal(result.services[0].cptCode, '71045');
});

test('keeps distinct CDM items and flags ambiguous legacy bundle entries', async () => {
  const csv = [header,
    'First item,87147,CPT,7612,CDM,59,both,77,AETNA',
    'First item,87147,CPT,7612,CDM,59,both,77,BCBS',
    'Second item,87147,CPT,7627,CDM,59,both,103,AETNA',
    'Unpriced item,87147,CPT,7621,CDM,59,both,,AETNA',
  ].join('\n');
  const result = await parseCdmCsv(Buffer.from(csv));
  assert.deepEqual(result.errors, []);
  assert.equal(result.services.length, 2);
  assert.equal(result.missingGrossCount, 1);
  const resolve = createChargeResolver(result.services);
  const legacy = { cptCode: '87147', modifiers: '59' };
  assert.equal(resolve(legacy), null);
  assert.equal(resolve({ ...legacy, setting: 'both', cdmCode: '7627' }).grossCharge, '103.00');
});

test('rejects conflicting charges for the same CPT identity', async () => {
  const csv = [
    header,
    'CT NECK,70490,CPT,,,,both,2119.50,AETNA',
    'CT NECK,70490,CPT,,,,both,2000.00,BCBS',
  ].join('\n');
  const result = await parseCdmCsv(Buffer.from(csv));
  assert.match(result.errors[0], /conflicting/);
});

test('requires a usable outpatient CPT record', async () => {
  const result = await parseCdmCsv(Buffer.from(`${header}\nTEST,12345,CPT,,,,inpatient,10.00,AETNA`));
  assert.match(result.errors[0], /no usable outpatient CPT/i);
});
