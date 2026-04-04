"use client";

import { cn } from "@sts2/shared/lib/cn";
import type { RelicSelectState } from "@sts2/shared/types/game-state";
import type { TierLetter } from "@sts2/shared/evaluation/tier-utils";
import { EvalError } from "../../components/eval-error";
import { PickBanner, EvalRow, Reasoning, evalBorderClass } from "../../components/eval-card";
import { resolveTopPick } from "../../lib/resolve-top-pick";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { selectEvalResult, selectEvalIsLoading, selectEvalError } from "../../features/evaluation/evaluationSelectors";
import { evalRetryRequested } from "../../features/evaluation/evaluationSlice";
import type { RelicEvaluation } from "../../lib/eval-inputs/relic-select";

const selectRelicResult = selectEvalResult<RelicEvaluation>("relic_select");
const selectRelicLoading = selectEvalIsLoading("relic_select");
const selectRelicError = selectEvalError("relic_select");

interface RelicSelectViewProps {
  state: RelicSelectState;
}

export function RelicSelectView({ state }: RelicSelectViewProps) {
  const dispatch = useAppDispatch();
  const evaluation = useAppSelector(selectRelicResult);
  const isLoading = useAppSelector(selectRelicLoading);
  const error = useAppSelector(selectRelicError);
  const relics = state.relic_select.relics;
  const topPickResult = evaluation?.rankings
    ? resolveTopPick(evaluation.rankings, false)
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-100 shrink-0">Boss Relic</h2>
        {topPickResult && !isLoading && (
          <p className="text-xs font-medium text-emerald-400 truncate flex-1 text-right">
            {topPickResult.summary}
          </p>
        )}
        {isLoading && (
          <span className="text-xs text-zinc-500 animate-pulse">Evaluating...</span>
        )}
      </div>

      {error && <EvalError error={error} onRetry={() => dispatch(evalRetryRequested("relic_select"))} />}

      <div className="grid grid-cols-3 gap-3">
        {relics.map((relic, i) => {
          const evalData = evaluation?.rankings.find((r) => r.itemIndex === i);
          const isTopPick = topPickResult != null && evalData != null && evalData.itemId === topPickResult.item.itemId;

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
                <p className="text-sm text-spire-text-secondary leading-relaxed">{relic.description}</p>

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
