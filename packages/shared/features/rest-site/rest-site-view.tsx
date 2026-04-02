"use client";

import { cn } from "../../lib/cn";
import { TierBadge } from "../../components/tier-badge";
import { HpBar } from "../../components/hp-bar";
import type { RestSiteState, CombatCard } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { TierLetter } from "../../evaluation/tier-utils";
import { useRestEvaluation } from "./use-rest-evaluation";
import { CardSkeleton } from "../../components/loading-skeleton";
import { EvalError } from "../../components/eval-error";
import { RECOMMENDATION_CHIP, RECOMMENDATION_LABEL } from "../../lib/recommendation-styles";

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
  const restPlayer = state.rest_site.player;
  const options = state.rest_site.options;
  const topRank = evaluation?.rankings.find((r) => r.rank === 1);

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-zinc-100 uppercase tracking-wide">Rest Site</h2>
        {isLoading && (
          <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900/80 px-2 py-0.5 rounded border border-zinc-800 animate-pulse">
            Evaluating...
          </span>
        )}
      </div>

      {/* HP context */}
      {restPlayer && (
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/60 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HpBar current={restPlayer.hp} max={restPlayer.max_hp} />
            <span className="text-[10px] text-zinc-500">
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

      {/* Options */}
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
            const isTopPick = topRank?.itemIndex === opt.index ||
              topRank?.itemId.toLowerCase() === opt.id.toLowerCase() ||
              topRank?.itemName.toLowerCase() === opt.name.toLowerCase();

            const rec = evalData?.recommendation;
            const accent = OPTION_ACCENT[opt.id] ?? "from-zinc-600";

            return (
              <div
                key={opt.index}
                className={cn(
                  "rounded-lg border bg-zinc-900/70 relative overflow-hidden transition-all duration-150",
                  !opt.is_enabled && "opacity-40",
                  isTopPick
                    ? "border-emerald-500/50 shadow-[0_0_16px_rgba(52,211,153,0.12)]"
                    : rec === "strong_pick"
                      ? "border-emerald-500/40"
                      : rec === "good_pick"
                        ? "border-blue-500/30"
                        : "border-zinc-800"
                )}
                title={evalData?.reasoning}
              >
                {/* Option accent edge */}
                <div className={cn("absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b to-transparent", accent)} />

                <div className="p-3 pl-3.5">
                  {/* Top pick banner */}
                  {isTopPick && (
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded border border-emerald-500/25">
                        Pick This
                      </span>
                    </div>
                  )}

                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {evalData && (
                        <TierBadge tier={evalData.tier as TierLetter} size="sm" glow={isTopPick} />
                      )}
                      <span className="text-sm">{OPTION_ICONS[opt.id] ?? "\ud83d\udd25"}</span>
                      <h3 className="font-semibold text-sm text-zinc-100">{opt.name}</h3>
                    </div>
                    {rec && (
                      <span className={cn(
                        "rounded px-1.5 py-0.5 text-[9px] font-medium border",
                        isTopPick ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : RECOMMENDATION_CHIP[rec] + " border-transparent"
                      )}>
                        {RECOMMENDATION_LABEL[rec]}
                      </span>
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-[10px] text-zinc-500 leading-snug line-clamp-2 mt-1.5">
                    {opt.description}
                  </p>

                  {/* Reasoning */}
                  {evalData?.reasoning && (
                    <p className={cn(
                      "mt-1.5 text-[10px] leading-snug line-clamp-2",
                      isTopPick ? "text-zinc-300" : "text-zinc-500"
                    )}>
                      {evalData.reasoning}
                    </p>
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
