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

const RARITY_ACCENT: Record<string, string> = {
  Common: "from-zinc-600",
  Uncommon: "from-blue-500",
  Rare: "from-amber-500",
  Special: "from-purple-500",
  Curse: "from-red-600",
};

const TYPE_BADGE: Record<string, { label: string; color: string }> = {
  Attack: { label: "ATK", color: "text-red-400 bg-red-500/10 border-red-500/20" },
  Skill: { label: "SKL", color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  Power: { label: "PWR", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  Status: { label: "STS", color: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20" },
  Curse: { label: "CRS", color: "text-red-400 bg-red-500/10 border-red-500/20" },
};

export function CardRating({ card, evaluation, rank, isTopPick }: CardRatingProps) {
  const rec = evaluation?.recommendation;
  const chip = rec ? RECOMMENDATION_CHIP[rec] ?? RECOMMENDATION_CHIP.situational : "";
  const label = rec ? RECOMMENDATION_LABEL[rec] ?? RECOMMENDATION_LABEL.situational : "";
  const rarityGradient = RARITY_ACCENT[card.rarity] ?? RARITY_ACCENT.Common;
  const typeBadge = TYPE_BADGE[card.type] ?? TYPE_BADGE.Skill;

  return (
    <div
      className={cn(
        "rounded-lg border bg-zinc-900/70 relative overflow-hidden transition-all duration-150",
        isTopPick
          ? "border-emerald-500/60 shadow-[0_0_20px_rgba(52,211,153,0.15)]"
          : rec === "strong_pick"
            ? "border-emerald-500/40"
            : rec === "good_pick"
              ? "border-blue-500/30"
              : rec === "situational"
                ? "border-amber-500/30"
                : "border-zinc-800"
      )}
      title={evaluation?.reasoning}
    >
      {/* Rarity accent — left edge gradient */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b to-transparent",
          rarityGradient
        )}
      />

      <div className="p-3 pl-3.5">
        {/* Top pick indicator */}
        {isTopPick && (
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded border border-emerald-500/25">
              Pick This
            </span>
          </div>
        )}

        {/* Card header: name + energy cost */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-sm text-zinc-100 truncate">
              {card.name}
              {card.is_upgraded && (
                <span className="text-emerald-400 ml-0.5">+</span>
              )}
            </h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={cn("rounded border px-1 py-px text-[9px] font-semibold", typeBadge.color)}>
                {typeBadge.label}
              </span>
              <span className="text-[10px] text-zinc-600">{card.rarity}</span>
            </div>
          </div>
          {/* Energy cost chip */}
          <span className="shrink-0 rounded-md border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-xs font-bold font-mono tabular-nums text-blue-400">
            {card.cost}
          </span>
        </div>

        {/* Description */}
        <p className="mt-2 text-[10px] text-zinc-500 leading-relaxed line-clamp-2">
          {card.description}
        </p>

        {/* Evaluation row */}
        {evaluation && (
          <div className="mt-2 pt-2 border-t border-zinc-800/60 flex items-center gap-2">
            <TierBadge tier={evaluation.tier} size="sm" glow={isTopPick} />
            {rank != null && (
              <span className={cn(
                "text-sm font-bold font-mono tabular-nums",
                isTopPick ? "text-emerald-500/80" : "text-zinc-700"
              )}>
                #{rank}
              </span>
            )}
            <span className={cn(
              "rounded px-1.5 py-0.5 text-[9px] font-medium border ml-auto",
              isTopPick ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : chip + " border-transparent"
            )}>
              {label}
            </span>
          </div>
        )}

        {/* Reasoning */}
        {evaluation?.reasoning && (
          <p className={cn(
            "mt-1.5 text-[10px] leading-snug line-clamp-2",
            isTopPick ? "text-zinc-300" : "text-zinc-500"
          )}>
            {evaluation.reasoning}
          </p>
        )}
      </div>
    </div>
  );
}
