import type { CardEvaluation, CardRewardEvaluation, EvaluationContext } from "@sts2/shared/evaluation/types";
import type { CombatCard } from "@sts2/shared/types/game-state";
import type { CommunityTierSignal } from "@sts2/shared/evaluation/community-tier";
import type { WinRateInput } from "@sts2/shared/evaluation/card-reward/modifier-stack";
import { computeDeckState } from "@sts2/shared/evaluation/card-reward/deck-state";
import { tagCard } from "@sts2/shared/evaluation/card-reward/card-tags";
import { scoreCardOffers } from "@sts2/shared/evaluation/card-reward/score-offers";

/**
 * Slimmer relic shape than `GameRelic` — desktop-tracked relics drop the
 * runtime `counter` field, but the deck-state computation never reads it.
 * Cast through `unknown` mirrors the server short-circuit.
 */
type PreviewRelic = { id: string; name: string; description: string };

interface OfferedCard {
  id: string;
  name: string;
  description: string;
  cost: number | string;
  type: string;
  rarity: string;
}

/**
 * Compute the dedup key for a card reward evaluation.
 * Cards sorted by ID so order doesn't matter.
 */
export function computeCardRewardEvalKey(cards: { id: string; name: string }[]): string {
  return cards.map((c) => `${c.id}:${c.name}`).sort().join(",");
}

/**
 * Build the RTK Query mutation payload for card reward evaluation.
 * Pure function — all inputs passed explicitly.
 */
export function buildCardRewardRequest(params: {
  context: EvaluationContext;
  cards: OfferedCard[];
  exclusive: boolean;
  runId: string | null;
  userId: string | null;
  runNarrative: string | null;
}) {
  return {
    context: params.context,
    runNarrative: params.runNarrative,
    items: params.cards.map((card) => ({
      id: card.id,
      name: card.name,
      description: card.description,
      cost: typeof card.cost === "string" ? parseInt(card.cost as string, 10) || 0 : card.cost,
      type: card.type,
      rarity: card.rarity,
    })),
    exclusive: params.exclusive,
    runId: params.runId,
    userId: params.userId,
    gameVersion: null,
  };
}

/**
 * Compute a deterministic preview of the card reward evaluation client-side
 * so the UI can render rankings + the recommendation immediately, before
 * the API roundtrip lands.
 *
 * Mirrors the server short-circuit at `apps/web/src/app/api/evaluate/route.ts`
 * (the `card_reward` branch). Community tier + win-rate signals live only on
 * the server (DB-backed), so we run the scorer with empty maps. The full
 * server response — which includes those signals plus templated coaching —
 * overwrites the preview when it arrives, refining the tiers.
 *
 * Returns null when the deck/relic state isn't yet populated (e.g. first
 * card_reward fires before the run is fully hydrated).
 */
export function buildCardRewardPreview(params: {
  context: EvaluationContext;
  cards: OfferedCard[];
  deckCards: readonly CombatCard[];
  relics: readonly PreviewRelic[];
  hp: { current: number; max: number };
}): CardRewardEvaluation | null {
  if (params.cards.length === 0) return null;

  const actRaw = params.context.act;
  const act = (actRaw >= 1 && actRaw <= 3 ? actRaw : 1) as 1 | 2 | 3;

  let deckState: ReturnType<typeof computeDeckState>;
  try {
    deckState = computeDeckState({
      deck: params.deckCards as unknown as Parameters<typeof computeDeckState>[0]["deck"],
      relics: params.relics as unknown as Parameters<typeof computeDeckState>[0]["relics"],
      act,
      floor: params.context.floor,
      ascension: params.context.ascension,
      hp: params.hp,
    });
  } catch {
    return null;
  }

  const siblings = params.cards.map((c) => ({ name: c.name }));
  const taggedOffers = params.cards.map((card, i) => ({
    index: i + 1,
    name: card.name,
    rarity: card.rarity,
    type: card.type,
    cost: typeof card.cost === "string" ? parseInt(card.cost, 10) || null : card.cost,
    description: card.description,
    tags: tagCard(
      { name: card.name },
      deckState,
      siblings.filter((s) => s.name !== card.name),
      params.deckCards.map((c) => ({ name: c.name })),
    ),
  }));

  const itemIdsByIndex = new Map<number, string>();
  params.cards.forEach((c, i) => itemIdsByIndex.set(i + 1, c.id));

  const scored = scoreCardOffers({
    offers: taggedOffers,
    deckState,
    communityTierById: new Map<string, CommunityTierSignal>(),
    winRatesById: new Map<string, WinRateInput>(),
    itemIdsByIndex,
  });

  const rankings: CardEvaluation[] = scored.offers.map((o) => ({
    itemId: o.itemId,
    itemName: o.itemName,
    itemIndex: o.itemIndex,
    rank: o.rank,
    tier: o.tier,
    tierValue: o.tierValue,
    synergyScore: 50,
    confidence: 50,
    recommendation:
      o.rank === 1 && !scored.skipRecommended
        ? "strong_pick"
        : scored.skipRecommended
          ? "skip"
          : "situational",
    reasoning: o.reasoning,
    source: "claude",
  }));

  return {
    rankings,
    skipRecommended: scored.skipRecommended,
    skipReasoning: scored.skipReason,
    compliance: {
      scoredOffers: scored.offers.map((o) => ({
        itemId: o.itemId,
        rank: o.rank,
        tier: o.tier,
        tierValue: o.tierValue,
        breakdown: o.breakdown,
      })),
    },
  };
}
