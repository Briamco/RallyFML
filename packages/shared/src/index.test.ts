import { describe, expect, it } from "vitest";
import {
  gameConfigurationSchema,
  gameSettingsSchema,
  rankScores,
  scoreSchema,
  stationInputSchema,
} from "./index.js";

describe("game rules", () => {
  it("keeps tied teams at the same rank", () => {
    expect(
      rankScores([{ score: 8 }, { score: 8 }, { score: 3 }]).map(
        (row) => row.rank,
      ),
    ).toEqual([1, 1, 3]);
  });

  it("accepts only integer moderator scores from zero to five", () => {
    expect(scoreSchema.safeParse({ score: 5 }).success).toBe(true);
    expect(scoreSchema.safeParse({ score: 6 }).success).toBe(false);
    expect(scoreSchema.safeParse({ score: 1.5 }).success).toBe(false);
  });

  it("validates global duration and cooldown values", () => {
    expect(
      gameSettingsSchema.safeParse({
        activityDurationSeconds: 120,
        cooldownSeconds: 60,
      }).success,
    ).toBe(true);
    expect(
      gameSettingsSchema.safeParse({
        activityDurationSeconds: 5,
        cooldownSeconds: -1,
      }).success,
    ).toBe(false);
  });

  it("keeps team identity in editable rally configuration", () => {
    const configuration = {
      name: "Rally",
      activityDurationSeconds: 120,
      cooldownSeconds: 60,
      teams: [
        { id: "28c4a3d1-12fb-493b-9e91-7d654aa31f16", name: "Equipo 1" },
        { name: "Equipo 2" },
      ],
      stations: [
        {
          title: "Charadas",
          type: "charades",
          prompts: [{ content: "Imita un animal" }],
        },
      ],
    };
    expect(gameConfigurationSchema.safeParse(configuration).success).toBe(true);
    expect(
      gameConfigurationSchema.safeParse({
        ...configuration,
        teams: [{ id: "team-1", name: "Equipo 1" }],
      }).success,
    ).toBe(false);
  });

  it("requires station prompts and four trivia choices with one answer", () => {
    const base = {
      title: "Trivia",
      type: "trivia",
      key: "abcdefgh",
      prompts: [
        {
          content: "Pregunta",
          options: ["A", "B", "C", "D"],
          correctChoiceIndex: 1,
        },
      ],
    };
    expect(stationInputSchema.safeParse(base).success).toBe(true);
    expect(stationInputSchema.safeParse({ ...base, prompts: [] }).success).toBe(
      false,
    );
    expect(
      stationInputSchema.safeParse({
        ...base,
        prompts: [{ content: "Pregunta", options: ["A", "B", "C", "D"] }],
      }).success,
    ).toBe(false);
  });
});
