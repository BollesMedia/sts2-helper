import type { PendingChoiceEntry } from "./types";

const registry = new Map<string, PendingChoiceEntry>();

function key(floor: number, choiceType: string): string {
  return `${floor}:${choiceType}`;
}

export function registerPendingChoice(
  floor: number,
  choiceType: string,
  chosenItemId: string | null,
  sequence: number
): void {
  registry.set(key(floor, choiceType), {
    chosenItemId,
    floor,
    choiceType,
    sequence,
  });
}

export function getPendingChoice(
  floor: number,
  choiceType: string
): PendingChoiceEntry | undefined {
  return registry.get(key(floor, choiceType));
}

export function clearPendingChoice(floor: number, choiceType: string): void {
  registry.delete(key(floor, choiceType));
}

export function clearAllPendingChoices(): void {
  registry.clear();
}
