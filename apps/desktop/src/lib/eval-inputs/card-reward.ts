import type { EvaluationContext } from "@sts2/shared/evaluation/types";

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
export function computeCardRewardEvalKey(cards: { id: string }[]): string {
  return cards.map((c) => c.id).sort().join(",");
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
