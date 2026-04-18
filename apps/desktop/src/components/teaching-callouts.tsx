import type { MapCoachEvaluation } from "../lib/eval-inputs/map";

interface TeachingCalloutsProps {
  callouts: MapCoachEvaluation["teachingCallouts"];
}

export function TeachingCallouts({ callouts }: TeachingCalloutsProps) {
  if (callouts.length === 0) return null;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Why this is a good path
      </h4>
      <ul className="mt-1.5 space-y-1.5 text-xs text-zinc-400 leading-relaxed">
        {callouts.map((c, i) => (
          <li key={i} className="flex gap-1.5">
            <span aria-hidden>💡</span>
            <span>{c.explanation}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
