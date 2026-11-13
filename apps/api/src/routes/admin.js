import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  appointmentTypes,
  cdmImports,
  locationAppointmentBundleItems,
  locationAppointmentMappings,
  locationCptCharges,
  locations,
  organizations,
} from '../db/schema.js';
import { chargeKey, createChargeResolver, parseCdmCsv } from '../services/cdm.js';
import { activeCharges, bundleImpact, publishCdmImport } from '../services/cdm-import.js';

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => !clean(body?.[field]));
  return missing.length ? `Required fields: ${missing.join(', ')}.` : null;
}

async function readCsvUpload(request, reply) {
  const buffer = request.body;
  const fileName = clean(request.headers['x-file-name'], 255);
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    reply.code(400).send({ error: 'Attach a CSV file.' });
    return null;
  }
  if (!fileName.toLowerCase().endsWith('.csv')) {
    reply.code(400).send({ error: 'The upload must be a .csv file.' });
    return null;
  }
  const parsed = await parseCdmCsv(buffer);
  if (parsed.errors.length) {
    reply.code(400).send({ error: 'CDM validation failed.', errors: parsed.errors });
    return null;
  }
  return { ...parsed, fileName };
}

export async function registerAdminRoutes(app, database, auth) {
  const attempts = new Map();
  app.post('/api/admin/login', {
    config: { logLevel: 'silent' },
  }, async (request, reply) => {
    const now = Date.now();
    const recent = (attempts.get(request.ip) ?? []).filter((time) => now - time < 60_000);
    if (recent.length >= 5) return reply.code(429).send({ error: 'Too many sign-in attempts. Try again in one minute.' });
    const session = auth.login(request.body?.secret);
    if (!session) { recent.push(now); attempts.set(request.ip, recent); return reply.code(401).send({ error: 'Invalid administrator secret.' }); }
    attempts.delete(request.ip);
    reply.header('Set-Cookie', auth.cookieHeader(session.token));
    return { csrfToken: session.csrf, expiresAt: new Date(session.expiresAt).toISOString() };
  });

  app.get('/api/admin/session', { preHandler: auth.requireAdmin }, async (request) => ({
    csrfToken: request.adminSession.csrf,
    expiresAt: new Date(request.adminSession.expiresAt).toISOString(),
  }));

  app.post('/api/admin/logout', { preHandler: auth.requireAdmin }, async (request, reply) => {
    auth.logout(auth.tokenFromRequest(request));
    reply.header('Set-Cookie', auth.cookieHeader('', true));
    return { ok: true };
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/admin/') || ['/api/admin/login'].includes(request.url)) return;
    if (request.routeOptions.url === '/api/admin/session' || request.routeOptions.url === '/api/admin/logout') return;
    return auth.requireAdmin(request, reply);
  });

  app.get('/api/admin/organization', async () => {
    const [organization] = await database.db.select().from(organizations).limit(1);
    return organization ?? null;
  });

  app.put('/api/admin/organization', async (request, reply) => {
    const required = requireFields(request.body, ['name', 'npi', 'tin', 'phone', 'addressLine1', 'city', 'state', 'postalCode']);
    if (required) return reply.code(400).send({ error: required });
    const values = {
      name: clean(request.body.name, 200), npi: clean(request.body.npi, 20), tin: clean(request.body.tin, 20),
      phone: clean(request.body.phone, 50), email: clean(request.body.email, 200) || null,
      addressLine1: clean(request.body.addressLine1, 200), addressLine2: clean(request.body.addressLine2, 200) || null,
      city: clean(request.body.city, 100), state: clean(request.body.state, 2).toUpperCase(),
      postalCode: clean(request.body.postalCode, 20), updatedAt: new Date(),
    };
    const [existing] = await database.db.select({ id: organizations.id }).from(organizations).limit(1);
    const [saved] = existing
      ? await database.db.update(organizations).set(values).where(eq(organizations.id, existing.id)).returning()
      : await database.db.insert(organizations).values(values).returning();
    return saved;
  });

  app.get('/api/admin/locations', async () => database.db.select().from(locations).orderBy(asc(locations.name)));

  app.post('/api/admin/locations', async (request, reply) => {
    const required = requireFields(request.body, ['name', 'code', 'addressLine1', 'city', 'state', 'postalCode']);
    if (required) return reply.code(400).send({ error: required });
    const [organization] = await database.db.select({ id: organizations.id }).from(organizations).limit(1);
    if (!organization) return reply.code(409).send({ error: 'Configure the organization first.' });
    const [saved] = await database.db.insert(locations).values({
      organizationId: organization.id,
      name: clean(request.body.name, 200), code: clean(request.body.code, 30).toUpperCase(),
      npi: clean(request.body.npi, 20) || null, phone: clean(request.body.phone, 50) || null,
      addressLine1: clean(request.body.addressLine1, 200), addressLine2: clean(request.body.addressLine2, 200) || null,
      city: clean(request.body.city, 100), state: clean(request.body.state, 2).toUpperCase(),
      postalCode: clean(request.body.postalCode, 20), isActive: request.body.isActive !== false,
    }).returning();
    return reply.code(201).send(saved);
  });

  app.patch('/api/admin/locations/:id', async (request, reply) => {
    const allowed = ['name', 'code', 'npi', 'phone', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'isActive'];
    const values = Object.fromEntries(allowed.filter((key) => key in (request.body ?? {})).map((key) => [
      key,
      key === 'isActive' ? Boolean(request.body[key]) : clean(request.body[key], 200) || null,
    ]));
    values.updatedAt = new Date();
    const [saved] = await database.db.update(locations).set(values).where(eq(locations.id, request.params.id)).returning();
    if (!saved) return reply.code(404).send({ error: 'Location not found.' });
    return saved;
  });

  app.get('/api/admin/appointment-types', async () => database.db.select().from(appointmentTypes).orderBy(asc(appointmentTypes.name)));

  app.post('/api/admin/appointment-types', async (request, reply) => {
    if (!clean(request.body?.name)) return reply.code(400).send({ error: 'Appointment type name is required.' });
    const [saved] = await database.db.insert(appointmentTypes).values({
      name: clean(request.body.name, 200), description: clean(request.body.description, 500) || null,
    }).returning();
    return reply.code(201).send(saved);
  });

  app.patch('/api/admin/appointment-types/:id', async (request, reply) => {
    const values = { updatedAt: new Date() };
    if ('name' in request.body) values.name = clean(request.body.name, 200);
    if ('description' in request.body) values.description = clean(request.body.description, 500) || null;
    if ('isActive' in request.body) values.isActive = Boolean(request.body.isActive);
    const [saved] = await database.db.update(appointmentTypes).set(values).where(eq(appointmentTypes.id, request.params.id)).returning();
    if (!saved) return reply.code(404).send({ error: 'Appointment type not found.' });
    return saved;
  });

  app.get('/api/admin/locations/:locationId/mappings', async (request) => {
    const mappings = await database.db.select({
      mappingId: locationAppointmentMappings.id,
      appointmentTypeId: appointmentTypes.id,
      appointmentType: appointmentTypes.name,
      isActive: locationAppointmentMappings.isActive,
    }).from(appointmentTypes).leftJoin(locationAppointmentMappings, and(
      eq(locationAppointmentMappings.appointmentTypeId, appointmentTypes.id),
      eq(locationAppointmentMappings.locationId, request.params.locationId),
    )).orderBy(asc(appointmentTypes.name));
    const ids = mappings.map((item) => item.mappingId).filter(Boolean);
    const items = ids.length ? await database.db.select().from(locationAppointmentBundleItems)
      .where(inArray(locationAppointmentBundleItems.mappingId, ids)).orderBy(asc(locationAppointmentBundleItems.position)) : [];
    const available = await activeCharges(database.db, request.params.locationId, items.map((item) => item.cptCode));
    const resolve = createChargeResolver(available);
    return mappings.map((mapping) => {
      const mappingItems = items.filter((item) => item.mappingId === mapping.mappingId);
      return {
        ...mapping,
        items: mappingItems.map((item) => {
          const charge = resolve(item);
          return charge ? { ...item, ...charge } : item;
        }),
        invalidItems: mappingItems.filter((item) => !resolve(item)),
      };
    });
  });

  app.put('/api/admin/locations/:locationId/mappings/:appointmentTypeId', async (request, reply) => {
    const items = Array.isArray(request.body?.items) ? request.body.items.slice(0, 100).map((item) => ({
      cptCode: clean(item.cptCode, 5).toUpperCase(), modifiers: clean(item.modifiers, 50).toUpperCase(),
      cdmCode: String(item.cdmCode ?? '').trim().toUpperCase(),
      setting: clean(item.setting, 20).toLowerCase(),
    })) : [];
    const available = await activeCharges(database.db, request.params.locationId, items.map((item) => item.cptCode));
    const resolve = createChargeResolver(available);
    const resolved = items.map(resolve);
    if (resolved.some((item) => !item)) return reply.code(400).send({ error: 'Select an exact active CDM charge for each unavailable or ambiguous CPT entry.' });
    if (new Set(resolved.map(chargeKey)).size !== resolved.length) return reply.code(400).send({ error: 'A bundle cannot contain duplicate charges.' });
    const selections = resolved.map(({ cptCode, modifiers, setting, cdmCode }) => ({ cptCode, modifiers, setting, cdmCode }));

    const mapping = await database.db.transaction(async (tx) => {
      const [saved] = await tx.insert(locationAppointmentMappings).values({
        locationId: request.params.locationId,
        appointmentTypeId: request.params.appointmentTypeId,
        isActive: request.body.isActive !== false,
      }).onConflictDoUpdate({
        target: [locationAppointmentMappings.locationId, locationAppointmentMappings.appointmentTypeId],
        set: { isActive: request.body.isActive !== false, updatedAt: new Date() },
      }).returning();
      await tx.delete(locationAppointmentBundleItems).where(eq(locationAppointmentBundleItems.mappingId, saved.id));
      if (selections.length) await tx.insert(locationAppointmentBundleItems).values(selections.map((item, position) => ({ ...item, position, mappingId: saved.id })));
      return saved;
    });
    return { ...mapping, items: selections };
  });

  app.post('/api/admin/locations/:locationId/imports/preview', { bodyLimit: 25 * 1024 * 1024 }, async (request, reply) => {
    const parsed = await readCsvUpload(request, reply);
    if (!parsed) return;
    const affectedBundles = await bundleImpact(database.db, request.params.locationId, parsed.services);
    return {
      fileName: parsed.fileName, checksum: parsed.checksum, rowCount: parsed.rowCount,
      serviceCount: parsed.services.length, skippedCount: parsed.skippedCount, affectedBundles,
    };
  });

  app.post('/api/admin/locations/:locationId/imports', { bodyLimit: 25 * 1024 * 1024 }, async (request, reply) => {
    const parsed = await readCsvUpload(request, reply);
    if (!parsed) return;
    const [location] = await database.db.select({ id: locations.id }).from(locations).where(eq(locations.id, request.params.locationId)).limit(1);
    if (!location) return reply.code(404).send({ error: 'Location not found.' });
    const savedImport = await publishCdmImport(database.db, location.id, parsed);
    return reply.code(201).send(savedImport);
  });

  app.get('/api/admin/locations/:locationId/imports', async (request) => database.db.select({
    id: cdmImports.id, fileName: cdmImports.fileName, rowCount: cdmImports.rowCount,
    serviceCount: cdmImports.serviceCount, skippedCount: cdmImports.skippedCount,
    summary: cdmImports.summary, createdAt: cdmImports.createdAt,
    isActive: sql`${cdmImports.id} = ${locations.activeImportId}`.mapWith(Boolean),
  }).from(cdmImports).innerJoin(locations, eq(locations.id, cdmImports.locationId))
    .where(eq(cdmImports.locationId, request.params.locationId)).orderBy(desc(cdmImports.createdAt)));

  app.post('/api/admin/locations/:locationId/imports/:importId/rollback', async (request, reply) => {
    const [target] = await database.db.select({ id: cdmImports.id }).from(cdmImports).where(and(
      eq(cdmImports.id, request.params.importId), eq(cdmImports.locationId, request.params.locationId),
    )).limit(1);
    if (!target) return reply.code(404).send({ error: 'Import version not found.' });
    await database.db.update(locations).set({ activeImportId: target.id, updatedAt: new Date() })
      .where(eq(locations.id, request.params.locationId));
    return { ok: true, activeImportId: target.id };
  });
}
