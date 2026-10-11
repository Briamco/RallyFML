CREATE TYPE "public"."activity_type" AS ENUM('trivia', 'charades', 'creativity', 'dramatization', 'external');--> statement-breakpoint
CREATE TYPE "public"."game_status" AS ENUM('setup', 'live', 'completed');--> statement-breakpoint
CREATE TYPE "public"."participation_status" AS ENUM('active', 'completed');--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_username_unique" UNIQUE("username"),
	CONSTRAINT "admins_singleton_unique" UNIQUE("singleton")
);
--> statement-breakpoint
CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participation_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"correct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "game_status" DEFAULT 'setup' NOT NULL,
	"podium_revealed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "participations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"status" "participation_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"final_score" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "participation_score_nonnegative" CHECK ("participations"."final_score" >= 0)
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"content" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" "activity_type" NOT NULL,
	"duration_seconds" integer NOT NULL,
	"key_hash" text NOT NULL,
	"sort_order" integer NOT NULL,
	"selected_team_id" uuid,
	"moderator_session_id" text,
	"cooldown_ends_at" timestamp with time zone,
	"alarm_pending" boolean DEFAULT false NOT NULL,
	CONSTRAINT "stations_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "station_duration_range" CHECK ("stations"."duration_seconds" between 10 and 3600)
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_participation_id_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "public"."participations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "participations_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "participations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "participations_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_once_per_prompt_idx" ON "answers" USING btree ("participation_id","prompt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_live_game_idx" ON "games" USING btree ("status") WHERE "games"."status" = 'live';--> statement-breakpoint
CREATE UNIQUE INDEX "participation_once_per_pair_idx" ON "participations" USING btree ("game_id","team_id","station_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_participation_per_team_idx" ON "participations" USING btree ("team_id") WHERE "participations"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_participation_per_station_idx" ON "participations" USING btree ("station_id") WHERE "participations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "participation_game_idx" ON "participations" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_station_order_idx" ON "prompts" USING btree ("station_id","sort_order");--> statement-breakpoint
CREATE INDEX "stations_game_idx" ON "stations" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_game_name_idx" ON "teams" USING btree ("game_id","name");--> statement-breakpoint
CREATE INDEX "teams_game_idx" ON "teams" USING btree ("game_id");