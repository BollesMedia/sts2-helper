import { useState } from "react";
import { cn } from "@sts2/shared/lib/cn";
import type { MapCoachEvaluation } from "../lib/eval-inputs/map";

interface BranchCardProps {
  branch: MapCoachEvaluation["keyBranches"][number];
}

export function BranchCard({ branch }: BranchCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasAlternatives = branch.alternatives.length > 0;

  return (
    <div
      className={cn(
        "rounded-lg border bg-zinc-900/60 p-2.5 text-xs leading-relaxed",
        branch.closeCall
          ? "border-amber-500/40 border-dashed"
          : "border-zinc-800",
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={!hasAlternatives}
        aria-expanded={expanded}
        className={cn(
          "block w-full text-left",
          hasAlternatives ? "cursor-pointer" : "cursor-default",
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Floor {branch.floor}
          </span>
          <span className="flex items-center gap-1.5">
            {branch.closeCall && (
              <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400">
                Close call
              </span>
            )}
            {hasAlternatives && (
              <span
                aria-hidden
                className={cn(
                  "text-zinc-500 transition-transform",
                  expanded && "rotate-90",
                )}
              >
                ▸
              </span>
            )}
          </span>
        </div>
        <p className="mt-1 font-medium text-zinc-200">{branch.decision}</p>
        <p className="mt-1 text-emerald-300">Recommend: {branch.recommended}</p>
      </button>
      {expanded && hasAlternatives && (
        <ul className="mt-1.5 space-y-0.5">
          {branch.alternatives.map((alt, i) => (
            <li key={i} className="text-zinc-500">
              <span className="text-zinc-400">▸ {alt.option}:</span> {alt.tradeoff}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
