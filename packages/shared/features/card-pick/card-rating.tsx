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
        "rounded-lg border bg-zinc-900/60 p-4 flex flex-col gap-3 relative card-depth card-depth-hover",
        isTopPick 
          ? "border-amber-500/70 ring-2 ring-amber-500/30 shadow-[0_0_20px_rgba(251,191,36,0.25),0_0_40px_rgba(251,191,36,0.1)]" 
          : border
      )}
    >
      {/* Dramatic "Pick This" banner - unmissable golden glow */}
      {isTopPick && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
          <div 
            className={cn(
              "relative px-4 py-1 rounded-full",
              "bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600",
              "text-[11px] font-bold uppercase tracking-widest text-zinc-950",
              "shadow-[0_0_16px_rgba(251,191,36,0.6),0_0_32px_rgba(251,191,36,0.3),0_2px_8px_rgba(0,0,0,0.4)]",
              "animate-pulse-glow",
              "border border-amber-400/50"
            )}
          >
            <span className="relative z-10">Pick This</span>
          </div>
        </div>
      )}

      {/* Top: tier + rank */}
      <div className={cn("flex items-start justify-between", isTopPick && "mt-2")}>
        <div className="flex items-center gap-2.5">
          {evaluation && <TierBadge tier={evaluation.tier} size="lg" glow={isTopPick} />}
          {rank != null && (
            <span className={cn(
              "text-2xl font-bold tabular-nums",
              isTopPick ? "text-amber-500/80" : "text-zinc-600"
            )}>
              #{rank}
            </span>
          )}
        </div>
        {evaluation && (
          <span className={cn(
            "rounded px-2 py-0.5 text-xs font-medium border",
            isTopPick ? "bg-amber-500/15 text-amber-400 border-amber-500/30" : chip + " border-transparent"
          )}>
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
