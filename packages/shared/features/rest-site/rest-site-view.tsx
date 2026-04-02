"use client";

import { cn } from "../../lib/cn";
import { HpBar } from "../../components/hp-bar";
import { PickBanner, EvalRow, Reasoning, evalBorderClass, findTopPick } from "../../components/eval-card";
import type { RestSiteState, CombatCard } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { TierLetter } from "../../evaluation/tier-utils";
import { useRestEvaluation } from "./use-rest-evaluation";
import { CardSkeleton } from "../../components/loading-skeleton";
import { EvalError } from "../../components/eval-error";

const OPTION_ICONS: Record<string, string> = {
  HEAL: "\u2764\ufe0f",
  SMITH: "\u2692\ufe0f",
  LIFT: "\ud83d\udcaa",
  TOKE: "\ud83c\udf3f",
  DIG: "\u26cf\ufe0f",
  RECALL: "\ud83d\udcd6",
  MEND: "\ud83e\ude7a",
  REVIVE: "\u2728",
};

const OPTION_ACCENT: Record<string, string> = {
  HEAL: "from-red-500",
  SMITH: "from-blue-500",
  LIFT: "from-amber-500",
  TOKE: "from-emerald-500",
  DIG: "from-purple-500",
  RECALL: "from-cyan-500",
  MEND: "from-pink-500",
  REVIVE: "from-amber-400",
};

interface RestSiteViewProps {
  state: RestSiteState;
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
  runId: string | null;
}

export function RestSiteView({ state, deckCards, player, runId }: RestSiteViewProps) {
  const { evaluation, isLoading, error, retry } = useRestEvaluation(
    state, deckCards, player, runId
  );
  const restPlayer = state.player ?? state.rest_site?.player;
  const options = state.rest_site.options;
  const topPick = evaluation?.rankings ? findTopPick(evaluation.rankings) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-display font-bold text-spire-text">Rest Site</h2>
        {isLoading && (
          <span className="text-[10px] font-mono text-spire-text-muted bg-spire-elevated/50 px-2 py-0.5 rounded border border-spire-border animate-pulse">
            Evaluating...
          </span>
        )}
      </div>

      {restPlayer && (
        <div className="rounded-lg border border-spire-border bg-spire-surface px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HpBar current={restPlayer.hp} max={restPlayer.max_hp} />
            <span className="text-[10px] text-spire-text-tertiary">
              {restPlayer.max_hp - restPlayer.hp > 0
                ? `${restPlayer.max_hp - restPlayer.hp} HP missing`
                : "Full health"}
            </span>
          </div>
          <span className="text-xs font-mono tabular-nums text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
            {restPlayer.gold}g
          </span>
        </div>
      )}

      {error && <EvalError error={error} onRetry={retry} />}

      <div className="grid grid-cols-2 gap-2">
        {isLoading && !evaluation ? (
          options.map((o) => <CardSkeleton key={o.index} />)
        ) : (
          options.map((opt) => {
            const evalData = evaluation?.rankings.find(
              (r) =>
                r.itemIndex === opt.index ||
                r.itemId.toLowerCase() === opt.id.toLowerCase() ||
                r.itemName.toLowerCase() === opt.name.toLowerCase()
            );
            const isTopPick = topPick === evalData && evalData != null;
            const accent = OPTION_ACCENT[opt.id] ?? "from-zinc-600";

            return (
              <div
                key={opt.index}
                className={cn(
                  "rounded-lg border bg-spire-surface relative overflow-hidden transition-all duration-150",
                  !opt.is_enabled && "opacity-40",
                  evalBorderClass(evalData?.recommendation, isTopPick)
                )}
                title={evalData?.reasoning}
              >
                {/* Accent edge */}
                <div className={cn("absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b to-transparent", accent)} />

                {isTopPick && <PickBanner />}

                <div className="p-4 pt-5 pl-3.5 flex flex-col gap-3">
                  {/* Header */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{OPTION_ICONS[opt.id] ?? "\ud83d\udd25"}</span>
                    <h3 className="font-display font-semibold text-sm text-spire-text">{opt.name}</h3>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-spire-text-tertiary leading-relaxed line-clamp-2">
                    {opt.description}
                  </p>

                  {/* Evaluation */}
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
          })
        )}
      </div>
    </div>
  );
}
