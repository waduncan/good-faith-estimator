CREATE SCHEMA IF NOT EXISTS "goodFaithDb";
--> statement-breakpoint
ALTER TABLE "public"."appointment_types" SET SCHEMA "goodFaithDb";
--> statement-breakpoint
ALTER TABLE "public"."cdm_imports" SET SCHEMA "goodFaithDb";
--> statement-breakpoint
ALTER TABLE "public"."location_appointment_bundle_items" SET SCHEMA "goodFaithDb";
--> statement-breakpoint
ALTER TABLE "public"."location_appointment_mappings" SET SCHEMA "goodFaithDb";
--> statement-breakpoint
ALTER TABLE "public"."location_cpt_charges" SET SCHEMA "goodFaithDb";
--> statement-breakpoint
ALTER TABLE "public"."locations" SET SCHEMA "goodFaithDb";
--> statement-breakpoint
ALTER TABLE "public"."organizations" SET SCHEMA "goodFaithDb";
