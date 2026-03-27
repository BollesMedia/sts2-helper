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

    const restPlayer = state.rest_site.player;
    ctx.hpPercent = restPlayer.max_hp > 0 ? restPlayer.hp / restPlayer.max_hp : 1;
    ctx.gold = restPlayer.gold;

    const contextStr = buildPromptContext(ctx);
    const optionsStr = options
      .map((o, i) => `${i + 1}. ${o.name} (${o.id}): ${o.description}`)
      .join("\n");

    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "map",
          context: ctx,
          mapPrompt: `${contextStr}

Current HP: ${restPlayer.hp}/${restPlayer.max_hp} (${Math.round((restPlayer.hp / Math.max(1, restPlayer.max_hp)) * 100)}%)
Missing HP: ${restPlayer.max_hp - restPlayer.hp}

REST SITE — you must choose EXACTLY ONE option:
${optionsStr}

This is an exclusive choice. Rank the options — only #1 is the recommendation.
Consider:
- HP threshold: only rest if below ~50% HP or if upcoming path has elites/boss with no other rest
- Upgrading a key card can be more valuable than healing 20-30 HP
- At high HP (>70%), almost always upgrade unless boss is next
- Max HP increase from rest compounds over the run
- If recommending Smith (upgrade), NAME THE SPECIFIC CARD to upgrade and why

Respond as JSON:
{
  "rankings": [
    {
      "item_id": "OPTION_ID",
      "rank": 1,
      "tier": "S|A|B|C|D|F",
      "synergy_score": 0-100,
      "confidence": 0-100,
      "recommendation": "strong_pick|good_pick|situational|skip",
      "reasoning": "1-2 sentences. If Smith, specify which card to upgrade."
    }
  ],
  "skip_recommended": false,
  "skip_reasoning": null
}

The #1 ranked option should be "strong_pick". The other option(s) should be "situational" or "skip" — they are the alternatives you're NOT recommending.`,
          runId,
          gameVersion: null,
        }),
      });

      if (!res.ok) {
        throw new Error(`Evaluation failed: ${res.status}`);
      }

      const data = await res.json();

      // Parse map-style response into CardRewardEvaluation format
      const rankings = (data.rankings ?? []).map((r: { item_id: string; rank: number; tier: string; synergy_score: number; confidence: number; recommendation: string; reasoning: string }, i: number) => ({
        itemId: r.item_id,
        itemName: r.item_id,
        itemIndex: i,
        rank: r.rank,
        tier: r.tier,
        tierValue: { S: 6, A: 5, B: 4, C: 3, D: 2, F: 1 }[r.tier] ?? 3,
        synergyScore: r.synergy_score,
        confidence: r.confidence,
        recommendation: r.recommendation,
        reasoning: r.reasoning,
        source: "claude" as const,
      }));

      // Match back to options by ID
      for (const ranking of rankings) {
        const rId = ranking.itemId.toLowerCase();
        const matchIdx = options.findIndex(
          (o) =>
            o.id.toLowerCase() === rId ||
            o.name.toLowerCase() === rId ||
            rId.includes(o.id.toLowerCase()) ||
            rId.includes(o.name.toLowerCase())
        );
        if (matchIdx !== -1) {
          ranking.itemId = options[matchIdx].id;
          ranking.itemName = options[matchIdx].name;
          ranking.itemIndex = matchIdx;
        }
      }

      const evaluation: CardRewardEvaluation = {
        rankings,
        skipRecommended: data.skip_recommended ?? false,
        skipReasoning: data.skip_reasoning ?? null,
      };

      setEvaluation(evaluation);
      setCache(restKey, evaluation);
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
