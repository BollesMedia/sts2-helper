import { cn } from "@sts2/shared/lib/cn";
import { valueToTier, tierColor, tierBgColor, type TierLetter } from "@sts2/shared/evaluation/tier-utils";

interface TierBadgeProps {
  tier?: TierLetter;
  tierValue?: number;
  size?: "sm" | "md" | "lg";
}

export function TierBadge({ tier, tierValue, size = "md" }: TierBadgeProps) {
  const letter = tier ?? (tierValue != null ? valueToTier(tierValue) : "C");

  const sizeClasses = {
    sm: "h-5 w-5 text-xs",
    md: "h-7 w-7 text-sm",
    lg: "h-9 w-9 text-base",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded border font-bold",
        sizeClasses[size],
        tierColor(letter),
        tierBgColor(letter)
      )}
    >
      {letter}
    </span>
  );
}
