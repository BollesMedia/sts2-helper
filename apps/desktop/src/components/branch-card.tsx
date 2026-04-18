import { cn } from "@sts2/shared/lib/cn";
import type { MapCoachEvaluation } from "../lib/eval-inputs/map";

interface BranchCardProps {
  branch: MapCoachEvaluation["keyBranches"][number];
}

export function BranchCard({ branch }: BranchCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-zinc-900/60 p-2.5 text-xs leading-relaxed",
        branch.closeCall
          ? "border-amber-500/40 border-dashed"
          : "border-zinc-800",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Floor {branch.floor}
        </span>
        {branch.closeCall && (
          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400">
            Close call
          </span>
        )}
      </div>
      <p className="mt-1 font-medium text-zinc-200">{branch.decision}</p>
      <p className="mt-1 text-emerald-300">Recommend: {branch.recommended}</p>
      <ul className="mt-1.5 space-y-0.5">
        {branch.alternatives.map((alt, i) => (
          <li key={i} className="text-zinc-500">
            <span className="text-zinc-400">▸ {alt.option}:</span> {alt.tradeoff}
          </li>
        ))}
      </ul>
    </div>
  );
}
