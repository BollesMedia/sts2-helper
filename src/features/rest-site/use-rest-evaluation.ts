"use client";

import { useCallback, useRef, useState } from "react";
import type { RestSiteState, CombatCard } from "@/lib/types/game-state";
import type { TrackedPlayer } from "@/features/connection/use-player-tracker";
import type { EvaluationContext, CardRewardEvaluation } from "@/evaluation/types";
import { buildEvaluationContext, buildPromptContext } from "@/evaluation/context-builder";

const CACHE_KEY = "sts2-rest-eval-cache";

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

interface UseRestEvaluationResult {
  evaluation: CardRewardEvaluation | null;
  isLoading: boolean;
  error: string | null;
}

export function useRestEvaluation(
  state: RestSiteState,
  deckCards: CombatCard[],
  player: TrackedPlayer | null,
  runId: string | null = null
): UseRestEvaluationResult {
  const options = state.rest_site.options.filter((o) => o.is_enabled);

  if (options.length <= 1) {
    return { evaluation: null, isLoading: false, error: null };
  }

  const restKey = `rest:${state.run.floor}:${options.map((o) => o.id).join(",")}`;

  const cachedRef = useRef<string | null>(null);
  const initialEval = cachedRef.current !== restKey ? getCached(restKey) : null;

  const [evaluation, setEvaluation] = useState<CardRewardEvaluation | null>(initialEval);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evaluatedKey = useRef<string>(initialEval ? restKey : "");

  cachedRef.current = restKey;

  const evaluate = useCallback(async () => {
    if (restKey === evaluatedKey.current) return;

    const cached = getCached(restKey);
    if (cached) {
      evaluatedKey.current = restKey;
      setEvaluation(cached);
      return;
    }

    evaluatedKey.current = restKey;
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

    // Override HP from rest site state (most current)
    const restPlayer = state.rest_site.player;
    ctx.hpPercent = restPlayer.max_hp > 0 ? restPlayer.hp / restPlayer.max_hp : 1;
    ctx.gold = restPlayer.gold;

    const items = options.map((opt) => ({
      id: opt.id,
      name: opt.name,
      description: opt.description,
      type: "Rest Site Option",
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
      setCache(restKey, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setIsLoading(false);
    }
  }, [state, deckCards, player, options, restKey, runId]);

  if (restKey !== evaluatedKey.current && !isLoading) {
    evaluate();
  }

  return { evaluation, isLoading, error };
}
