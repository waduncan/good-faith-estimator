import { randomUUID } from 'node:crypto';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import {
  appointmentTypes,
  locationAppointmentBundleItems,
  locationAppointmentMappings,
  locationCptCharges,
  locations,
  organizations,
} from '../db/schema.js';
import { createEstimatePdf } from '../services/pdf.js';
import { createChargeResolver } from '../services/cdm.js';
import { activeCharges } from '../services/cdm-import.js';

function databaseRequired(database, reply) {
  if (database) return true;
  reply.code(503).send({ error: 'Database is unavailable.' });
  return false;
}

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function validateEstimate(body) {
  const errors = [];
  if (body?.selfPayConfirmed !== true) errors.push('Confirm that the patient is uninsured or self-pay.');
  if (!text(body?.locationId)) errors.push('Select a service location.');
  if (!text(body?.appointmentTypeId)) errors.push('Select an appointment type.');
  if (!text(body?.patient?.name)) errors.push('Patient name is required.');
  if (!validDate(text(body?.patient?.dateOfBirth))) errors.push('A valid patient date of birth is required.');
  if (!validDate(text(body?.serviceDate))) errors.push('A valid expected service date is required.');
  if (!Array.isArray(body?.serviceIds) || body.serviceIds.length === 0) errors.push('Add at least one CPT service.');
  if (body?.serviceIds?.length > 100) errors.push('An estimate cannot contain more than 100 services.');
  return errors;
}

export async function registerPublicRoutes(app, database) {
  app.get('/api/config', async (request, reply) => {
    if (!databaseRequired(database, reply)) return;
    const [organization] = await database.db.select({
      name: organizations.name,
      phone: organizations.phone,
      email: organizations.email,
    }).from(organizations).limit(1);
    return { organization: organization ?? null };
  });

  app.get('/api/locations', async (request, reply) => {
    if (!databaseRequired(database, reply)) return;
    return database.db.select({
      id: locations.id,
      name: locations.name,
      code: locations.code,
      hasCdm: sql`${locations.activeImportId} is not null`.mapWith(Boolean),
    }).from(locations).where(eq(locations.isActive, true)).orderBy(asc(locations.name));
  });

  app.get('/api/locations/:locationId/appointment-types', async (request, reply) => {
    if (!databaseRequired(database, reply)) return;
    const { locationId } = request.params;
    return database.db.select({
      id: appointmentTypes.id,
      name: appointmentTypes.name,
      description: appointmentTypes.description,
      mappingId: locationAppointmentMappings.id,
    }).from(appointmentTypes)
      .leftJoin(locationAppointmentMappings, and(
        eq(locationAppointmentMappings.appointmentTypeId, appointmentTypes.id),
        eq(locationAppointmentMappings.locationId, locationId),
        eq(locationAppointmentMappings.isActive, true),
      ))
      .where(eq(appointmentTypes.isActive, true))
      .orderBy(asc(appointmentTypes.name));
  });

  app.get('/api/locations/:locationId/appointment-types/:appointmentTypeId/bundle', async (request, reply) => {
    if (!databaseRequired(database, reply)) return;
    const { locationId, appointmentTypeId } = request.params;
    const [mapping] = await database.db.select({ id: locationAppointmentMappings.id })
      .from(locationAppointmentMappings)
      .where(and(
        eq(locationAppointmentMappings.locationId, locationId),
        eq(locationAppointmentMappings.appointmentTypeId, appointmentTypeId),
        eq(locationAppointmentMappings.isActive, true),
      )).limit(1);
    if (!mapping) return reply.code(404).send({ error: 'No standard bundle configured.' });

    const items = await database.db.select().from(locationAppointmentBundleItems)
      .where(eq(locationAppointmentBundleItems.mappingId, mapping.id))
      .orderBy(asc(locationAppointmentBundleItems.position));
    const services = await activeCharges(database.db, locationId, items.map((item) => item.cptCode));
    const resolve = createChargeResolver(services);
    return {
      items: items.map(resolve).filter(Boolean),
      invalidItems: items.filter((item) => !resolve(item)),
    };
  });

  app.get('/api/locations/:locationId/services', async (request, reply) => {
    if (!databaseRequired(database, reply)) return;
    const query = text(request.query.q, 100);
    if (query.length < 2) return [];
    const pattern = `%${query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    return database.db.select({
      id: locationCptCharges.id,
      cptCode: locationCptCharges.cptCode,
      description: locationCptCharges.description,
      modifiers: locationCptCharges.modifiers,
      setting: locationCptCharges.setting,
      cdmCode: locationCptCharges.cdmCode,
      grossCharge: locationCptCharges.grossCharge,
    }).from(locationCptCharges)
      .innerJoin(locations, and(
        eq(locations.id, locationCptCharges.locationId),
        eq(locations.activeImportId, locationCptCharges.importId),
      ))
      .where(and(
        eq(locationCptCharges.locationId, request.params.locationId),
        or(ilike(locationCptCharges.cptCode, pattern), ilike(locationCptCharges.description, pattern), ilike(locationCptCharges.cdmCode, pattern)),
      ))
      .orderBy(asc(locationCptCharges.cptCode))
      .limit(25);
  });

  app.post('/api/estimates/pdf', { config: { logLevel: 'silent' } }, async (request, reply) => {
    if (!databaseRequired(database, reply)) return;
    const errors = validateEstimate(request.body);
    if (errors.length) return reply.code(400).send({ error: errors.join(' ') });

    const body = request.body;
    const uniqueIds = [...new Set(body.serviceIds.map(String))];
    const [context] = await database.db.select({
      organization: organizations,
      location: locations,
    }).from(locations)
      .innerJoin(organizations, eq(organizations.id, locations.organizationId))
      .where(and(eq(locations.id, body.locationId), eq(locations.isActive, true)))
      .limit(1);
    if (!context) return reply.code(400).send({ error: 'The selected location is unavailable.' });
    const [appointment] = await database.db.select({ name: appointmentTypes.name })
      .from(appointmentTypes)
      .where(and(eq(appointmentTypes.id, body.appointmentTypeId), eq(appointmentTypes.isActive, true)))
      .limit(1);
    if (!appointment) return reply.code(400).send({ error: 'The selected appointment type is unavailable.' });

    const services = await database.db.select({
      id: locationCptCharges.id,
      cptCode: locationCptCharges.cptCode,
      description: locationCptCharges.description,
      modifiers: locationCptCharges.modifiers,
      grossCharge: locationCptCharges.grossCharge,
    }).from(locationCptCharges).where(and(
      eq(locationCptCharges.locationId, body.locationId),
      eq(locationCptCharges.importId, context.location.activeImportId),
      inArray(locationCptCharges.id, uniqueIds),
    ));
    if (services.length !== uniqueIds.length) {
      return reply.code(409).send({ error: 'One or more CPT charges changed. Reload the bundle and review the estimate.' });
    }

    const total = services.reduce((sum, service) => sum + Number(service.grossCharge), 0);
    const reference = `GFE-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const estimate = {
      reference,
      estimateDate: new Date().toISOString().slice(0, 10),
      serviceDate: body.serviceDate,
      patient: {
        name: text(body.patient.name, 200),
        dateOfBirth: body.patient.dateOfBirth,
        address: text(body.patient.address, 500),
        phone: text(body.patient.phone, 50),
        email: text(body.patient.email, 200),
      },
      representative: {
        name: text(body.representative?.name, 200),
        contact: text(body.representative?.contact, 250),
      },
      organization: context.organization,
      location: context.location,
      appointmentType: appointment.name,
      primaryService: text(body.primaryService, 500),
      diagnoses: Array.isArray(body.diagnoses) ? body.diagnoses.slice(0, 10).map((item) => ({
        code: text(item.code, 20),
        description: text(item.description, 200),
      })).filter((item) => item.code) : [],
      services: services.map((service) => ({ ...service, grossCharge: Number(service.grossCharge) })),
      separateServices: text(body.separateServices, 2000),
      notes: text(body.notes, 2000),
      total,
    };
    const pdf = await createEstimatePdf(estimate);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${reference}.pdf"`)
      .header('Cache-Control', 'no-store, private')
      .send(pdf);
  });
}
