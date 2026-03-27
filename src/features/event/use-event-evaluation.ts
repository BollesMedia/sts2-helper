"use client";

import { useCallback, useRef, useState } from "react";
import type { EventState, CombatCard } from "@/lib/types/game-state";
import type { TrackedPlayer } from "@/features/connection/use-player-tracker";
import type { EvaluationContext, CardRewardEvaluation } from "@/evaluation/types";
import { buildEvaluationContext } from "@/evaluation/context-builder";

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

    const items = options.map((opt) => ({
      id: `EVENT_${opt.index}`,
      name: opt.title,
      description: opt.relic_description ?? opt.description,
      type: "Event Option",
    }));

    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "card_reward",
          context: ctx,
          items,
          runId,
          gameVersion: null,
        }),
      });

      if (!res.ok) {
        throw new Error(`Evaluation failed: ${res.status}`);
      }

      const data: CardRewardEvaluation = await res.json();
      setEvaluation(data);
      setCache(eventKey, data);
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
