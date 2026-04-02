import { cn } from "../../lib/cn";
import { TierBadge } from "../../components/tier-badge";
import { RECOMMENDATION_CHIP, RECOMMENDATION_LABEL } from "../../lib/recommendation-styles";
import type { CardEvaluation } from "../../evaluation/types";
import type { DetailedCard } from "../../types/game-state";

interface CardRatingProps {
  card: DetailedCard;
  evaluation: CardEvaluation | null;
  rank?: number;
  isTopPick?: boolean;
}

const TYPE_COLOR: Record<string, string> = {
  Attack: "text-red-400",
  Skill: "text-blue-400",
  Power: "text-amber-400",
  Status: "text-zinc-500",
  Curse: "text-red-500",
};

const RARITY_COLOR: Record<string, string> = {
  Common: "text-zinc-500",
  Uncommon: "text-blue-400",
  Rare: "text-amber-400",
  Special: "text-purple-400",
  Curse: "text-red-500",
};

export function CardRating({ card, evaluation, isTopPick }: CardRatingProps) {
  const rec = evaluation?.recommendation;
  const chip = rec ? RECOMMENDATION_CHIP[rec] ?? RECOMMENDATION_CHIP.situational : "";
  const label = rec ? RECOMMENDATION_LABEL[rec] ?? RECOMMENDATION_LABEL.situational : "";
  const typeColor = TYPE_COLOR[card.type] ?? "text-zinc-500";
  const rarityColor = RARITY_COLOR[card.rarity] ?? "text-zinc-500";

  return (
    <div
      className={cn(
        "rounded-lg border bg-spire-surface relative transition-all duration-150",
        isTopPick
          ? "border-emerald-500/60 shadow-[0_0_20px_rgba(52,211,153,0.15)]"
          : rec === "strong_pick"
            ? "border-emerald-500/40"
            : rec === "good_pick"
              ? "border-blue-500/30"
              : rec === "situational"
                ? "border-amber-500/30"
                : "border-spire-border"
      )}
      title={evaluation?.reasoning}
    >
      {/* Pick This — solid background, centered above card */}
      {isTopPick && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
          <span className="text-[10px] font-bold text-emerald-950 bg-emerald-400 px-3 py-0.5 rounded-full whitespace-nowrap shadow-[0_0_12px_rgba(52,211,153,0.4)]">
            Pick This
          </span>
        </div>
      )}

      <div className="p-4 pt-5 flex flex-col gap-3">
        {/* Card header: name + energy cost */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-base text-spire-text truncate">
              {card.name}
              {card.is_upgraded && (
                <span className="text-emerald-400 ml-0.5">+</span>
              )}
            </h3>
            {/* Type + Rarity merged into one line */}
            <span className="text-[11px]">
              <span className={rarityColor}>{card.rarity}</span>
              <span className="text-spire-text-muted mx-1">/</span>
              <span className={typeColor}>{card.type}</span>
            </span>
          </div>
          {/* Energy cost */}
          <span className="shrink-0 rounded-md border border-blue-500/30 bg-blue-500/10 w-8 h-8 flex items-center justify-center text-sm font-bold font-mono text-blue-400">
            {card.cost}
          </span>
        </div>

        {/* Description */}
        <p className="text-sm text-spire-text-secondary leading-relaxed line-clamp-2">
          {card.description}
        </p>

        {/* Evaluation — tier + recommendation on one line */}
        {evaluation && (
          <div className="flex items-center gap-2 pt-3 border-t border-spire-border-subtle">
            <TierBadge tier={evaluation.tier} size="sm" glow={isTopPick} />
            <span className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium border",
              isTopPick ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : chip + " border-transparent"
            )}>
              {label}
            </span>
          </div>
        )}

        {/* Reasoning */}
        {evaluation?.reasoning && (
          <p className={cn(
            "text-sm leading-relaxed line-clamp-2",
            isTopPick ? "text-spire-text-secondary" : "text-spire-text-tertiary"
          )}>
            {evaluation.reasoning}
          </p>
        )}
      </div>
    </div>
  );
}
