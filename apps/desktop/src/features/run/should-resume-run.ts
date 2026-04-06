import type { RunData } from "./runSlice";

export interface ShouldResumeRunArgs {
  /** True only on the first menu→in-run transition of the current app session. */
  isFirstRunTransition: boolean;
  /** Persisted run loaded from localStorage, or null if none. */
  existingRun: RunData | null;
  /** Character reported by the current game state poll. */
  character: string;
  /** Ascension reported by the current game state poll. */
  ascension: number;
  /** Floor reported by the current game state poll. */
  currentFloor: number;
  /** Act reported by the current game state poll. */
  currentAct: number;
}

/**
 * Decide whether the persisted run should be resumed instead of starting a new one.
 *
 * Resume is allowed only on the first in-run transition of a session to avoid
 * re-resuming after the user legitimately starts a new run mid-session. A full
 * character + ascension + floor + act match protects against picking up a
 * stale run when the user starts a brand-new run as the same character.
 *
 * Deck must already be populated because the STS2 mod only exposes master deck
 * data via combat piles or card_select screens — without a persisted deck we
 * cannot rebuild it from non-combat states.
 */
export function shouldResumeRun({
  isFirstRunTransition,
  existingRun,
  character,
  ascension,
  currentFloor,
  currentAct,
}: ShouldResumeRunArgs): boolean {
  if (!isFirstRunTransition) return false;
  if (!existingRun) return false;
  if (existingRun.character !== character) return false;
  if (existingRun.ascension !== ascension) return false;
  if (existingRun.floor !== currentFloor) return false;
  if (existingRun.act !== currentAct) return false;
  if (existingRun.deck.length === 0) return false;
  return true;
}
