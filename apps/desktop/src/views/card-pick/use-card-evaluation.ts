"use client";
import { apiFetch } from "@sts2/shared/lib/api-client";

import { useCallback } from "react";
import type { CardRewardState, CombatCard } from "@sts2/shared/types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { EvaluationContext, CardRewardEvaluation } from "@sts2/shared/evaluation/types";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { registerLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import { getUserId } from "@sts2/shared/lib/get-user-id";
import { useEvaluation, type UseEvaluationResult } from "@sts2/shared/evaluation/use-evaluation";

const CACHE_KEY = "sts2-eval-cache";

/**
 * Triggers a holistic card evaluation when a card_reward state is detected.
 * Caches results so toggling the UI doesn't re-evaluate the same cards.
 */
export function useCardEvaluation(
  state: CardRewardState,
  deckCards: CombatCard[],
  player: TrackedPlayer | null,
  runId: string | null = null,
  exclusive: boolean = true
): UseEvaluationResult<CardRewardEvaluation> {
  const cards = state.card_reward.cards;
  const cardKey = cards.map((c) => c.id).sort().join(",");

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

    const res = await apiFetch("/api/evaluate", {
      method: "POST",
      body: JSON.stringify({
        type: "card_reward",
        exclusive,
        userId: getUserId(),
        context: ctx,
        runNarrative: getPromptContext(),
        items: cards.map((card) => ({
          id: card.id,
          name: card.name,
          description: card.description,
          cost: card.cost,
          type: card.type,
          rarity: card.rarity,
        })),
        runId,
        gameVersion: null,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail ?? `Evaluation failed: ${res.status}`);
    }

    const data: CardRewardEvaluation = await res.json();
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
  }, [state, deckCards, player, cards, exclusive, runId]);

  return useEvaluation<CardRewardEvaluation>({
    cacheKey: CACHE_KEY,
    evalKey: cardKey,
    enabled: true,
    fetcher,
  });
}
