import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const estimatorSchema = pgSchema('goodFaithDb');

export const organizations = estimatorSchema.table('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  npi: text('npi').notNull(),
  tin: text('tin').notNull(),
  phone: text('phone').notNull(),
  email: text('email'),
  addressLine1: text('address_line_1').notNull(),
  addressLine2: text('address_line_2'),
  city: text('city').notNull(),
  state: text('state').notNull(),
  postalCode: text('postal_code').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const locations = estimatorSchema.table('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  code: text('code').notNull(),
  npi: text('npi'),
  phone: text('phone'),
  addressLine1: text('address_line_1').notNull(),
  addressLine2: text('address_line_2'),
  city: text('city').notNull(),
  state: text('state').notNull(),
  postalCode: text('postal_code').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  activeImportId: uuid('active_import_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('locations_code_unique').on(table.code)]);

export const cdmImports = estimatorSchema.table('cdm_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  locationId: uuid('location_id').notNull().references(() => locations.id),
  fileName: text('file_name').notNull(),
  checksum: text('checksum').notNull(),
  rowCount: integer('row_count').notNull(),
  serviceCount: integer('service_count').notNull(),
  skippedCount: integer('skipped_count').notNull(),
  summary: jsonb('summary').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('cdm_imports_location_idx').on(table.locationId, table.createdAt)]);

export const locationCptCharges = estimatorSchema.table('location_cpt_charges', {
  id: uuid('id').primaryKey().defaultRandom(),
  importId: uuid('import_id').notNull().references(() => cdmImports.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id').notNull().references(() => locations.id),
  cptCode: text('cpt_code').notNull(),
  description: text('description').notNull(),
  modifiers: text('modifiers').notNull().default(''),
  setting: text('setting').notNull(),
  cdmCode: text('cdm_code').notNull().default(''),
  grossCharge: numeric('gross_charge', { precision: 14, scale: 2 }).notNull(),
}, (table) => [
  uniqueIndex('cpt_charge_import_identity_unique').on(table.importId, table.cptCode, table.modifiers, table.setting, table.cdmCode),
  index('cpt_charge_location_search_idx').on(table.locationId, table.cptCode),
]);

export const appointmentTypes = estimatorSchema.table('appointment_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('appointment_types_name_unique').on(table.name)]);

export const locationAppointmentMappings = estimatorSchema.table('location_appointment_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  locationId: uuid('location_id').notNull().references(() => locations.id),
  appointmentTypeId: uuid('appointment_type_id').notNull().references(() => appointmentTypes.id),
  isActive: boolean('is_active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('location_appointment_mapping_unique').on(table.locationId, table.appointmentTypeId),
]);

export const locationAppointmentBundleItems = estimatorSchema.table('location_appointment_bundle_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  mappingId: uuid('mapping_id').notNull().references(() => locationAppointmentMappings.id, { onDelete: 'cascade' }),
  cptCode: text('cpt_code').notNull(),
  modifiers: text('modifiers').notNull().default(''),
  position: integer('position').notNull(),
  cdmCode: text('cdm_code').notNull().default(''),
  setting: text('setting').notNull().default(''),
}, (table) => [
  uniqueIndex('bundle_item_mapping_code_unique').on(table.mappingId, table.cptCode, table.modifiers, table.setting, table.cdmCode),
  uniqueIndex('bundle_item_mapping_position_unique').on(table.mappingId, table.position),
]);
