import { cn } from "../../lib/cn";
import { TierBadge } from "../../components/tier-badge";
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
        "rounded-lg border bg-zinc-900/60 p-3 flex flex-col gap-2 relative card-depth card-depth-hover",
        isTopPick 
          ? "border-emerald-500/60 ring-2 ring-emerald-500/30 shadow-[0_0_16px_rgba(52,211,153,0.2)]" 
          : border
      )}
      title={evaluation?.reasoning}
    >
      {/* "Pick This" banner - emerald for strong pick semantic */}
      {isTopPick && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10">
          <div 
            className={cn(
              "relative px-3 py-0.5 rounded-full",
              "bg-emerald-500",
              "text-[10px] font-bold uppercase tracking-widest text-zinc-950",
              "shadow-[0_0_12px_rgba(52,211,153,0.5),0_2px_8px_rgba(0,0,0,0.4)]",
              "border border-emerald-400/50"
            )}
          >
            <span className="relative z-10">Pick This</span>
          </div>
        </div>
      )}

      {/* Top: tier + rank + chip — compact row */}
      <div className={cn("flex items-center justify-between", isTopPick && "mt-1.5")}>
        <div className="flex items-center gap-2">
          {evaluation && <TierBadge tier={evaluation.tier} size="md" glow={isTopPick} />}
          {rank != null && (
            <span className={cn(
              "text-lg font-bold tabular-nums",
              isTopPick ? "text-emerald-500/80" : "text-zinc-600"
            )}>
              #{rank}
            </span>
          )}
        </div>
        {evaluation && (
          <span className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium border",
            isTopPick ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : chip + " border-transparent"
          )}>
            {label}
          </span>
        )}
      </div>

      {/* Card name + meta — single compact block */}
      <div>
        <h3 className="font-semibold text-sm text-zinc-100 truncate">
          {card.name}
          {card.is_upgraded && (
            <span className="ml-0.5 text-emerald-400">+</span>
          )}
        </h3>
        <div className="flex items-center gap-1 text-[10px] text-zinc-500">
          <span>{card.type}</span>
          <span className="text-zinc-700">·</span>
          <span>{card.rarity}</span>
          <span className="text-zinc-700">·</span>
          <span>{card.cost}E</span>
        </div>
        {/* Card description — compact, shows damage/mechanics */}
        <p className="text-[10px] text-zinc-500 leading-snug line-clamp-1 mt-0.5">
          {card.description}
        </p>
      </div>

      {/* Reasoning — truncated to 2 lines, full text in tooltip */}
      {evaluation && (
        <p className="text-xs text-zinc-400 leading-snug line-clamp-2">
          {evaluation.reasoning}
        </p>
      )}
    </div>
  );
}
