import { cn } from "@sts2/shared/lib/cn";
import { PickBanner, EvalRow, Reasoning, evalBorderClass } from "../../components/eval-card";
import type { CardEvaluation } from "@sts2/shared/evaluation/types";
import type { DetailedCard } from "@sts2/shared/types/game-state";
import type { TierLetter } from "@sts2/shared/evaluation/tier-utils";

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
  const typeColor = TYPE_COLOR[card.type] ?? "text-zinc-500";
  const rarityColor = RARITY_COLOR[card.rarity] ?? "text-zinc-500";
  const energy = (character ? CHARACTER_ENERGY[character] : undefined) ?? DEFAULT_ENERGY;

  return (
    <div
      className={cn(
        "rounded-lg border bg-spire-surface relative transition-all duration-150",
        evalBorderClass(evaluation?.recommendation, isTopPick)
      )}
      title={evaluation?.reasoning}
    >
      {isTopPick && <PickBanner />}

      <div className="p-4 pt-5 flex flex-col gap-4">
        {/* Top section: energy orb + name + meta */}
        <div className="flex items-start gap-3">
          <span className={cn(
            "shrink-0 w-6 h-6 flex items-center justify-center text-xs font-bold font-mono bg-gradient-to-br border mt-0.5",
            energy.bg, energy.text, energy.border, energy.glow
          )} style={{ clipPath: "polygon(30% 2%, 70% 2%, 98% 30%, 98% 70%, 70% 98%, 30% 98%, 2% 70%, 2% 30%)" }}>
            {card.cost}
          </span>

          <div className="min-w-0 flex-1">
            <h3 className="font-display font-semibold text-base text-spire-text truncate">
              {card.name}
              {card.is_upgraded && <span className="text-emerald-400 ml-0.5">+</span>}
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

        {/* Evaluation */}
        {evaluation && (
          <div className="pt-3 border-t border-spire-border-subtle">
            <EvalRow tier={evaluation.tier} recommendation={evaluation.recommendation} isTopPick={isTopPick} />
          </div>
        )}

        {evaluation?.reasoning && (
          <Reasoning text={evaluation.reasoning} isTopPick={isTopPick} />
        )}
      </div>
    </div>
  );
}
