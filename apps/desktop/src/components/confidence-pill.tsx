import { cn } from "@sts2/shared/lib/cn";

export function ConfidencePill({ confidence }: { confidence: number }) {
  const rounded = confidence.toFixed(2);
  const colorClass =
    confidence >= 0.75
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/25"
      : confidence >= 0.5
        ? "text-amber-400 bg-amber-500/10 border-amber-500/25"
        : "text-red-400 bg-red-500/10 border-red-500/25";
  return (
    <span
      className={cn(
        "text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border",
        colorClass,
      )}
    >
      conf: {rounded}
    </span>
  );
}
