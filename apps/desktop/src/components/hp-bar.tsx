import { cn } from "@sts2/shared/lib/cn";

interface HpBarProps {
  current: number;
  max: number;
  size?: "sm" | "md";
}

function hpColor(percent: number): string {
  if (percent > 0.6) return "bg-emerald-500";
  if (percent > 0.3) return "bg-amber-500";
  return "bg-red-500";
}

export function HpBar({ current, max, size = "md" }: HpBarProps) {
  const percent = max > 0 ? current / max : 0;

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "rounded-full bg-zinc-800 overflow-hidden",
          size === "sm" ? "h-1.5 w-14" : "h-2 w-20"
        )}
      >
        <div
          className={cn("h-full rounded-full transition-all", hpColor(percent))}
          style={{ width: `${Math.round(percent * 100)}%` }}
        />
      </div>
      <span
        className={cn(
          "font-mono tabular-nums",
          size === "sm" ? "text-xs text-zinc-400" : "text-sm text-zinc-300"
        )}
      >
        {current}/{max}
      </span>
    </div>
  );
}
