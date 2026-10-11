import { and, asc, count, desc, eq, isNull, lte, ne, sql } from "drizzle-orm";
import {
  rankScores,
  type PublicStationState,
  type Scoreboard,
} from "@rally/shared";
import { db } from "./db/index.js";
import {
  answers,
  games,
  participations,
  prompts,
  stations,
  teams,
} from "./db/schema.js";
import { cooldownDeadline } from "./game-rules.js";

export async function getScoreboard(
  gameId: string,
): Promise<Scoreboard | null> {
  const [game] = await db
    .select()
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);
  if (!game) return null;

  const score = sql<number>`coalesce(sum(${participations.finalScore}), 0)::int`;
  const totals = await db
    .select({
      id: teams.id,
      name: teams.name,
      score,
      sortOrder: teams.sortOrder,
    })
    .from(teams)
    .leftJoin(participations, eq(participations.teamId, teams.id))
    .where(and(eq(teams.gameId, gameId), isNull(teams.archivedAt)))
    .groupBy(teams.id)
    .orderBy(desc(score), asc(teams.sortOrder));

  return {
    game: {
      id: game.id,
      name: game.name,
      status: game.status,
      podiumRevealed: game.podiumRevealed,
    },
    teams: rankScores(
      totals.map((row) => ({
        id: row.id,
        name: row.name,
        score: Number(row.score),
      })),
    ),
  };
}

export async function getStationState(
  stationId: string,
): Promise<PublicStationState | null> {
  const [station] = await db
    .select()
    .from(stations)
    .where(and(eq(stations.id, stationId), isNull(stations.archivedAt)))
    .limit(1);
  if (!station) return null;
  const [game] = await db
    .select({
      status: games.status,
      activityDurationSeconds: games.activityDurationSeconds,
    })
    .from(games)
    .where(eq(games.id, station.gameId))
    .limit(1);
  if (!game) return null;

  const [active] = await db
    .select({
      id: participations.id,
      teamId: participations.teamId,
      teamName: teams.name,
      endsAt: participations.endsAt,
      score: participations.finalScore,
      promptOrder: participations.promptOrder,
      scoreSubmittedAt: participations.scoreSubmittedAt,
    })
    .from(participations)
    .innerJoin(teams, eq(teams.id, participations.teamId))
    .where(
      and(
        eq(participations.stationId, stationId),
        eq(participations.status, "active"),
      ),
    )
    .limit(1);

  let nextPrompt: {
    id: string;
    content: string;
    index: number;
    total: number;
  } | null = null;
  if (active) {
    const promptRows = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.stationId, stationId), isNull(prompts.archivedAt)))
      .orderBy(asc(prompts.sortOrder));
    const promptIds = active.promptOrder.length
      ? active.promptOrder
      : promptRows.map((prompt) => prompt.id);
    const promptsById = new Map(
      promptRows.map((prompt) => [prompt.id, prompt]),
    );
    const answered = await db
      .select({ promptId: answers.promptId })
      .from(answers)
      .where(eq(answers.participationId, active.id));
    const answeredIds = new Set(answered.map((row) => row.promptId));
    const nextPromptId =
      station.type === "trivia" || station.type === "charades"
        ? promptIds.find((id) => !answeredIds.has(id))
        : promptIds[0];
    const index = nextPromptId ? promptIds.indexOf(nextPromptId) : -1;
    const prompt = nextPromptId ? promptsById.get(nextPromptId) : undefined;
    if (prompt && index >= 0) {
      nextPrompt = {
        id: prompt.id,
        content: prompt.content,
        index: index + 1,
        total: promptIds.length,
        ...(station.type === "trivia" ? { options: prompt.options ?? [] } : {}),
      };
    }
  }

  const allTeams = await db
    .select()
    .from(teams)
    .where(and(eq(teams.gameId, station.gameId), isNull(teams.archivedAt)))
    .orderBy(asc(teams.sortOrder));
  const stationCompletions = await db
    .select({ teamId: participations.teamId })
    .from(participations)
    .where(
      and(
        eq(participations.stationId, stationId),
        eq(participations.status, "completed"),
      ),
    );
  const activeTeams = await db
    .select({
      teamId: participations.teamId,
      stationId: participations.stationId,
    })
    .from(participations)
    .where(eq(participations.status, "active"));
  const completedIds = new Set(stationCompletions.map((row) => row.teamId));
  const activeElsewhereIds = new Set(
    activeTeams
      .filter((row) => row.stationId !== stationId)
      .map((row) => row.teamId),
  );
  const activeHereId = active?.teamId;

  return {
    id: station.id,
    gameId: station.gameId,
    title: station.title,
    description: station.description,
    gameStatus: game.status,
    type: station.type,
    durationSeconds: game.activityDurationSeconds,
    selectedTeamId: station.selectedTeamId,
    cooldownEndsAt: station.cooldownEndsAt?.toISOString() ?? null,
    alarmPending: station.alarmPending,
    activeParticipation: active
      ? {
          id: active.id,
          teamId: active.teamId,
          teamName: active.teamName,
          endsAt: active.endsAt.toISOString(),
          score: active.score,
          scoreSubmitted: Boolean(active.scoreSubmittedAt),
          nextPrompt,
        }
      : null,
    teams: allTeams.map((team) => {
      const completed = completedIds.has(team.id);
      const activeElsewhere = activeElsewhereIds.has(team.id);
      const activeHere = activeHereId === team.id;
      return {
        id: team.id,
        name: team.name,
        completed,
        activeElsewhere,
        available: !completed && !activeElsewhere && !activeHere,
      };
    }),
  };
}

export async function completeGameIfDone(gameId: string): Promise<boolean> {
  const [game] = await db
    .select()
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.status, "live")))
    .limit(1);
  if (!game) return false;

  const [[teamCount], [stationCount], [completedCount]] = await Promise.all([
    db
      .select({ value: count() })
      .from(teams)
      .where(and(eq(teams.gameId, gameId), isNull(teams.archivedAt))),
    db
      .select({ value: count() })
      .from(stations)
      .where(and(eq(stations.gameId, gameId), isNull(stations.archivedAt))),
    db
      .select({ value: count() })
      .from(participations)
      .innerJoin(teams, eq(teams.id, participations.teamId))
      .innerJoin(stations, eq(stations.id, participations.stationId))
      .where(
        and(
          eq(participations.gameId, gameId),
          eq(participations.status, "completed"),
          isNull(teams.archivedAt),
          isNull(stations.archivedAt),
        ),
      ),
  ]);
  const expected = Number(teamCount.value) * Number(stationCount.value);
  if (expected === 0 || Number(completedCount.value) !== expected) return false;

  await db
    .update(games)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(games.id, gameId));
  return true;
}

export async function reconcileExpired(): Promise<{
  gameIds: string[];
  stationIds: string[];
}> {
  const now = new Date();
  const expired = await db
    .select({
      id: participations.id,
      gameId: participations.gameId,
      stationId: participations.stationId,
      endsAt: participations.endsAt,
      cooldownSeconds: games.cooldownSeconds,
    })
    .from(participations)
    .innerJoin(games, eq(games.id, participations.gameId))
    .where(
      and(eq(participations.status, "active"), lte(participations.endsAt, now)),
    );
  const gameIds = new Set<string>();
  const stationIds = new Set<string>();

  for (const row of expired) {
    const didExpire = await db.transaction(async (tx) => {
      const closed = await tx
        .update(participations)
        .set({ status: "completed", completedAt: row.endsAt })
        .where(
          and(
            eq(participations.id, row.id),
            eq(participations.status, "active"),
            lte(participations.endsAt, now),
          ),
        )
        .returning({ id: participations.id });
      if (!closed.length) return false;

      const [remaining] = await tx
        .select({ value: count() })
        .from(teams)
        .leftJoin(
          participations,
          and(
            eq(participations.teamId, teams.id),
            eq(participations.stationId, row.stationId),
            eq(participations.status, "completed"),
          ),
        )
        .where(
          and(
            eq(teams.gameId, row.gameId),
            isNull(teams.archivedAt),
            isNull(participations.id),
          ),
        );
      await tx
        .update(stations)
        .set({
          alarmPending: true,
          selectedTeamId: null,
          cooldownEndsAt:
            Number(remaining.value) > 0
              ? cooldownDeadline(now, row.cooldownSeconds)
              : null,
        })
        .where(eq(stations.id, row.stationId));
      return true;
    });

    if (didExpire) {
      stationIds.add(row.stationId);
      gameIds.add(row.gameId);
    }
  }

  for (const gameId of gameIds) await completeGameIfDone(gameId);
  return { gameIds: [...gameIds], stationIds: [...stationIds] };
}

export async function stationBelongsToLiveGame(stationId: string) {
  const [row] = await db
    .select({ stationId: stations.id })
    .from(stations)
    .innerJoin(games, eq(games.id, stations.gameId))
    .where(
      and(
        eq(stations.id, stationId),
        isNull(stations.archivedAt),
        ne(games.status, "completed"),
      ),
    )
    .limit(1);
  return Boolean(row);
}
