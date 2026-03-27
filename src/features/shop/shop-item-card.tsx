import { cn } from "@/lib/cn";
import { TierBadge } from "@/components/tier-badge";
import { ConfidenceIndicator } from "@/components/confidence-indicator";
import type { CardEvaluation } from "@/evaluation/types";

interface ShopItemCardProps {
  name: string;
  description: string;
  cost: number;
  type: string;
  rarity?: string;
  affordable: boolean;
  onSale?: boolean;
  evaluation: CardEvaluation | null;
  rank?: number;
}

const RECOMMENDATION_STYLES: Record<string, { border: string; label: string }> = {
  strong_pick: { border: "border-emerald-500/50", label: "Strong Pick" },
  good_pick: { border: "border-blue-500/50", label: "Good Pick" },
  situational: { border: "border-amber-500/50", label: "Situational" },
  skip: { border: "border-zinc-700", label: "Skip" },
};

const TYPE_COLORS: Record<string, string> = {
  Attack: "text-red-400",
  Skill: "text-blue-400",
  Power: "text-amber-400",
  Relic: "text-purple-400",
  Potion: "text-emerald-400",
  Service: "text-cyan-400",
};

export function ShopItemCard({
  name,
  description,
  cost,
  type,
  rarity,
  affordable,
  onSale,
  evaluation,
  rank,
}: ShopItemCardProps) {
  const recStyle = evaluation
    ? RECOMMENDATION_STYLES[evaluation.recommendation] ?? RECOMMENDATION_STYLES.situational
    : { border: "border-zinc-800", label: "" };

  return (
    <div
      className={cn(
        "rounded-lg border bg-zinc-900 p-3 transition-colors",
        recStyle.border,
        !affordable && "opacity-50"
      )}
    >
      <div className="flex items-start gap-3">
        {evaluation && <TierBadge tier={evaluation.tier} size="md" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {rank != null && (
                <span className="text-xs font-mono text-zinc-500">#{rank}</span>
              )}
              <h3 className="font-semibold text-zinc-100 truncate text-sm">
                {name}
              </h3>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {onSale && (
                <span className="text-xs text-emerald-400">SALE</span>
              )}
              <span
                className={cn(
                  "text-sm font-medium",
                  affordable ? "text-amber-400" : "text-zinc-600"
                )}
              >
                {cost}g
              </span>
            </div>
          </div>

          <div className="mt-0.5 flex items-center gap-2 text-xs">
            <span className={TYPE_COLORS[type] ?? "text-zinc-500"}>
              {type}
            </span>
            {rarity && (
              <>
                <span className="text-zinc-700">·</span>
                <span className="text-zinc-500">{rarity}</span>
              </>
            )}
          </div>

          <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
            {description}
          </p>

          {evaluation && (
            <div className="mt-2 space-y-1.5">
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
                  Synergy: {evaluation.synergyScore}
                </span>
              </div>

              <p className="text-xs text-zinc-300 leading-relaxed">
                {evaluation.reasoning}
              </p>

              <ConfidenceIndicator confidence={evaluation.confidence} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
