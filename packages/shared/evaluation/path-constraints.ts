/**
 * HP cost estimates as fraction of max HP, by act.
 * Used by the constraint-aware tracer to simulate HP along a path.
 */
export const HP_COST_ESTIMATES = {
  monster: { act1: 0.10, act2: 0.13, act3: 0.16 },
  elite: { act1: 0.27, act2: 0.30, act3: 0.35 },
} as const;

/**
 * Multiplier for HP costs at higher ascensions.
 * Applied on top of base act costs.
 */
export const ASCENSION_SCALING: Record<number, number> = {
  8: 1.15,
  9: 1.25,
};

/** Rest site heals 30% of max HP */
export const REST_HEALING = 0.30;

/** All constraint thresholds used by the tracer */
export const PATH_CONSTRAINTS = {
  /** Soft penalty: elite below this HP% (risky but survivable) */
  eliteMinHp: 0.70,
  /** Hard gate: never route through elite below this HP% */
  eliteHardMinHp: 0.40,
  /** Hard gate: shop not useful below this gold threshold */
  shopMinGoldFn: (removalCost: number) => Math.min(removalCost, 150),
  /** Hard gate: never let simulated HP drop below this */
  survivalFloor: 0.15,
  /** Soft penalty after this many consecutive monsters */
  consecutiveMonsterPenalty: 3,
  /** Soft penalty: elite without a rest within N nodes after */
  eliteRequiresRestWithin: 2,
  /**
   * HP% at or above which the "no rest within 2 nodes" elite penalty is
   * skipped. Healthy players can absorb the fight without needing a rest
   * chaser, and the penalty was crushing elite paths during Act 1 runs.
   */
  eliteNoRestHpExempt: 0.85,
} as const;

/** Default node preferences when LLM doesn't provide them */
export const DEFAULT_NODE_PREFERENCES = {
  monster: 0.4,
  elite: 0.5,
  shop: 0.5,
  rest: 0.6,
  treasure: 0.9,
  event: 0.5,
} as const;
