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
  character?: string;
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

const CHARACTER_ENERGY: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  "The Ironclad":    { bg: "from-red-600/85 to-red-800/85",       text: "text-white",  border: "border-red-400/40",    glow: "shadow-[0_0_6px_rgba(239,68,68,0.3)]" },
  "The Silent":      { bg: "from-green-600/85 to-green-800/85",    text: "text-white",  border: "border-green-400/40",  glow: "shadow-[0_0_6px_rgba(34,197,94,0.3)]" },
  "The Defect":      { bg: "from-blue-500/85 to-blue-700/85",      text: "text-white",  border: "border-blue-400/40",   glow: "shadow-[0_0_6px_rgba(59,130,246,0.3)]" },
  "The Necrobinder":  { bg: "from-purple-600/85 to-purple-800/85", text: "text-white",  border: "border-purple-400/40", glow: "shadow-[0_0_6px_rgba(168,85,247,0.3)]" },
  "The Regent":      { bg: "from-cyan-500/85 to-cyan-700/85",      text: "text-white",  border: "border-cyan-400/40",   glow: "shadow-[0_0_6px_rgba(34,211,238,0.3)]" },
};

const DEFAULT_ENERGY = { bg: "from-zinc-500 to-zinc-700", text: "text-white", border: "border-zinc-400/50", glow: "" };

export function CardRating({ card, evaluation, isTopPick, character }: CardRatingProps) {
  const rec = evaluation?.recommendation;
  const chip = rec ? RECOMMENDATION_CHIP[rec] ?? RECOMMENDATION_CHIP.situational : "";
  const label = rec ? RECOMMENDATION_LABEL[rec] ?? RECOMMENDATION_LABEL.situational : "";
  const typeColor = TYPE_COLOR[card.type] ?? "text-zinc-500";
  const rarityColor = RARITY_COLOR[card.rarity] ?? "text-zinc-500";
  const energy = (character ? CHARACTER_ENERGY[character] : undefined) ?? DEFAULT_ENERGY;

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

      <div className="p-4 pt-5 flex flex-col gap-4">
        {/* Top section: energy orb (top-left like game) + name + meta */}
        <div className="flex items-start gap-3">
          {/* Energy orb — top-left, octagon */}
          <span className={cn(
            "shrink-0 w-6 h-6 flex items-center justify-center text-xs font-bold font-mono bg-gradient-to-br border mt-0.5",
            energy.bg, energy.text, energy.border, energy.glow
          )} style={{ clipPath: "polygon(30% 2%, 70% 2%, 98% 30%, 98% 70%, 70% 98%, 30% 98%, 2% 70%, 2% 30%)" }}>
            {card.cost}
          </span>

          <div className="min-w-0 flex-1">
            <h3 className="font-display font-semibold text-base text-spire-text truncate">
              {card.name}
              {card.is_upgraded && (
                <span className="text-emerald-400 ml-0.5">+</span>
              )}
            </h3>
            <span className="text-[11px]">
              <span className={rarityColor}>{card.rarity}</span>
              <span className="text-spire-text-muted mx-1">/</span>
              <span className={typeColor}>{card.type}</span>
            </span>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-spire-text-secondary leading-relaxed line-clamp-2">
          {card.description}
        </p>

        {/* Evaluation — tier + recommendation */}
        {evaluation && (
          <div className="flex items-center gap-2 pt-3 border-t border-spire-border-subtle">
            <TierBadge tier={evaluation.tier} size="md" glow={isTopPick} />
            <span className={cn(
              "rounded px-2 py-1 text-xs font-medium border",
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
