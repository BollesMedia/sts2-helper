/**
 * Shared evaluation display patterns used across card rewards,
 * rest site, events, relic select, and map sidebar.
 *
 * Consolidates: Pick This banner, tier + recommendation row,
 * reasoning text, and card border styling.
 */

import { cn } from "@sts2/shared/lib/cn";
import { TierBadge } from "./tier-badge";
import { RECOMMENDATION_CHIP, RECOMMENDATION_LABEL } from "@sts2/shared/lib/recommendation-styles";
import type { TierLetter } from "@sts2/shared/evaluation/tier-utils";

// --- Pick This banner ---

export function PickBanner() {
  return (
    <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
      <span className="text-[10px] font-bold text-emerald-950 bg-emerald-400 px-3 py-0.5 rounded-full whitespace-nowrap shadow-[0_0_12px_rgba(52,211,153,0.4)]">
        Pick This
      </span>
    </div>
  );
}

// --- Tier + recommendation row ---

interface EvalRowProps {
  tier: TierLetter;
  recommendation: string;
  isTopPick?: boolean;
}

export function EvalRow({ tier, recommendation, isTopPick }: EvalRowProps) {
  const chip = RECOMMENDATION_CHIP[recommendation] ?? RECOMMENDATION_CHIP.situational;
  const label = RECOMMENDATION_LABEL[recommendation] ?? RECOMMENDATION_LABEL.situational;

  return (
    <div className="flex items-center gap-2">
      <TierBadge tier={tier} size="md" glow={isTopPick} />
      <span className={cn(
        "rounded px-2 py-0.5 text-xs font-medium border",
        isTopPick ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : chip + " border-transparent"
      )}>
        {label}
      </span>
    </div>
  );
}

// --- Reasoning text ---

interface ReasoningProps {
  text: string;
  isTopPick?: boolean;
}

export function Reasoning({ text, isTopPick }: ReasoningProps) {
  return (
    <p className={cn(
      "text-sm leading-relaxed line-clamp-2",
      isTopPick ? "text-spire-text-secondary" : "text-spire-text-tertiary"
    )}>
      {text}
    </p>
  );
}

// --- Card border class ---

export function evalBorderClass(recommendation?: string, isTopPick?: boolean): string {
  if (isTopPick) return "border-emerald-500/60 shadow-[0_0_20px_rgba(52,211,153,0.15)]";
  switch (recommendation) {
    case "strong_pick": return "border-emerald-500/40";
    case "good_pick": return "border-blue-500/30";
    case "situational": return "border-amber-500/30";
    default: return "border-spire-border";
  }
}

// --- Top pick detection (by highest tier) ---

export function findTopPick<T extends { tier: string }>(rankings: T[]): T | null {
  if (!rankings.length) return null;
  const tierOrder = ["S", "A", "B", "C", "D", "F"];
  return rankings.reduce((best, r) => {
    const bestTier = tierOrder.indexOf(best.tier);
    const rTier = tierOrder.indexOf(r.tier);
    return rTier < bestTier ? r : best;
  });
}
