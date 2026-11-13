import { and, eq, inArray } from 'drizzle-orm';
import {
  appointmentTypes, cdmImports, locationAppointmentBundleItems,
  locationAppointmentMappings, locationCptCharges, locations,
} from '../db/schema.js';
import { compareBundleCodes } from './cdm.js';

export async function activeCharges(db, locationId, codes) {
  if (!codes.length) return [];
  return db.select({
    id: locationCptCharges.id,
    cptCode: locationCptCharges.cptCode,
    modifiers: locationCptCharges.modifiers,
    setting: locationCptCharges.setting,
    cdmCode: locationCptCharges.cdmCode,
    description: locationCptCharges.description,
    grossCharge: locationCptCharges.grossCharge,
  }).from(locationCptCharges).innerJoin(locations, and(
    eq(locations.id, locationId),
    eq(locations.activeImportId, locationCptCharges.importId),
  )).where(and(
    eq(locationCptCharges.locationId, locationId),
    inArray(locationCptCharges.cptCode, [...new Set(codes)]),
  ));
}

export async function bundleImpact(db, locationId, services) {
  const rows = await db.select({
    mappingId: locationAppointmentMappings.id,
    appointmentType: appointmentTypes.name,
    cptCode: locationAppointmentBundleItems.cptCode,
    modifiers: locationAppointmentBundleItems.modifiers,
    setting: locationAppointmentBundleItems.setting,
    cdmCode: locationAppointmentBundleItems.cdmCode,
  }).from(locationAppointmentBundleItems)
    .innerJoin(locationAppointmentMappings, eq(locationAppointmentMappings.id, locationAppointmentBundleItems.mappingId))
    .innerJoin(appointmentTypes, eq(appointmentTypes.id, locationAppointmentMappings.appointmentTypeId))
    .where(eq(locationAppointmentMappings.locationId, locationId));
  const missing = compareBundleCodes(services, rows);
  const grouped = new Map();
  for (const item of missing) {
    if (!grouped.has(item.mappingId)) grouped.set(item.mappingId, { mappingId: item.mappingId, appointmentType: item.appointmentType, missing: [] });
    const { cptCode, modifiers, setting, cdmCode } = item;
    grouped.get(item.mappingId).missing.push({ cptCode, modifiers, setting, cdmCode });
  }
  return [...grouped.values()];
}

export async function publishCdmImport(db, locationId, parsed) {
  return db.transaction(async (tx) => {
    const [location] = await tx.select({ id: locations.id }).from(locations)
      .where(eq(locations.id, locationId)).for('update');
    if (!location) throw new Error('Location not found.');
    const affectedBundles = await bundleImpact(tx, locationId, parsed.services);
    const [created] = await tx.insert(cdmImports).values({
      locationId: locationId, fileName: parsed.fileName, checksum: parsed.checksum,
      rowCount: parsed.rowCount, serviceCount: parsed.services.length, skippedCount: parsed.skippedCount,
      summary: { affectedBundles },
    }).returning();
    for (let index = 0; index < parsed.services.length; index += 500) {
      await tx.insert(locationCptCharges).values(parsed.services.slice(index, index + 500).map((service) => ({
        ...service, locationId: locationId, importId: created.id,
      })));
    }
    await tx.update(locations).set({ activeImportId: created.id, updatedAt: new Date() }).where(eq(locations.id, locationId));
    return { ...created, affectedBundles };
  });
}
