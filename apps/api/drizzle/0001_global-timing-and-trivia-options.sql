ALTER TABLE "stations" DROP CONSTRAINT "station_duration_range";--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "choice_index" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "activity_duration_seconds" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "cooldown_seconds" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "participations" ADD COLUMN "prompt_order" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "participations" ADD COLUMN "score_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "options" jsonb;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "correct_choice_index" integer;--> statement-breakpoint
UPDATE "games" AS game SET "activity_duration_seconds" = COALESCE((SELECT station."duration_seconds" FROM "stations" AS station WHERE station."game_id" = game."id" ORDER BY station."sort_order" LIMIT 1), 120);--> statement-breakpoint
UPDATE "participations" AS participation SET "prompt_order" = COALESCE((SELECT jsonb_agg(prompt."id"::text ORDER BY prompt."sort_order") FROM "prompts" AS prompt WHERE prompt."station_id" = participation."station_id"), '[]'::jsonb);--> statement-breakpoint
ALTER TABLE "stations" DROP COLUMN "duration_seconds";--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "game_activity_duration_range" CHECK ("games"."activity_duration_seconds" between 10 and 3600);--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "game_cooldown_range" CHECK ("games"."cooldown_seconds" between 0 and 3600);
