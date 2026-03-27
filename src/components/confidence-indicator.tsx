import { cn } from "@/lib/cn";

interface ConfidenceIndicatorProps {
  confidence: number;
  showLabel?: boolean;
}

function confidenceColor(confidence: number): string {
  if (confidence >= 90) return "text-emerald-400";
  if (confidence >= 70) return "text-blue-400";
  if (confidence >= 40) return "text-amber-400";
  return "text-red-400";
}

function confidenceBarColor(confidence: number): string {
  if (confidence >= 90) return "bg-emerald-400";
  if (confidence >= 70) return "bg-blue-400";
  if (confidence >= 40) return "bg-amber-400";
  return "bg-red-400";
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 90) return "Very High";
  if (confidence >= 70) return "High";
  if (confidence >= 40) return "Medium";
  return "Low";
}

export function ConfidenceIndicator({
  confidence,
  showLabel = true,
}: ConfidenceIndicatorProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-zinc-800">
        <div
          className={cn("h-full rounded-full transition-all", confidenceBarColor(confidence))}
          style={{ width: `${confidence}%` }}
        />
      </div>
      {showLabel && (
        <span className={cn("text-xs", confidenceColor(confidence))}>
          {confidenceLabel(confidence)}
        </span>
      )}
    </div>
  );
}
