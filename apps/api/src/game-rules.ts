import type { ActivityType } from "@rally/shared";

export function createPromptOrder(
  promptIds: string[],
  type: ActivityType,
  random = Math.random,
) {
  const shuffled = [...promptIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return type === "trivia" || type === "charades"
    ? shuffled
    : shuffled.slice(0, 1);
}

export function scoreTriviaChoice(
  choiceIndex: number,
  correctChoiceIndex: number,
) {
  return choiceIndex === correctChoiceIndex ? 1 : 0;
}

export function cooldownDeadline(now: Date, cooldownSeconds: number) {
  return new Date(now.getTime() + cooldownSeconds * 1000);
}
