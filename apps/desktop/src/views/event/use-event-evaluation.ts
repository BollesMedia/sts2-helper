"use client";
import { apiFetch } from "@sts2/shared/lib/api-client";

import { useCallback, useRef, useState } from "react";
import type { EventState, CombatCard } from "@sts2/shared/types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { EvaluationContext, CardRewardEvaluation, CardEvaluation } from "@sts2/shared/evaluation/types";
import { tierToValue, type TierLetter } from "@sts2/shared/evaluation/tier-utils";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { buildCompactContext } from "@sts2/shared/evaluation/prompt-builder";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { registerLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import { getCached, setCache } from "@sts2/shared/lib/local-cache";

const CACHE_KEY = "sts2-event-eval-cache";

interface UseEventEvaluationResult {
  evaluation: CardRewardEvaluation | null;
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

export function useEventEvaluation(
  state: EventState,
  deckCards: CombatCard[],
  player: TrackedPlayer | null,
  runId: string | null = null
): UseEventEvaluationResult {
  const options = state.event.options.filter((o) => !o.is_proceed && !o.is_locked);
  const enabled = options.length > 1;

  const eventKey = enabled ? `${state.event.event_id}:${options.map((o) => o.index).join(",")}` : "disabled";

  const cachedRef = useRef<string | null>(null);
  const initialEval = cachedRef.current !== eventKey ? getCached<CardRewardEvaluation>(CACHE_KEY, eventKey) : null;

  const [evaluation, setEvaluation] = useState<CardRewardEvaluation | null>(initialEval);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evaluatedKey = useRef<string>(initialEval ? eventKey : "");

  cachedRef.current = eventKey;

  const evaluate = useCallback(async () => {
    if (eventKey === evaluatedKey.current) return;

    const cached = getCached<CardRewardEvaluation>(CACHE_KEY, eventKey);
    if (cached) {
      evaluatedKey.current = eventKey;
      setEvaluation(cached);
      return;
    }

    evaluatedKey.current = eventKey;
    setIsLoading(true);
    setError(null);

    const ctx: EvaluationContext | null = buildEvaluationContext(
      state,
      deckCards,
      player
    );

    if (!ctx) {
      setError("Could not build evaluation context");
      setIsLoading(false);
      return;
    }

    updateFromContext(ctx);

    const contextStr = buildCompactContext(ctx);
    const optionsStr = options
      .map((o, i) => `${i + 1}. ${o.title}: ${o.relic_description ?? o.description}`)
      .join("\n");

    try {
      const res = await apiFetch("/api/evaluate", {
        method: "POST",
        body: JSON.stringify({
          type: "map",
          evalType: "event",
          context: ctx,
          runNarrative: getPromptContext(),
          mapPrompt: `${contextStr}

EVENT: ${state.event.event_name}
You must choose EXACTLY ONE option:
${optionsStr}

This is an exclusive choice. Recommend ONE best option as "strong_pick". The others should be "situational" or "skip" — they are alternatives you're NOT recommending.

Respond as JSON:
{
  "rankings": [
    {
      "item_id": "EVENT_1",
      "rank": 1,
      "tier": "S|A|B|C|D|F",
      "synergy_score": 0-100,
      "confidence": 0-100,
      "recommendation": "strong_pick|good_pick|situational|skip",
      "reasoning": "Max 12 words"
    }
  ],
  "skip_recommended": false,
  "skip_reasoning": null
}

Use item_id EVENT_1, EVENT_2, EVENT_3 matching the numbered options above.`,
          runId,
          gameVersion: null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Evaluation failed: ${res.status}`);
      }

      const data = await res.json();

      // Parse into CardRewardEvaluation format
      const rankings = (data.rankings ?? []).map((r: { item_id: string; rank: number; tier: string; synergy_score: number; confidence: number; recommendation: string; reasoning: string }) => {
        // Extract index from EVENT_1, EVENT_2, etc. (1-indexed)
        const indexMatch = r.item_id.match(/(\d+)$/);
        const oneIndexed = indexMatch ? parseInt(indexMatch[1], 10) : 0;
        const optIndex = oneIndexed - 1; // convert to 0-indexed for array lookup

        return {
          itemId: r.item_id,
          itemName: options[optIndex]?.title ?? r.item_id,
          itemIndex: optIndex,
          rank: r.rank,
          tier: r.tier,
          tierValue: tierToValue(r.tier as TierLetter),
          synergyScore: r.synergy_score,
          confidence: r.confidence,
          recommendation: r.recommendation,
          reasoning: r.reasoning,
          source: "claude" as const,
        };
      });

      const evaluation: CardRewardEvaluation = {
        rankings,
        pickSummary: data.pick_summary ?? null,
        skipRecommended: data.skip_recommended ?? false,
        skipReasoning: data.skip_reasoning ?? null,
      };

      setEvaluation(evaluation);
      setCache(CACHE_KEY, eventKey, evaluation);
      registerLastEvaluation("event", {
        recommendedId: rankings?.[0]?.itemId ?? null,
        recommendedTier: rankings?.[0]?.tier ?? null,
        reasoning: rankings?.[0]?.reasoning ?? "",
        allRankings: (rankings as CardEvaluation[]).map((r) => ({
          itemId: r.itemId,
          itemName: r.itemName,
          tier: r.tier,
          recommendation: r.recommendation,
        })),
        evalType: "event",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setIsLoading(false);
    }
  }, [state, deckCards, player, options, eventKey, runId]);

  const retry = () => {
    evaluatedKey.current = "";
    setError(null);
    setEvaluation(null);
  };

  if (enabled && eventKey !== evaluatedKey.current && !isLoading) {
    evaluate();
  }

  if (!enabled) {
    return { evaluation: null, isLoading: false, error: null, retry: () => {} };
  }

  return { evaluation, isLoading, error, retry };
}
