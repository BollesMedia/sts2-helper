import type { DeckState } from "./deck-state";
import type { TaggedOffer } from "./format-card-facts";
import type { CommunityTierSignal } from "../community-tier";
import type { TierLetter } from "../tier-utils";
import { computeModifiers, type ModifierBreakdown, type WinRateInput } from "./modifier-stack";
import { shouldSkipAll } from "./skip-threshold";

export interface ScoredOffer {
  itemId: string;
  itemName: string;
  itemIndex: number;
  rank: number;
  tier: TierLetter;
  tierValue: number;
  reasoning: string;
  breakdown: ModifierBreakdown;
}

export interface ScoreOffersResult {
  offers: ScoredOffer[];
  skipRecommended: boolean;
  skipReason: string | null;
  topOffer: ScoredOffer | null;
}

export interface ScoreOffersInput {
  offers: TaggedOffer[];
  deckState: DeckState;
  communityTierById: Map<string, CommunityTierSignal>;
  winRatesById: Map<string, WinRateInput>;
  itemIdsByIndex: Map<number, string>;
}

function positiveModifierCount(breakdown: ModifierBreakdown): number {
  return breakdown.modifiers.filter((m) => m.delta > 0).length;
}

export function scoreCardOffers(input: ScoreOffersInput): ScoreOffersResult {
  if (input.offers.length === 0) {
    return { offers: [], skipRecommended: false, skipReason: null, topOffer: null };
  }

  const scored: ScoredOffer[] = input.offers.map((offer) => {
    const itemId = input.itemIdsByIndex.get(offer.index) ?? String(offer.index);
    const breakdown = computeModifiers({
      offer,
      deckState: input.deckState,
      communityTier: input.communityTierById.get(itemId) ?? null,
      winRate: input.winRatesById.get(itemId) ?? null,
    });
    return {
      itemId,
      itemName: offer.name,
      itemIndex: offer.index,
      rank: 0,
      tier: breakdown.adjustedTier,
      tierValue: breakdown.tierValue,
      reasoning: `${breakdown.adjustedTier}-tier · ${breakdown.topReason}`,
      breakdown,
    };
  });

  scored.sort((a, b) => {
    if (a.tierValue !== b.tierValue) return b.tierValue - a.tierValue;
    const posDiff = positiveModifierCount(b.breakdown) - positiveModifierCount(a.breakdown);
    if (posDiff !== 0) return posDiff;
    return a.itemIndex - b.itemIndex;
  });

  scored.forEach((o, i) => {
    o.rank = i + 1;
  });

  const skip = shouldSkipAll(
    scored.map((o) => o.breakdown),
    input.deckState.act,
  );

  return {
    offers: scored,
    skipRecommended: skip.skip,
    skipReason: skip.reason,
    topOffer: scored[0] ?? null,
  };
}
