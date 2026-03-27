import { cn } from "@/lib/cn";
import { TierBadge } from "@/components/tier-badge";
import { ConfidenceIndicator } from "@/components/confidence-indicator";
import type { CardEvaluation } from "@/evaluation/types";
import type { GameCard } from "@/lib/types/game-state";

interface CardRatingProps {
  card: GameCard;
  evaluation: CardEvaluation | null;
  rank?: number;
}

const RECOMMENDATION_STYLES: Record<string, { border: string; label: string }> = {
  strong_pick: { border: "border-emerald-500/50", label: "Strong Pick" },
  good_pick: { border: "border-blue-500/50", label: "Good Pick" },
  situational: { border: "border-amber-500/50", label: "Situational" },
  skip: { border: "border-zinc-700", label: "Skip" },
};

export function CardRating({ card, evaluation, rank }: CardRatingProps) {
  const recStyle = evaluation
    ? RECOMMENDATION_STYLES[evaluation.recommendation] ?? RECOMMENDATION_STYLES.situational
    : { border: "border-zinc-800", label: "" };

  return (
    <div
      className={cn(
        "rounded-lg border bg-zinc-900 p-4 transition-colors",
        recStyle.border
      )}
    >
      {/* Header: rank + name + tier */}
      <div className="flex items-start gap-3">
        {evaluation && <TierBadge tier={evaluation.tier} size="lg" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {rank != null && (
              <span className="text-xs font-mono text-zinc-500">#{rank}</span>
            )}
            <h3 className="font-semibold text-zinc-100 truncate">
              {card.name}
              {card.upgraded && (
                <span className="ml-1 text-emerald-400">+</span>
              )}
            </h3>
          </div>

          {/* Card info */}
          <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
            <span>{card.type}</span>
            {card.rarity && (
              <>
                <span>·</span>
                <span>{card.rarity}</span>
              </>
            )}
            <span>·</span>
            <span>{card.cost} energy</span>
            {card.star_cost != null && card.star_cost > 0 && (
              <>
                <span>+</span>
                <span>{card.star_cost} star</span>
              </>
            )}
          </div>

          {/* Card description */}
          <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
            {card.description}
          </p>

          {/* Evaluation details */}
          {evaluation && (
            <div className="mt-3 space-y-2">
              {/* Recommendation badge */}
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-xs font-medium",
                    evaluation.recommendation === "strong_pick" && "bg-emerald-400/10 text-emerald-400",
                    evaluation.recommendation === "good_pick" && "bg-blue-400/10 text-blue-400",
                    evaluation.recommendation === "situational" && "bg-amber-400/10 text-amber-400",
                    evaluation.recommendation === "skip" && "bg-zinc-700/50 text-zinc-400"
                  )}
                >
                  {recStyle.label}
                </span>
                <span className="text-xs text-zinc-500">
                  Synergy: {evaluation.synergyScore}/100
                </span>
              </div>

              {/* Reasoning */}
              <p className="text-sm text-zinc-300 leading-relaxed">
                {evaluation.reasoning}
              </p>

              {/* Confidence */}
              <ConfidenceIndicator confidence={evaluation.confidence} />

              {/* Source indicator */}
              {evaluation.source === "statistical" && (
                <span className="text-xs text-zinc-600">
                  from historical data
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
