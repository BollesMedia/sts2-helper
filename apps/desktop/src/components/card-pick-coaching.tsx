import { useState, useEffect } from "react";
import { cn } from "@sts2/shared/lib/cn";
import { ConfidenceMeter } from "./confidence-meter";

interface Coaching {
  reasoning: { deckState: string; commitment: string };
  headline: string;
  confidence: number;
  keyTradeoffs: { position: number; upside: string; downside: string }[];
  teachingCallouts: { pattern: string; explanation: string }[];
}

interface CoachingProps {
  coaching: Coaching | undefined;
}

// Split headline at the first sentence. The verdict clause leads; any follow-up
// clause is a compact one-line reason under it.
function splitHeadline(headline: string): {
  verdict: string;
  reason: string | null;
} {
  const match = /^([^.!?]+[.!?])\s*(.*)$/.exec(headline.trim());
  if (!match) return { verdict: headline.trim(), reason: null };
  const reason = match[2].trim();
  return { verdict: match[1].trim(), reason: reason.length > 0 ? reason : null };
}

function TradeoffRow({
  tradeoff,
}: {
  tradeoff: Coaching["keyTradeoffs"][number];
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="block w-full text-left"
      >
        <div className="grid grid-cols-[4.5rem_1fr_auto] items-baseline gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-spire-text-tertiary">
            Card {tradeoff.position}
          </span>
          <span className="text-[13px] leading-[1.55] text-emerald-300/90">
            {tradeoff.upside}
          </span>
          <span
            aria-hidden
            className={cn(
              "text-spire-text-tertiary transition-transform",
              open && "rotate-90",
            )}
          >
            ▸
          </span>
        </div>
      </button>
      {open && (
        <p className="mt-1 pl-[5rem] text-[13px] leading-[1.55] text-spire-text-tertiary">
          {tradeoff.downside}
        </p>
      )}
    </li>
  );
}

export function CardPickCoaching({ coaching }: CoachingProps) {
  const initiallyOpen = (coaching?.confidence ?? 1) < 0.6;
  const [open, setOpen] = useState(initiallyOpen);

  // Resync disclosure state when a new eval swaps in.
  useEffect(() => {
    setOpen(initiallyOpen);
  }, [initiallyOpen]);

  if (!coaching) return null;

  const { verdict, reason } = splitHeadline(coaching.headline);
  const hasTradeoffs = coaching.keyTradeoffs.length > 0;
  const hasCallouts = coaching.teachingCallouts.length > 0;
  const notesCount = coaching.keyTradeoffs.length + coaching.teachingCallouts.length;

  return (
    <div className="flex flex-col gap-2">
      {/* Verdict banner — always visible. Outfit display for the verdict line;
          DM Sans body for the one-liner below. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[17px] font-bold leading-tight tracking-tight text-spire-text">
            {verdict}
          </h3>
          {reason && (
            <p className="mt-1 text-[13px] leading-[1.55] text-spire-text-secondary">
              {reason}
            </p>
          )}
        </div>
        <div className="shrink-0 pt-1.5">
          <ConfidenceMeter confidence={coaching.confidence} />
        </div>
      </div>

      {/* Single progressive-disclosure toggle for everything else */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 self-start text-[10px] font-semibold uppercase tracking-[0.12em] text-spire-text-tertiary transition-colors hover:text-spire-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400/60"
      >
        <span
          aria-hidden
          className={cn("transition-transform", open && "rotate-90")}
        >
          ▸
        </span>
        <span>Coach notes</span>
        {notesCount > 0 && (
          <span className="font-normal normal-case tracking-normal text-spire-text-muted">
            ({notesCount})
          </span>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-3 rounded-lg border border-spire-border bg-zinc-900/40 p-3">
          <section>
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-spire-text-tertiary">
              Deck state
            </h4>
            <p className="mt-1 text-[13px] leading-[1.55] text-spire-text-secondary">
              {coaching.reasoning.deckState}
            </p>
            <h4 className="mt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-spire-text-tertiary">
              Commitment
            </h4>
            <p className="mt-1 text-[13px] leading-[1.55] text-spire-text-secondary">
              {coaching.reasoning.commitment}
            </p>
          </section>

          {hasTradeoffs && (
            <section className="border-t border-spire-border-subtle pt-3">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-spire-text-tertiary">
                Tradeoffs
              </h4>
              <ul className="mt-1.5 space-y-1.5">
                {coaching.keyTradeoffs.map((t) => (
                  <TradeoffRow key={t.position} tradeoff={t} />
                ))}
              </ul>
            </section>
          )}

          {hasCallouts && (
            <section className="border-t border-spire-border-subtle pt-3">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-spire-text-tertiary">
                Patterns to remember
              </h4>
              <ul className="mt-1.5 space-y-1.5">
                {coaching.teachingCallouts.map((c, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-[13px] leading-[1.55] text-spire-text-secondary"
                  >
                    <span aria-hidden className="text-spire-text-tertiary">
                      ·
                    </span>
                    <span>{c.explanation}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
