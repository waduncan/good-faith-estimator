CREATE TABLE "appointment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cdm_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"checksum" text NOT NULL,
	"row_count" integer NOT NULL,
	"service_count" integer NOT NULL,
	"skipped_count" integer NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_appointment_bundle_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mapping_id" uuid NOT NULL,
	"cpt_code" text NOT NULL,
	"modifiers" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_appointment_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"appointment_type_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_cpt_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"cpt_code" text NOT NULL,
	"description" text NOT NULL,
	"modifiers" text DEFAULT '' NOT NULL,
	"setting" text NOT NULL,
	"gross_charge" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"npi" text,
	"phone" text,
	"address_line_1" text NOT NULL,
	"address_line_2" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"active_import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"npi" text NOT NULL,
	"tin" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"address_line_1" text NOT NULL,
	"address_line_2" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cdm_imports" ADD CONSTRAINT "cdm_imports_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_appointment_bundle_items" ADD CONSTRAINT "location_appointment_bundle_items_mapping_id_location_appointment_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."location_appointment_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_appointment_mappings" ADD CONSTRAINT "location_appointment_mappings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_appointment_mappings" ADD CONSTRAINT "location_appointment_mappings_appointment_type_id_appointment_types_id_fk" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_cpt_charges" ADD CONSTRAINT "location_cpt_charges_import_id_cdm_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."cdm_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_cpt_charges" ADD CONSTRAINT "location_cpt_charges_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_types_name_unique" ON "appointment_types" USING btree ("name");--> statement-breakpoint
CREATE INDEX "cdm_imports_location_idx" ON "cdm_imports" USING btree ("location_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bundle_item_mapping_code_unique" ON "location_appointment_bundle_items" USING btree ("mapping_id","cpt_code","modifiers");--> statement-breakpoint
CREATE UNIQUE INDEX "bundle_item_mapping_position_unique" ON "location_appointment_bundle_items" USING btree ("mapping_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "location_appointment_mapping_unique" ON "location_appointment_mappings" USING btree ("location_id","appointment_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cpt_charge_import_identity_unique" ON "location_cpt_charges" USING btree ("import_id","cpt_code","modifiers","setting");--> statement-breakpoint
CREATE INDEX "cpt_charge_location_search_idx" ON "location_cpt_charges" USING btree ("location_id","cpt_code");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_code_unique" ON "locations" USING btree ("code");