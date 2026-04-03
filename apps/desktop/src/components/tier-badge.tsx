import { cn } from "@sts2/shared/lib/cn";
import { valueToTier, tierColor, tierBgColor, type TierLetter } from "@sts2/shared/evaluation/tier-utils";

interface TierBadgeProps {
  tier?: TierLetter;
  tierValue?: number;
  size?: "sm" | "md" | "lg";
  glow?: boolean;
}

// Tier-specific glow effects
const tierGlow: Record<TierLetter, string> = {
  S: "shadow-[0_0_8px_rgba(52,211,153,0.5),0_0_16px_rgba(52,211,153,0.25)]",
  A: "shadow-[0_0_6px_rgba(59,130,246,0.4),0_0_12px_rgba(59,130,246,0.2)]",
  B: "shadow-[0_0_4px_rgba(251,191,36,0.3)]",
  C: "",
  D: "",
  F: "",
};

export function TierBadge({ tier, tierValue, size = "md", glow = false }: TierBadgeProps) {
  const letter = tier ?? (tierValue != null ? valueToTier(tierValue) : "C");

  const sizeClasses = {
    sm: "h-5 w-5 text-xs",
    md: "h-7 w-7 text-sm",
    lg: "h-9 w-9 text-base",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded border font-bold transition-shadow duration-200",
        sizeClasses[size],
        tierColor(letter),
        tierBgColor(letter),
        glow && tierGlow[letter]
      )}
    >
      {letter}
    </span>
  );
}
