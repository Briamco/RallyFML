import { z } from "zod";

export const activityTypes = [
  "trivia",
  "charades",
  "creativity",
  "dramatization",
  "external",
] as const;

export const activityTypeSchema = z.enum(activityTypes);
export type ActivityType = z.infer<typeof activityTypeSchema>;

export const setupSchema = z.object({
  bootstrapSecret: z.string().min(1),
  username: z.string().trim().min(3).max(50),
  password: z.string().min(12).max(128),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(50),
  password: z.string().min(1).max(128),
});

export const moderatorLoginSchema = z.object({
  stationId: z.string().uuid(),
  key: z.string().trim().min(1).max(128),
});

export const gameCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const gameSettingsSchema = z.object({
  activityDurationSeconds: z.number().int().min(10).max(3600),
  cooldownSeconds: z.number().int().min(0).max(3600),
});

export const teamNamesSchema = z.object({
  names: z.array(z.string().trim().min(1).max(60)).min(1).max(50),
});
export const teamConfigSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(60),
});

export const promptInputSchema = z.object({
  content: z.string().trim().min(1).max(1000),
  options: z.array(z.string().trim().min(1).max(300)).length(4).optional(),
  correctChoiceIndex: z.number().int().min(0).max(3).optional(),
});

const stationConfigBaseSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).default(""),
  type: activityTypeSchema,
  prompts: z.array(promptInputSchema).min(1).max(100),
});

function validateTriviaPrompts(
  station: z.infer<typeof stationConfigBaseSchema>,
  context: z.RefinementCtx,
) {
  if (station.type !== "trivia") return;
  station.prompts.forEach((prompt, index) => {
    if (!prompt.options || prompt.correctChoiceIndex === undefined)
      context.addIssue({
        code: "custom",
        path: ["prompts", index],
        message: "Cada pregunta debe tener cuatro opciones y una correcta.",
      });
  });
}

export const stationInputSchema = stationConfigBaseSchema
  .extend({ key: z.string().trim().min(8).max(128) })
  .superRefine(validateTriviaPrompts);

export const stationUpdateSchema = stationConfigBaseSchema
  .extend({ key: z.string().trim().min(8).max(128).optional() })
  .superRefine(validateTriviaPrompts);

export const stationAdminSchema = stationConfigBaseSchema
  .extend({
    id: z.string().uuid().optional(),
    key: z.string().trim().min(8).max(128).optional(),
  })
  .superRefine(validateTriviaPrompts);

export const gameConfigurationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  activityDurationSeconds: gameSettingsSchema.shape.activityDurationSeconds,
  cooldownSeconds: gameSettingsSchema.shape.cooldownSeconds,
  teams: z.array(teamConfigSchema).min(1).max(50),
  stations: z.array(stationAdminSchema).max(30),
});

export const selectTeamSchema = z.object({ teamId: z.string().uuid() });
export const triviaAnswerSchema = z.object({
  promptId: z.string().uuid(),
  choiceIndex: z.number().int().min(0).max(3),
});
export const charadesAnswerSchema = z.object({
  promptId: z.string().uuid(),
  correct: z.boolean(),
});
export const scoreSchema = z.object({ score: z.number().int().min(0).max(5) });

export type PublicStationState = {
  id: string;
  gameId: string;
  title: string;
  description: string;
  gameStatus: "setup" | "live" | "completed";
  type: ActivityType;
  durationSeconds: number;
  selectedTeamId: string | null;
  cooldownEndsAt: string | null;
  alarmPending: boolean;
  activeParticipation: null | {
    id: string;
    teamId: string;
    teamName: string;
    endsAt: string;
    score: number;
    scoreSubmitted: boolean;
    nextPrompt: {
      id: string;
      content: string;
      index: number;
      total: number;
      options?: string[];
    } | null;
  };
  teams: {
    id: string;
    name: string;
    completed: boolean;
    activeElsewhere: boolean;
    available: boolean;
  }[];
};

export type Scoreboard = {
  game: {
    id: string;
    name: string;
    status: "setup" | "live" | "completed";
    podiumRevealed: boolean;
  };
  teams: { id: string; name: string; score: number; rank: number }[];
};

export function rankScores<T extends { score: number }>(
  rows: T[],
): (T & { rank: number })[] {
  let priorScore: number | undefined;
  let rank = 0;
  return [...rows]
    .sort((a, b) => b.score - a.score)
    .map((row, index) => {
      if (row.score !== priorScore) rank = index + 1;
      priorScore = row.score;
      return { ...row, rank };
    });
}
