"use client";

import { useCallback } from "react";
import type { CardRewardState } from "@sts2/shared/types/game-state";
import type { EvaluationContext, CardRewardEvaluation } from "@sts2/shared/evaluation/types";
import { useAppSelector } from "../../store/hooks";
import { selectActiveDeck, selectActivePlayer } from "../../features/run/runSelectors";
import { selectActiveRunId } from "../../features/run/runSlice";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { registerLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import { getUserId } from "@sts2/shared/lib/get-user-id";
import { useEvaluation, type UseEvaluationResult } from "@sts2/shared/evaluation/use-evaluation";
import { useEvaluateCardRewardMutation } from "../../services/evaluationApi";

const CACHE_KEY = "sts2-eval-cache";

/**
 * Triggers a holistic card evaluation when a card_reward state is detected.
 * Caches results so toggling the UI doesn't re-evaluate the same cards.
 */
export function useCardEvaluation(
  state: CardRewardState,
  exclusive: boolean = true
): UseEvaluationResult<CardRewardEvaluation> {
  const deckCards = useAppSelector(selectActiveDeck);
  const player = useAppSelector(selectActivePlayer);
  const runId = useAppSelector(selectActiveRunId);
  const cards = state.card_reward.cards;
  const cardKey = cards.map((c) => c.id).sort().join(",");
  const [trigger] = useEvaluateCardRewardMutation();

  const fetcher = useCallback(async (): Promise<CardRewardEvaluation> => {
    const ctx: EvaluationContext | null = buildEvaluationContext(
      state,
      deckCards,
      player
    );

    if (!ctx) {
      throw new Error("Could not build evaluation context");
    }

    updateFromContext(ctx);

    const data = await trigger({
      context: ctx,
      runNarrative: getPromptContext(),
      items: cards.map((card) => ({
        id: card.id,
        name: card.name,
        description: card.description,
        cost: typeof card.cost === "string" ? parseInt(card.cost, 10) || 0 : card.cost,
        type: card.type,
        rarity: card.rarity,
      })),
      exclusive,
      runId,
      userId: getUserId(),
      gameVersion: null,
    }).unwrap();

    registerLastEvaluation("card_reward", {
      recommendedId: data.rankings?.[0]?.itemId ?? null,
      recommendedTier: data.rankings?.[0]?.tier ?? null,
      reasoning: data.rankings?.[0]?.reasoning ?? "",
      allRankings: (data.rankings ?? []).map((r) => ({
        itemId: r.itemId,
        itemName: r.itemName,
        tier: r.tier,
        recommendation: r.recommendation,
      })),
      evalType: "card_reward",
    });

    return data;
  }, [state, deckCards, player, cards, exclusive, runId, trigger]);

  return useEvaluation<CardRewardEvaluation>({
    cacheKey: CACHE_KEY,
    evalKey: cardKey,
    enabled: true,
    fetcher,
  });
}
