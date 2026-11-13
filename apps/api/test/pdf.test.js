import assert from 'node:assert/strict';
import test from 'node:test';
import { createEstimatePdf } from '../src/services/pdf.js';

test('generates a nonempty PDF estimate entirely in memory', async () => {
  const pdf = await createEstimatePdf({
    reference: 'GFE-TEST-1234', estimateDate: '2026-11-12', serviceDate: '2026-12-01',
    patient: { name: 'Test Patient', dateOfBirth: '1980-01-01', address: '1 Test St', phone: '555-0100', email: '' },
    representative: {},
    organization: { name: 'Test Hospital', npi: '1234567890', tin: '12-3456789', phone: '555-0101', email: 'billing@example.test' },
    location: { name: 'Test Location', addressLine1: '2 Care Way', city: 'Huntsville', state: 'AL', postalCode: '35801' },
    appointmentType: 'CT Neck', primaryService: 'CT Neck without contrast', diagnoses: [],
    services: [{ cptCode: '70490', description: 'CT Neck without contrast', modifiers: '', grossCharge: 2119.50 }],
    separateServices: '', notes: '', total: 2119.50,
  });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 3000);
});
