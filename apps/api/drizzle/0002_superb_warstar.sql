ALTER TABLE "stations" DROP CONSTRAINT "stations_key_hash_unique";--> statement-breakpoint
DROP INDEX "prompts_station_order_idx";--> statement-breakpoint
DROP INDEX "teams_game_name_idx";--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "stations_key_hash_idx" ON "stations" USING btree ("key_hash") WHERE "stations"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_station_order_idx" ON "prompts" USING btree ("station_id","sort_order") WHERE "prompts"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_game_name_idx" ON "teams" USING btree ("game_id","name") WHERE "teams"."archived_at" is null;