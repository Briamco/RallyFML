import { describe, expect, it } from "vitest";
import {
  cooldownDeadline,
  createPromptOrder,
  scoreTriviaChoice,
} from "./game-rules.js";

describe("rally activity rules", () => {
  it("shuffles every trivia and charades prompt once per participation", () => {
    const ids = ["a", "b", "c", "d"];
    const order = createPromptOrder(ids, "charades", () => 0.5);

    expect(order).not.toEqual(ids);
    expect([...order].sort()).toEqual([...ids].sort());
  });

  it("chooses one random mandate for manual-score stations", () => {
    expect(
      createPromptOrder(["a", "b", "c"], "dramatization", () => 0.5),
    ).toHaveLength(1);
  });

  it("awards exactly one point for the correct trivia option", () => {
    expect(scoreTriviaChoice(2, 2)).toBe(1);
    expect(scoreTriviaChoice(1, 2)).toBe(0);
  });

  it("uses the rally cooldown value to calculate the station deadline", () => {
    const now = new Date("2026-10-10T12:00:00.000Z");
    expect(cooldownDeadline(now, 60).toISOString()).toBe(
      "2026-10-10T12:01:00.000Z",
    );
    expect(cooldownDeadline(now, 0)).toEqual(now);
  });
});
