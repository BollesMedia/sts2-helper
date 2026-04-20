import { cn } from "@sts2/shared/lib/cn";

interface ConfidenceMeterProps {
  confidence: number;
}

/**
 * Five-dot strength meter. Denser than ConfidencePill's text chip and keeps
 * the exact numeric value on hover for curious users.
 */
export function ConfidenceMeter({ confidence }: ConfidenceMeterProps) {
  const clamped = Math.max(0, Math.min(1, confidence));
  const filled = Math.round(clamped * 5);
  const tone =
    confidence >= 0.75
      ? "bg-emerald-400"
      : confidence >= 0.5
        ? "bg-amber-400"
        : "bg-red-400";

  return (
    <span
      className="inline-flex items-center gap-0.5"
      role="img"
      aria-label={`Confidence ${clamped.toFixed(2)}`}
      title={`conf: ${clamped.toFixed(2)}`}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            i < filled ? tone : "bg-spire-border",
          )}
        />
      ))}
    </span>
  );
}
