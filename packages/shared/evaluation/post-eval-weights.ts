import type { CardRewardEvaluation, CardEvaluation } from "./types";
import type { EvaluationContext } from "./types";
import type { TierLetter } from "./tier-utils";
import { tierToValue } from "./tier-utils";

/**
 * Post-LLM weight adjustment system.
 * Modifies Claude's tier/confidence after the evaluation returns,
 * based on game state signals that Claude may underweight or miss.
 *
 * Pre-eval short-circuits (skip the LLM call entirely) are handled
 * in the individual evaluation hooks, not here.
 */

// --- Tier adjustment helpers ---

const TIER_ORDER: TierLetter[] = ["S", "A", "B", "C", "D", "F"];

export function adjustTier(tier: TierLetter, delta: number): TierLetter {
  const idx = TIER_ORDER.indexOf(tier);
  const newIdx = Math.max(0, Math.min(TIER_ORDER.length - 1, idx - delta)); // -delta because lower index = higher tier
  return TIER_ORDER[newIdx];
}

// --- Weight context ---

export interface WeightContext {
  evalType: string;
  deckSize: number;
  act: number;
  floor: number;
  ascension: number;
  deckCardNames: string[];
  relicNames: string[];
  hpPercent: number;
  gold: number;
  archetypeLocked: string | null;
  hasEliteAhead: boolean;
  hasBossNear: boolean;
  potionNames: string[];
}

export function buildWeightContext(
  evalType: string,
  ctx: EvaluationContext,
  extra?: { hasEliteAhead?: boolean; hasBossNear?: boolean }
): WeightContext {
  return {
    evalType,
    deckSize: ctx.deckSize,
    act: ctx.act,
    floor: ctx.floor,
    ascension: ctx.ascension,
    deckCardNames: ctx.deckCards.map((c) => c.name.toLowerCase()),
    relicNames: ctx.relics.map((r) => r.name.toLowerCase()),
    hpPercent: ctx.hpPercent,
    gold: ctx.gold,
    archetypeLocked: ctx.primaryArchetype,
    hasEliteAhead: extra?.hasEliteAhead ?? false,
    hasBossNear: extra?.hasBossNear ?? false,
    potionNames: ctx.potionNames,
  };
}

// --- Rest site weights ---

export interface RestWeightResult {
  /** If set, skip the LLM call and return this result directly */
  shortCircuit: CardRewardEvaluation | null;
}

/**
 * Pre-eval check for rest sites. Returns a short-circuit result
 * if the decision is obvious (saves tokens).
 */
export function preEvalRestWeights(
  hpPercent: number,
  missing: number,
  maxHp: number,
  hasEliteAhead: boolean,
  hasBossNear: boolean,
  options: { id: string; name: string }[]
): RestWeightResult {
  const healOption = options.find((o) => {
    const id = o.id.toLowerCase();
    const n = o.name.toLowerCase();
    return id === "rest" || id === "heal" || n === "rest" || n === "heal";
  });
  const smithOption = options.find((o) => {
    const id = o.id.toLowerCase();
    const n = o.name.toLowerCase();
    return id === "smith" || id === "upgrade" || n === "smith" || n === "upgrade";
  });

  // Auto-heal at <30% HP — no LLM call needed
  if (hpPercent < 0.30 && healOption) {
    return {
      shortCircuit: buildRestShortCircuit(options, healOption.id, "Heal", "HP critically low — must heal"),
    };
  }

  // Auto-upgrade at >95% HP — no LLM call needed
  if (hpPercent > 0.95 && smithOption && missing <= 5) {
    return {
      shortCircuit: buildRestShortCircuit(options, smithOption.id, "Upgrade", "HP nearly full — upgrade"),
    };
  }

  return { shortCircuit: null };
}

/**
 * Post-eval adjustment for rest sites.
 * Factors HP, upcoming threats, and deck maturity into heal-vs-upgrade decision.
 */
export function applyRestWeights(
  evaluation: CardRewardEvaluation,
  hpPercent: number,
  hasEliteAhead: boolean,
  hasBossNear: boolean,
  deckMaturity = 0.5
): void {
  const healRanking = evaluation.rankings.find((r) => {
    const id = r.itemId?.toLowerCase() ?? "";
    const n = r.itemName?.toLowerCase() ?? "";
    return id === "rest" || id === "heal" || n === "rest" || n === "heal";
  });
  const smithRanking = evaluation.rankings.find((r) => {
    const id = r.itemId?.toLowerCase() ?? "";
    const n = r.itemName?.toLowerCase() ?? "";
    return id === "smith" || id === "upgrade" || n === "smith" || n === "upgrade";
  });

  if (!healRanking || !smithRanking) return;

  // Elite within 2 nodes: heal only below 60% HP
  if (hasEliteAhead && hpPercent < 0.60) {
    healRanking.tier = "S";
    healRanking.tierValue = 6;
    healRanking.confidence = 90;
    healRanking.recommendation = "strong_pick";
    healRanking.reasoning = "Heal before elite — HP too low to risk it";
    smithRanking.tier = adjustTier(smithRanking.tier, -1);
    smithRanking.tierValue = tierToValue(smithRanking.tier);
    smithRanking.recommendation = "situational";
    smithRanking.reasoning = "Upgrade compounds value but survival comes first at this HP";
  }

  // Boss within 3 nodes: heal if HP < 70%
  if (hasBossNear && hpPercent < 0.70) {
    healRanking.tier = "S";
    healRanking.tierValue = 6;
    healRanking.confidence = 95;
    healRanking.recommendation = "strong_pick";
    healRanking.reasoning = "Heal before boss — enter at max HP";
    smithRanking.tier = adjustTier(smithRanking.tier, -2);
    smithRanking.tierValue = tierToValue(smithRanking.tier);
    smithRanking.recommendation = "skip";
  }
}

function buildRestShortCircuit(
  options: { id: string; name: string }[],
  chosenId: string,
  chosenLabel: string,
  reasoning: string
): CardRewardEvaluation {
  return {
    rankings: options.map((o, i) => ({
      itemId: o.id,
      itemName: o.name,
      itemIndex: i,
      rank: o.id === chosenId ? 1 : 2,
      tier: (o.id === chosenId ? "S" : "D") as TierLetter,
      tierValue: o.id === chosenId ? 6 : 2,
      synergyScore: 50,
      confidence: 95,
      recommendation: (o.id === chosenId ? "strong_pick" : "skip") as CardEvaluation["recommendation"],
      reasoning: o.id === chosenId ? reasoning : "Not recommended",
      source: "claude" as const,
    })),
    skipRecommended: false,
    skipReasoning: null,
  };
}

// --- Main entry point ---

/**
 * Post-eval weight dispatcher.
 *
 * Card_reward and shop paths no longer pass through here — the Phase 5
 * scorer (`scoreCardOffers` / `scoreShopNonCards`) is authoritative and
 * short-circuits before this function is reached. Rest-site and other
 * LLM-driven paths call the `applyRest...` helpers directly rather than
 * going through this dispatcher, so this is effectively a no-op retained
 * for callers that still import it.
 */
export function applyPostEvalWeights(
  evaluation: CardRewardEvaluation,
  wctx: WeightContext,
  itemDescriptions?: Map<number, string>
): void {
  void evaluation;
  void wctx;
  void itemDescriptions;
}

/**
 * Reconcile skipRecommended with actual ranking tiers.
 *
 * Claude can return contradictory data — e.g. an A-tier "strong_pick"
 * alongside skip_recommended: true. Post-eval weights can also upgrade
 * tiers without clearing the flag. Call this after all tier adjustments
 * to ensure the flag agrees with the rankings.
 *
 * Threshold: B-tier or above with a non-skip recommendation.
 */
export function reconcileSkipRecommended(
  evaluation: CardRewardEvaluation
): void {
  if (!evaluation.skipRecommended) return;

  const hasWorthTaking = evaluation.rankings.some(
    (r) => r.tierValue >= 4 && r.recommendation !== "skip"
  );

  if (hasWorthTaking) {
    evaluation.skipRecommended = false;
  }
}
