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

// --- Card reward weights ---

function applyCardRewardWeights(
  evaluation: CardRewardEvaluation,
  wctx: WeightContext,
  itemDescriptions: Map<number, string>
): void {
  for (const ranking of evaluation.rankings) {
    const desc = itemDescriptions.get(ranking.itemIndex ?? -1)?.toLowerCase() ?? "";

    // Unplayable/curse cards being OFFERED: penalize heavily
    if (desc.includes("unplayable") || desc.includes("curse")) {
      ranking.tier = "F";
      ranking.tierValue = 1;
      ranking.confidence = 95;
      ranking.recommendation = "skip";
      ranking.reasoning = (ranking.reasoning ?? "") + " [Unplayable card]";
      continue;
    }

    // Act 1 floors 1-5: boost immediate impact cards
    if (wctx.act === 1 && wctx.floor <= 5) {
      const isImmediate = desc.includes("damage") || desc.includes("block") || desc.includes("draw");
      if (isImmediate && !desc.includes("power") && !desc.includes("setup")) {
        ranking.tier = adjustTier(ranking.tier, 1);
        ranking.tierValue = tierToValue(ranking.tier);
      }
    }
  }
}

// --- Shop weights ---

function applyShopWeights(
  evaluation: CardRewardEvaluation,
  wctx: WeightContext,
  itemDescriptions: Map<number, string>
): void {
  for (const ranking of evaluation.rankings) {
    const name = ranking.itemName?.toLowerCase() ?? "";

    // Card removal with unplayable/curse in deck: boost to S tier
    if (name.includes("card removal") || name.includes("remove")) {
      const hasUnplayable = wctx.deckCardNames.some(
        (c) => c.includes("clumsy") || c.includes("spore") || c.includes("curse") || c.includes("normality") || c.includes("writhe")
      );
      if (hasUnplayable) {
        ranking.tier = "S";
        ranking.tierValue = 6;
        ranking.confidence = 98;
        ranking.reasoning = "Remove unplayable/curse card — top priority";
      }
    }

    // Act 3: note that gold is worthless after final boss
    // (This is handled in the spending_plan by the prompt, but reinforce)
  }
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
  const healOption = options.find((o) =>
    o.id.toLowerCase().includes("rest") || o.name.toLowerCase().includes("rest") || o.name.toLowerCase().includes("heal")
  );
  const smithOption = options.find((o) =>
    o.id.toLowerCase().includes("smith") || o.name.toLowerCase().includes("upgrade")
  );

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
  const healRanking = evaluation.rankings.find((r) =>
    r.itemId?.toLowerCase().includes("rest") || r.itemName?.toLowerCase().includes("rest") || r.itemName?.toLowerCase().includes("heal")
  );
  const smithRanking = evaluation.rankings.find((r) =>
    r.itemId?.toLowerCase().includes("smith") || r.itemName?.toLowerCase().includes("upgrade")
  );

  if (!healRanking || !smithRanking) return;

  // Elite within 2 nodes
  if (hasEliteAhead) {
    // High maturity + healthy = safe to upgrade (deck can handle the elite)
    if (deckMaturity >= 0.6 && hpPercent >= 0.75) {
      smithRanking.reasoning = "Deck is strong enough for the elite — upgrade compounds value";
      // Don't override Claude's recommendation, just surface context
    } else if (hpPercent < 0.75) {
      healRanking.tier = "S";
      healRanking.tierValue = 6;
      healRanking.confidence = 90;
      healRanking.recommendation = "strong_pick";
      healRanking.reasoning = `Heal before elite — ${hpPercent < 0.6 ? "critically low HP" : "not healthy enough to risk it"}`;
      smithRanking.tier = adjustTier(smithRanking.tier, -1);
      smithRanking.tierValue = tierToValue(smithRanking.tier);
      smithRanking.recommendation = "situational";
      smithRanking.reasoning = "Upgrade is valuable but survival comes first with elite ahead";
    }
  }

  // Boss within 3 nodes: heal if HP < 80%
  if (hasBossNear && hpPercent < 0.80) {
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
    pickSummary: `${chosenLabel} — ${reasoning}`,
    skipRecommended: false,
    skipReasoning: null,
  };
}

// --- Main entry point ---

/**
 * Apply post-eval weights to card/shop evaluations.
 * Called in route.ts after parsing Claude's response.
 */
export function applyPostEvalWeights(
  evaluation: CardRewardEvaluation,
  wctx: WeightContext,
  itemDescriptions?: Map<number, string>
): void {
  const descs = itemDescriptions ?? new Map();

  if (wctx.evalType === "card_reward") {
    applyCardRewardWeights(evaluation, wctx, descs);
  } else if (wctx.evalType === "shop") {
    applyShopWeights(evaluation, wctx, descs);
  }
}
