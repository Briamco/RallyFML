import { isNull, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const gameStatus = pgEnum("game_status", ["setup", "live", "completed"]);
export const activityType = pgEnum("activity_type", [
  "trivia",
  "charades",
  "creativity",
  "dramatization",
  "external",
]);
export const participationStatus = pgEnum("participation_status", [
  "active",
  "completed",
]);

export const admins = pgTable("admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  singleton: boolean("singleton").notNull().default(true).unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    status: gameStatus("status").notNull().default("setup"),
    activityDurationSeconds: integer("activity_duration_seconds")
      .notNull()
      .default(120),
    cooldownSeconds: integer("cooldown_seconds").notNull().default(60),
    podiumRevealed: boolean("podium_revealed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "game_activity_duration_range",
      sql`${table.activityDurationSeconds} between 10 and 3600`,
    ),
    check(
      "game_cooldown_range",
      sql`${table.cooldownSeconds} between 0 and 3600`,
    ),
    uniqueIndex("one_live_game_idx")
      .on(table.status)
      .where(sql`${table.status} = 'live'`),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("teams_game_name_idx")
      .on(table.gameId, table.name)
      .where(isNull(table.archivedAt)),
    index("teams_game_idx").on(table.gameId),
  ],
);

export const stations = pgTable(
  "stations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    type: activityType("type").notNull(),
    keyHash: text("key_hash").notNull(),
    sortOrder: integer("sort_order").notNull(),
    selectedTeamId: uuid("selected_team_id"),
    moderatorSessionId: text("moderator_session_id"),
    cooldownEndsAt: timestamp("cooldown_ends_at", { withTimezone: true }),
    alarmPending: boolean("alarm_pending").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("stations_key_hash_idx")
      .on(table.keyHash)
      .where(isNull(table.archivedAt)),
    index("stations_game_idx").on(table.gameId),
  ],
);

export const prompts = pgTable(
  "prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    options: jsonb("options").$type<string[]>(),
    correctChoiceIndex: integer("correct_choice_index"),
    sortOrder: integer("sort_order").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("prompts_station_order_idx")
      .on(table.stationId, table.sortOrder)
      .where(isNull(table.archivedAt)),
  ],
);

export const participations = pgTable(
  "participations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    status: participationStatus("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    finalScore: integer("final_score").notNull().default(0),
    promptOrder: jsonb("prompt_order").$type<string[]>().notNull().default([]),
    scoreSubmittedAt: timestamp("score_submitted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("participation_once_per_pair_idx").on(
      table.gameId,
      table.teamId,
      table.stationId,
    ),
    uniqueIndex("one_active_participation_per_team_idx")
      .on(table.teamId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex("one_active_participation_per_station_idx")
      .on(table.stationId)
      .where(sql`${table.status} = 'active'`),
    check("participation_score_nonnegative", sql`${table.finalScore} >= 0`),
    index("participation_game_idx").on(table.gameId),
  ],
);

export const answers = pgTable(
  "answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participationId: uuid("participation_id")
      .notNull()
      .references(() => participations.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    correct: boolean("correct").notNull(),
    choiceIndex: integer("choice_index"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("answer_once_per_prompt_idx").on(
      table.participationId,
      table.promptId,
    ),
  ],
);
