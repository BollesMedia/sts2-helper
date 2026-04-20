import type { EnrichedPath } from "./enrich-paths";
import type { RunState } from "./run-state";

export const MAP_SCORE_WEIGHTS = {
  elitesTaken: 10,
  elitesInAct1Bonus: 2,
  restBeforeElite: 8,
  restAfterElite: 5,
  treasuresTaken: 6,
  unknownsActs1And2: 2,
  unknownsAct3: 1,
  projectedHpAtBossFight: 4,
  distanceToAct3EliteOpportunities: 3,
  hpDipBelow30PctPenalty: -5,
  hpDipBelow15PctPenalty: -12,
  backToBackShopPairUnderGold: -3,
  hardPoolChainLength: -2,
} as const;

export const MIN_SHOP_PRICE_FLOOR = 50;
export const REST_HEAL_PCT = 0.3;

export interface ScoredPath extends EnrichedPath {
  score: number;
  scoreBreakdown: Record<string, number>;
  disqualified: boolean;
  disqualifyReasons: string[];
}

export interface ScorePathsOptions {
  /** Card removal cost at the current floor. Used for naked-shop rule. */
  cardRemovalCost: number;
}

export function scorePaths(
  paths: EnrichedPath[],
  runState: RunState,
  options: ScorePathsOptions,
): ScoredPath[] {
  if (paths.length === 0) return [];
  // Real implementation lands in Tasks 2–4.
  return [];
}
