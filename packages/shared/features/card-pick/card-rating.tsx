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

const TYPE_BADGE: Record<string, { label: string; color: string }> = {
  Attack: { label: "Attack", color: "text-red-400 bg-red-500/10 border-red-500/20" },
  Skill: { label: "Skill", color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  Power: { label: "Power", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  Status: { label: "Status", color: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20" },
  Curse: { label: "Curse", color: "text-red-400 bg-red-500/10 border-red-500/20" },
};

const RARITY_COLOR: Record<string, string> = {
  Common: "text-zinc-500",
  Uncommon: "text-blue-400",
  Rare: "text-amber-400",
  Special: "text-purple-400",
  Curse: "text-red-500",
};

export function CardRating({ card, evaluation, rank, isTopPick }: CardRatingProps) {
  const rec = evaluation?.recommendation;
  const chip = rec ? RECOMMENDATION_CHIP[rec] ?? RECOMMENDATION_CHIP.situational : "";
  const label = rec ? RECOMMENDATION_LABEL[rec] ?? RECOMMENDATION_LABEL.situational : "";
  const typeBadge = TYPE_BADGE[card.type] ?? TYPE_BADGE.Skill;
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
      {/* Pick This — absolutely positioned so cards align vertically */}
      {isTopPick && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10">
          <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/15 px-2.5 py-0.5 rounded-full border border-emerald-500/25 whitespace-nowrap shadow-[0_0_8px_rgba(52,211,153,0.3)]">
            Pick This
          </span>
        </div>
      )}

      <div className="p-3.5 pt-4 space-y-3">
        {/* Card header: name + energy cost */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-sm text-spire-text truncate">
              {card.name}
              {card.is_upgraded && (
                <span className="text-emerald-400 ml-0.5">+</span>
              )}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium", typeBadge.color)}>
                {typeBadge.label}
              </span>
              <span className={cn("text-[10px] font-medium", rarityColor)}>{card.rarity}</span>
            </div>
          </div>
          {/* Energy cost */}
          <span className="shrink-0 rounded-md border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-xs font-bold font-mono tabular-nums text-blue-400">
            {card.cost}E
          </span>
        </div>

        {/* Description */}
        <p className="text-xs text-spire-text-secondary leading-relaxed line-clamp-2">
          {card.description}
        </p>

        {/* Evaluation row */}
        {evaluation && (
          <div className="pt-2.5 border-t border-spire-border-subtle flex items-center gap-2">
            <TierBadge tier={evaluation.tier} size="sm" glow={isTopPick} />
            {rank != null && (
              <span className={cn(
                "text-sm font-bold font-mono tabular-nums",
                isTopPick ? "text-emerald-500/80" : "text-spire-text-muted"
              )}>
                #{rank}
              </span>
            )}
            <span className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium border ml-auto",
              isTopPick ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : chip + " border-transparent"
            )}>
              {label}
            </span>
          </div>
        )}

        {/* Reasoning — readable size */}
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
