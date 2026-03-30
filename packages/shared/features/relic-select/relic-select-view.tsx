"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import type { RelicSelectState, CombatCard } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { EvaluationContext, CardRewardEvaluation } from "../../evaluation/types";
import { buildEvaluationContext, buildPromptContext } from "../../evaluation/context-builder";
import { getPromptContext, updateFromContext, addMilestone } from "../../evaluation/run-narrative";
import { registerLastEvaluation } from "../../evaluation/last-evaluation-registry";
import { apiFetch } from "../../lib/api-client";
import { TierBadge } from "../../components/tier-badge";
import { EvalError } from "../../components/eval-error";
import type { TierLetter } from "../../evaluation/tier-utils";
import { RECOMMENDATION_BORDER } from "../../lib/recommendation-styles";

interface RelicSelectViewProps {
  state: RelicSelectState;
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
}

interface RelicRanking {
  itemId: string;
  itemName: string;
  itemIndex: number;
  rank: number;
  tier: TierLetter;
  recommendation: string;
  reasoning: string;
}

interface RelicEvaluation {
  pickSummary: string | null;
  rankings: RelicRanking[];
}

export function RelicSelectView({ state, deckCards, player }: RelicSelectViewProps) {
  const relics = state.relic_select.relics;
  const relicKey = relics.map((r) => r.id).sort().join(",");

  const [evaluation, setEvaluation] = useState<RelicEvaluation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evaluatedKey = useRef("");

  const evaluate = useCallback(async () => {
    if (relicKey === evaluatedKey.current) return;
    evaluatedKey.current = relicKey;
    setIsLoading(true);
    setError(null);

    const ctx: EvaluationContext | null = buildEvaluationContext(state, deckCards, player);
    if (!ctx) {
      setError("Could not build evaluation context");
      setIsLoading(false);
      return;
    }

    updateFromContext(ctx);
    const contextStr = buildPromptContext(ctx);
    const narrative = getPromptContext();

    const relicList = relics
      .map((r, i) => `${i + 1}. ${r.name}: ${r.description}`)
      .join("\n");

    try {
      const res = await apiFetch("/api/evaluate", {
        method: "POST",
        body: JSON.stringify({
          type: "map",
          context: ctx,
          runNarrative: narrative,
          mapPrompt: `${contextStr}

BOSS RELIC SELECT — you MUST pick exactly ONE. This is a permanent, run-defining choice.
${state.relic_select.prompt}

Options:
${relicList}

Evaluate which relic best supports the current archetype and win condition. Boss relics are the most impactful single choice in a run.

Respond as JSON:
{
  "pick_summary": "Pick [name] — max 12 words why",
  "rankings": [{"item_id": "RELIC_1", "item_name": "relic name", "rank": 1, "tier": "S-F", "recommendation": "strong_pick|good_pick|situational|skip", "reasoning": "max 12 words"}],
  "overall_advice": null
}

Use RELIC_1, RELIC_2, RELIC_3 matching the numbered options above.`,
          runId: null,
          gameVersion: null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Evaluation failed: ${res.status}`);
      }

      const data = await res.json();

      const rankings: RelicRanking[] = (data.rankings ?? []).map(
        (r: { item_id: string; item_name?: string; rank: number; tier: string; recommendation: string; reasoning: string }) => {
          const indexMatch = r.item_id.match(/(\d+)$/);
          const oneIndexed = indexMatch ? parseInt(indexMatch[1], 10) : 0;
          const idx = oneIndexed - 1;

          return {
            itemId: r.item_id,
            itemName: r.item_name ?? relics[idx]?.name ?? r.item_id,
            itemIndex: idx,
            rank: r.rank,
            tier: r.tier as TierLetter,
            recommendation: r.recommendation,
            reasoning: r.reasoning,
          };
        }
      );

      const eval_: RelicEvaluation = {
        pickSummary: data.pick_summary ?? null,
        rankings,
      };

      setEvaluation(eval_);

      // Register for narrative tracking
      const topPick = rankings.find((r) => r.rank === 1);
      if (topPick) {
        registerLastEvaluation("boss_relic", {
          recommendedId: topPick.itemName,
          reasoning: topPick.reasoning,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setIsLoading(false);
    }
  }, [state, deckCards, player, relics, relicKey]);

  if (relicKey !== evaluatedKey.current && !isLoading) {
    evaluate();
  }

  const topRank = evaluation?.rankings.find((r) => r.rank === 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Boss Relic</h2>
        {isLoading && (
          <span className="text-xs text-zinc-500 animate-pulse">Evaluating...</span>
        )}
      </div>

      {evaluation?.pickSummary && (
        <p className="text-sm font-medium text-emerald-300">{evaluation.pickSummary}</p>
      )}

      {error && <EvalError error={error} onRetry={() => { evaluatedKey.current = ""; setError(null); }} />}

      <div className="grid grid-cols-3 gap-3">
        {relics.map((relic, i) => {
          const evalData = evaluation?.rankings.find((r) => r.itemIndex === i);
          const isTopPick = topRank?.itemIndex === i;

          return (
            <div
              key={relic.index}
              className={cn(
                "rounded-lg border bg-zinc-900/50 p-3 relative",
                isTopPick
                  ? "border-emerald-500/60 ring-1 ring-emerald-500/20"
                  : evalData
                    ? RECOMMENDATION_BORDER[evalData.recommendation] ?? "border-zinc-800"
                    : "border-zinc-800"
              )}
            >
              {isTopPick && (
                <div className="absolute -top-2.5 left-3 rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-950">
                  Pick this
                </div>
              )}

              <div className="flex items-center gap-2">
                {evalData && <TierBadge tier={evalData.tier} size="sm" />}
                <span className="font-medium text-sm text-zinc-100">{relic.name}</span>
              </div>

              <p className="mt-1.5 text-xs text-zinc-400">{relic.description}</p>

              {evalData && (
                <p className="mt-2 text-[11px] text-zinc-300">{evalData.reasoning}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
