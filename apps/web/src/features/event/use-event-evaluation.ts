"use client";

import { useCallback, useRef, useState } from "react";
import type { EventState, CombatCard } from "@/lib/types/game-state";
import type { TrackedPlayer } from "@/features/connection/use-player-tracker";
import type { EvaluationContext, CardRewardEvaluation } from "@/evaluation/types";
import { buildEvaluationContext, buildPromptContext } from "@/evaluation/context-builder";

const CACHE_KEY = "sts2-event-eval-cache";

interface CachedEvaluation {
  key: string;
  evaluation: CardRewardEvaluation;
}

function getCached(key: string): CardRewardEvaluation | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (!stored) return null;
    const cached: CachedEvaluation = JSON.parse(stored);
    return cached.key === key ? cached.evaluation : null;
  } catch {
    return null;
  }
}

function setCache(key: string, evaluation: CardRewardEvaluation) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ key, evaluation }));
  } catch {}
}

interface UseEventEvaluationResult {
  evaluation: CardRewardEvaluation | null;
  isLoading: boolean;
  error: string | null;
}

export function useEventEvaluation(
  state: EventState,
  deckCards: CombatCard[],
  player: TrackedPlayer | null,
  runId: string | null = null
): UseEventEvaluationResult {
  const options = state.event.options.filter((o) => !o.is_proceed && !o.is_locked);

  // Don't evaluate if only one option or no real choices
  if (options.length <= 1) {
    return { evaluation: null, isLoading: false, error: null };
  }

  const eventKey = `${state.event.event_id}:${options.map((o) => o.index).join(",")}`;

  const cachedRef = useRef<string | null>(null);
  const initialEval = cachedRef.current !== eventKey ? getCached(eventKey) : null;

  const [evaluation, setEvaluation] = useState<CardRewardEvaluation | null>(initialEval);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evaluatedKey = useRef<string>(initialEval ? eventKey : "");

  cachedRef.current = eventKey;

  const evaluate = useCallback(async () => {
    if (eventKey === evaluatedKey.current) return;

    const cached = getCached(eventKey);
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

    const contextStr = buildPromptContext(ctx);
    const optionsStr = options
      .map((o, i) => `${i + 1}. ${o.title}: ${o.relic_description ?? o.description}`)
      .join("\n");

    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "map",
          context: ctx,
          mapPrompt: `${contextStr}

EVENT: ${state.event.event_name}
You must choose EXACTLY ONE option:
${optionsStr}

This is an exclusive choice. Recommend ONE best option as "strong_pick". The others should be "situational" or "skip" — they are alternatives you're NOT recommending.

Respond as JSON:
{
  "rankings": [
    {
      "item_id": "EVENT_0",
      "rank": 1,
      "tier": "S|A|B|C|D|F",
      "synergy_score": 0-100,
      "confidence": 0-100,
      "recommendation": "strong_pick|good_pick|situational|skip",
      "reasoning": "1-2 sentences"
    }
  ],
  "skip_recommended": false,
  "skip_reasoning": null
}

Use item_id format EVENT_0, EVENT_1, EVENT_2 matching the option numbers (0-indexed).`,
          runId,
          gameVersion: null,
        }),
      });

      if (!res.ok) {
        throw new Error(`Evaluation failed: ${res.status}`);
      }

      const data = await res.json();

      // Parse into CardRewardEvaluation format
      const rankings = (data.rankings ?? []).map((r: { item_id: string; rank: number; tier: string; synergy_score: number; confidence: number; recommendation: string; reasoning: string }) => {
        // Extract index from EVENT_0, EVENT_1, etc.
        const indexMatch = r.item_id.match(/(\d+)$/);
        const optIndex = indexMatch ? parseInt(indexMatch[1], 10) : -1;

        return {
          itemId: r.item_id,
          itemName: options[optIndex]?.title ?? r.item_id,
          itemIndex: optIndex,
          rank: r.rank,
          tier: r.tier,
          tierValue: { S: 6, A: 5, B: 4, C: 3, D: 2, F: 1 }[r.tier] ?? 3,
          synergyScore: r.synergy_score,
          confidence: r.confidence,
          recommendation: r.recommendation,
          reasoning: r.reasoning,
          source: "claude" as const,
        };
      });

      const evaluation: CardRewardEvaluation = {
        rankings,
        skipRecommended: data.skip_recommended ?? false,
        skipReasoning: data.skip_reasoning ?? null,
      };

      setEvaluation(evaluation);
      setCache(eventKey, evaluation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setIsLoading(false);
    }
  }, [state, deckCards, player, options, eventKey, runId]);

  if (eventKey !== evaluatedKey.current && !isLoading) {
    evaluate();
  }

  return { evaluation, isLoading, error };
}
