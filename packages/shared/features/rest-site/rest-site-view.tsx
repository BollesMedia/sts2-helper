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
import { RECOMMENDATION_BORDER, RECOMMENDATION_CHIP, RECOMMENDATION_LABEL } from "../../lib/recommendation-styles";

const OPTION_ICONS: Record<string, string> = {
  HEAL: "❤️",
  SMITH: "⚒️",
  LIFT: "💪",
  TOKE: "🌿",
  DIG: "⛏️",
  RECALL: "📖",
};

interface RestSiteViewProps {
  state: RestSiteState;
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
  runId: string | null;
}

export function RestSiteView({ state, deckCards, player, runId }: RestSiteViewProps) {
  const { evaluation, isLoading, error, retry } = useRestEvaluation(
    state,
    deckCards,
    player,
    runId
  );
  const restPlayer = state.rest_site.player;
  const options = state.rest_site.options;
  const topRank = evaluation?.rankings.find((r) => r.rank === 1);

  return (
    <div className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Rest Site</h2>
        {isLoading && (
          <span className="text-xs text-zinc-500 animate-pulse">Evaluating...</span>
        )}
      </div>

      {/* HP context — compact */}
      {restPlayer && (
        <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/50 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HpBar current={restPlayer.hp} max={restPlayer.max_hp} />
            <span className="text-xs text-zinc-400">
              {restPlayer.max_hp - restPlayer.hp > 0
                ? `Missing ${restPlayer.max_hp - restPlayer.hp} HP`
                : "Full health"}
            </span>
          </div>
          <span className="text-xs font-mono tabular-nums text-amber-400">
            {restPlayer.gold}g
          </span>
        </div>
      )}

      {error && <EvalError error={error} onRetry={retry} />}

      {/* Options — compact grid */}
      <div className="grid grid-cols-2 gap-3">
        {isLoading && !evaluation ? (
          <>
            {options.map((o) => <CardSkeleton key={o.index} />)}
          </>
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

            return (
              <div
                key={opt.index}
                className={cn(
                  "rounded-lg border bg-zinc-900/60 p-3 flex flex-col gap-2 relative card-depth card-depth-hover",
                  !opt.is_enabled && "opacity-50",
                  isTopPick
                    ? "border-emerald-500/60 ring-2 ring-emerald-500/30 shadow-[0_0_16px_rgba(52,211,153,0.2)]"
                    : evalData
                      ? RECOMMENDATION_BORDER[evalData.recommendation] ?? "border-zinc-800"
                      : "border-zinc-800"
                )}
                title={evalData?.reasoning}
              >
                {/* "Pick This" banner */}
                {isTopPick && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10">
                    <div className="px-3 py-0.5 rounded-full bg-emerald-500 text-[10px] font-bold uppercase tracking-widest text-zinc-950 shadow-[0_0_12px_rgba(52,211,153,0.5),0_2px_8px_rgba(0,0,0,0.4)] border border-emerald-400/50">
                      Pick This
                    </div>
                  </div>
                )}

                <div className={cn("flex items-center justify-between", isTopPick && "mt-1.5")}>
                  <div className="flex items-center gap-2">
                    {evalData && (
                      <TierBadge tier={evalData.tier as TierLetter} size="md" glow={isTopPick} />
                    )}
                    <span className="text-sm">
                      {OPTION_ICONS[opt.id] ?? "🔥"}
                    </span>
                    <h3 className="font-semibold text-sm text-zinc-100">{opt.name}</h3>
                  </div>
                  {evalData && (
                    <span className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium border",
                      isTopPick ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : RECOMMENDATION_CHIP[evalData.recommendation] + " border-transparent"
                    )}>
                      {RECOMMENDATION_LABEL[evalData.recommendation]}
                    </span>
                  )}
                </div>

                <p className="text-[10px] text-zinc-500 leading-snug line-clamp-2">
                  {opt.description}
                </p>

                {evalData && (
                  <p className="text-xs text-zinc-400 leading-snug line-clamp-2">
                    {evalData.reasoning}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
