"use client";

import { cn } from "@sts2/shared/lib/cn";
import { TierBadge } from "@sts2/shared/components/tier-badge";
import { ConfidenceIndicator } from "@sts2/shared/components/confidence-indicator";
import { HpBar } from "@sts2/shared/components/hp-bar";
import type { RestSiteState, CombatCard } from "@sts2/shared/types/game-state";
import type { TrackedPlayer } from "@sts2/shared/features/connection/use-player-tracker";
import type { TierLetter } from "@sts2/shared/evaluation/tier-utils";
import { useRestEvaluation } from "./use-rest-evaluation";
import { CardSkeleton } from "@sts2/shared/components/loading-skeleton";
import { RefineInput } from "@sts2/shared/components/refine-input";
import { EvalError } from "@sts2/shared/components/eval-error";
import { RECOMMENDATION_BORDER, RECOMMENDATION_CHIP, RECOMMENDATION_LABEL } from "@sts2/shared/lib/recommendation-styles";

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold text-zinc-100">Rest Site</h2>
        {isLoading && (
          <span className="text-xs text-zinc-500 animate-pulse">
            Evaluating...
          </span>
        )}
        {evaluation && !isLoading && (
          <span className="text-xs text-zinc-600">Claude evaluation</span>
        )}
      </div>

      {/* HP context */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <HpBar current={restPlayer.hp} max={restPlayer.max_hp} />
          <span className="text-sm text-zinc-400">
            {restPlayer.max_hp - restPlayer.hp > 0
              ? `Missing ${restPlayer.max_hp - restPlayer.hp} HP`
              : "Full health"}
          </span>
        </div>
        <span className="text-sm font-mono tabular-nums text-amber-400">
          {restPlayer.gold}g
        </span>
      </div>

      {error && <EvalError error={error} onRetry={retry} />}

      {/* Options */}
      <div className="grid grid-cols-2 gap-4">
        {isLoading && !evaluation ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          options.map((opt) => {
            const evalData = evaluation?.rankings.find(
              (r) =>
                r.itemIndex === opt.index ||
                r.itemId.toLowerCase() === opt.id.toLowerCase() ||
                r.itemName.toLowerCase() === opt.name.toLowerCase()
            );

            return (
              <div
                key={opt.index}
                className={cn(
                  "rounded-lg border bg-zinc-900/50 p-4 flex flex-col gap-3 transition-colors",
                  !opt.is_enabled && "opacity-50",
                  evalData
                    ? RECOMMENDATION_BORDER[evalData.recommendation] ?? "border-zinc-800"
                    : "border-zinc-800"
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    {evalData && (
                      <TierBadge tier={evalData.tier as TierLetter} size="lg" />
                    )}
                    <span className="text-xl">
                      {OPTION_ICONS[opt.id] ?? "🔥"}
                    </span>
                    <h3 className="font-semibold text-zinc-100">{opt.name}</h3>
                  </div>
                  {evalData && (
                    <span className={cn("rounded px-2 py-0.5 text-xs font-medium", RECOMMENDATION_CHIP[evalData.recommendation])}>
                      {RECOMMENDATION_LABEL[evalData.recommendation]}
                    </span>
                  )}
                </div>

                <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-line">
                  {opt.description}
                </p>

                {evalData && (
                  <div className="border-t border-zinc-800 pt-3 space-y-2">
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <ConfidenceIndicator confidence={evalData.confidence} showLabel={false} />
                    </div>
                    <p className="text-sm text-zinc-300 leading-relaxed">
                      {evalData.reasoning}
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {evaluation && !isLoading && (
        <RefineInput
          originalContext={`Rest site. HP: ${restPlayer.hp}/${restPlayer.max_hp}. Options: ${options.map((o) => o.name).join(", ")}.`}
          originalResponse={evaluation.rankings.map((r) => `#${r.rank} ${r.itemName}: ${r.reasoning}`).join(" ")}
        />
      )}
    </div>
  );
}
