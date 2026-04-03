"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@sts2/shared/lib/cn";
import type { RelicSelectState } from "@sts2/shared/types/game-state";
import { useAppSelector } from "../../store/hooks";
import { selectActiveDeck, selectActivePlayer } from "../../features/run/runSelectors";
import type { EvaluationContext, CardRewardEvaluation } from "@sts2/shared/evaluation/types";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { buildCompactContext } from "@sts2/shared/evaluation/prompt-builder";
import { getPromptContext, updateFromContext, addMilestone } from "@sts2/shared/evaluation/run-narrative";
import { registerLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import { apiFetch } from "@sts2/shared/lib/api-client";
import { EvalError } from "../../components/eval-error";
import { PickBanner, EvalRow, Reasoning, evalBorderClass, findTopPick } from "../../components/eval-card";
import type { TierLetter } from "@sts2/shared/evaluation/tier-utils";

interface RelicSelectViewProps {
  state: RelicSelectState;
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

export function RelicSelectView({ state }: RelicSelectViewProps) {
  const deckCards = useAppSelector(selectActiveDeck);
  const player = useAppSelector(selectActivePlayer);
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
    const contextStr = buildCompactContext(ctx);
    const narrative = getPromptContext();

    const relicList = relics
      .map((r, i) => `${i + 1}. ${r.name}: ${r.description}`)
      .join("\n");

    try {
      const res = await apiFetch("/api/evaluate", {
        method: "POST",
        body: JSON.stringify({
          type: "map",
          evalType: "relic_select",
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
          recommendedTier: topPick.tier,
          reasoning: topPick.reasoning,
          allRankings: rankings.map((r) => ({
            itemId: r.itemId,
            itemName: r.itemName,
            tier: r.tier,
            recommendation: r.recommendation,
          })),
          evalType: "boss_relic",
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

  const topPick = evaluation?.rankings ? findTopPick(evaluation.rankings) : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Header with inline summary */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-100 shrink-0">Boss Relic</h2>
        {evaluation?.pickSummary && !isLoading && (
          <p className="text-xs font-medium text-emerald-400 truncate flex-1 text-right">
            {evaluation.pickSummary}
          </p>
        )}
        {isLoading && (
          <span className="text-xs text-zinc-500 animate-pulse">Evaluating...</span>
        )}
      </div>

      {error && <EvalError error={error} onRetry={() => { evaluatedKey.current = ""; setError(null); }} />}

      <div className="grid grid-cols-3 gap-3">
        {relics.map((relic, i) => {
          const evalData = evaluation?.rankings.find((r) => r.itemIndex === i);
          const isTopPick = topPick === evalData && evalData != null;

          return (
            <div
              key={relic.index}
              className={cn(
                "rounded-lg border bg-spire-surface relative transition-all duration-150",
                evalBorderClass(evalData?.recommendation, isTopPick)
              )}
              title={evalData?.reasoning}
            >
              {isTopPick && <PickBanner />}

              <div className="p-4 pt-5 flex flex-col gap-3">
                <h3 className="font-display font-semibold text-sm text-spire-text truncate">{relic.name}</h3>
                <p className="text-sm text-spire-text-secondary leading-relaxed line-clamp-2">{relic.description}</p>

                {evalData && (
                  <div className="pt-3 border-t border-spire-border-subtle">
                    <EvalRow tier={evalData.tier as TierLetter} recommendation={evalData.recommendation} isTopPick={isTopPick} />
                  </div>
                )}

                {evalData?.reasoning && (
                  <Reasoning text={evalData.reasoning} isTopPick={isTopPick} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
