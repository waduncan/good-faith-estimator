DROP INDEX "goodFaithDb"."bundle_item_mapping_code_unique";--> statement-breakpoint
DROP INDEX "goodFaithDb"."cpt_charge_import_identity_unique";--> statement-breakpoint
ALTER TABLE "goodFaithDb"."location_appointment_bundle_items" ADD COLUMN "cdm_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "goodFaithDb"."location_appointment_bundle_items" ADD COLUMN "setting" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "goodFaithDb"."location_cpt_charges" ADD COLUMN "cdm_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bundle_item_mapping_code_unique" ON "goodFaithDb"."location_appointment_bundle_items" USING btree ("mapping_id","cpt_code","modifiers","setting","cdm_code");--> statement-breakpoint
CREATE UNIQUE INDEX "cpt_charge_import_identity_unique" ON "goodFaithDb"."location_cpt_charges" USING btree ("import_id","cpt_code","modifiers","setting","cdm_code");