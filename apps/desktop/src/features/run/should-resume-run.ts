import type { RunData } from "./runSlice";

export interface ShouldResumeRunArgs {
  isFirstRunTransition: boolean;
  existingRun: RunData | null;
  /** The runId key under which `existingRun` is stored in state.run.runs. */
  existingRunId: string | null;
  /** Canonical runId from the STS2 save file, if available. */
  canonicalRunId: string | null;
  character: string;
  ascension: number;
  currentFloor: number;
  currentAct: number;
}

export function shouldResumeRun({
  isFirstRunTransition,
  existingRun,
  existingRunId,
  canonicalRunId,
  character,
  ascension,
  currentFloor,
  currentAct,
}: ShouldResumeRunArgs): boolean {
  // Canonical path: if the save file reports an id that matches the
  // persisted run, resume regardless of heuristic fields.
  if (canonicalRunId && existingRun && existingRunId === canonicalRunId) {
    return true;
  }

  // Anti-false-match guard: if we have a canonical id AND the persisted
  // run was also canonically-sourced AND they disagree, this is a new run.
  // Don't fall through to the heuristic — doing so would risk picking up
  // a stale same-character run whose floor/act accidentally collide.
  if (
    canonicalRunId &&
    existingRun &&
    existingRun.runIdSource === "save_file" &&
    existingRunId !== canonicalRunId
  ) {
    return false;
  }

  // Legacy heuristic path: first transition + exact match on character +
  // ascension + floor + act + non-empty deck. Only applies to legacy
  // (runIdSource === null) persisted runs.
  if (!isFirstRunTransition) return false;
  if (!existingRun) return false;
  if (existingRun.character !== character) return false;
  if (existingRun.ascension !== ascension) return false;
  if (existingRun.floor !== currentFloor) return false;
  if (existingRun.act !== currentAct) return false;
  if (existingRun.deck.length === 0) return false;
  return true;
}
