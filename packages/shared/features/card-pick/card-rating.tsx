import { cn } from "../../lib/cn";
import { TierBadge } from "../../components/tier-badge";
import { ConfidenceIndicator } from "../../components/confidence-indicator";
import { RECOMMENDATION_BORDER, RECOMMENDATION_CHIP, RECOMMENDATION_LABEL } from "../../lib/recommendation-styles";
import type { CardEvaluation } from "../../evaluation/types";
import type { DetailedCard } from "../../types/game-state";

interface CardRatingProps {
  card: DetailedCard;
  evaluation: CardEvaluation | null;
  rank?: number;
  isTopPick?: boolean;
}

export function CardRating({ card, evaluation, rank, isTopPick }: CardRatingProps) {
  const rec = evaluation?.recommendation;
  const border = rec ? RECOMMENDATION_BORDER[rec] ?? RECOMMENDATION_BORDER.situational : "border-zinc-800";
  const chip = rec ? RECOMMENDATION_CHIP[rec] ?? RECOMMENDATION_CHIP.situational : "";
  const label = rec ? RECOMMENDATION_LABEL[rec] ?? RECOMMENDATION_LABEL.situational : "";

  return (
    <div
      className={cn(
        "rounded-lg border bg-zinc-900/50 p-4 transition-colors flex flex-col gap-3 relative",
        isTopPick ? "border-emerald-500/60 ring-1 ring-emerald-500/20" : border
      )}
    >
      {/* Recommended banner */}
      {isTopPick && (
        <div className="absolute -top-2.5 left-3 rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-950">
          Pick this
        </div>
      )}

      {/* Top: tier + rank */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          {evaluation && <TierBadge tier={evaluation.tier} size="lg" />}
          {rank != null && (
            <span className="text-2xl font-bold tabular-nums text-zinc-600">
              #{rank}
            </span>
          )}
        </div>
        {evaluation && (
          <span className={cn("rounded px-2 py-0.5 text-xs font-medium", chip)}>
            {label}
          </span>
        )}
      </div>

      {/* Card info */}
      <div>
        <h3 className="font-semibold text-zinc-100">
          {card.name}
          {card.is_upgraded && (
            <span className="ml-0.5 text-emerald-400">+</span>
          )}
        </h3>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
          <span>{card.type}</span>
          <span className="text-zinc-700">·</span>
          <span>{card.rarity}</span>
          <span className="text-zinc-700">·</span>
          <span>{card.cost}E</span>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-zinc-400 leading-relaxed">
        {card.description}
      </p>

      {/* Evaluation */}
      {evaluation && (
        <div className="border-t border-zinc-800 pt-3 space-y-2">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>Synergy {evaluation.synergyScore}</span>
            <span className="text-zinc-700">·</span>
            <ConfidenceIndicator confidence={evaluation.confidence} showLabel={false} />
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed">
            {evaluation.reasoning}
          </p>
        </div>
      )}
    </div>
  );
}
