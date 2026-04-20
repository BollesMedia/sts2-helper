import { ConfidencePill } from "./confidence-pill";

interface CoachingProps {
  coaching:
    | {
        reasoning: { deckState: string; commitment: string };
        headline: string;
        confidence: number;
        keyTradeoffs: { position: number; upside: string; downside: string }[];
        teachingCallouts: { pattern: string; explanation: string }[];
      }
    | undefined;
}

export function CardPickCoaching({ coaching }: CoachingProps) {
  if (!coaching) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-snug text-zinc-100">
            {coaching.headline}
          </h3>
          <div className="shrink-0">
            <ConfidencePill confidence={coaching.confidence} />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Why this pick
        </h4>
        <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed">
          <span className="font-semibold text-zinc-200">Deck state: </span>
          {coaching.reasoning.deckState}
        </p>
        <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed">
          <span className="font-semibold text-zinc-200">Commitment: </span>
          {coaching.reasoning.commitment}
        </p>
      </div>

      {coaching.keyTradeoffs.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Tradeoffs
          </h4>
          <ul className="mt-1.5 space-y-1 text-xs text-zinc-400 leading-relaxed">
            {coaching.keyTradeoffs.map((t, i) => (
              <li key={i}>
                <span className="text-zinc-300">▸ Card {t.position}:</span>{" "}
                <span className="text-emerald-300/90">{t.upside}</span>{" "}
                <span className="text-zinc-500">{t.downside}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {coaching.teachingCallouts.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Why this is a good pick
          </h4>
          <ul className="mt-1.5 space-y-1.5 text-xs text-zinc-400 leading-relaxed">
            {coaching.teachingCallouts.map((c, i) => (
              <li key={i} className="flex gap-1.5">
                <span aria-hidden>💡</span>
                <span>{c.explanation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
