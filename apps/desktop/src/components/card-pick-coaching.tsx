import { useState, useEffect, type ReactNode } from "react";
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

function splitHeadline(headline: string): {
  verdict: string;
  reason: string | null;
} {
  const match = /^([^.!?]+[.!?])\s*(.*)$/.exec(headline.trim());
  if (!match) return { verdict: headline.trim(), reason: null };
  const reason = match[2].trim();
  return { verdict: match[1].trim(), reason: reason.length > 0 ? reason : null };
}

function DisclosureSection({
  label,
  count,
  defaultOpen,
  children,
}: {
  label: string;
  count?: number;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Resync when the auto-open signal flips on a new eval.
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  return (
    <section className="border-t border-spire-border-subtle pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-spire-text-tertiary transition-colors hover:text-spire-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400/60"
      >
        <span
          aria-hidden
          className={cn("transition-transform", open && "rotate-90")}
        >
          ▸
        </span>
        <span>{label}</span>
        {count != null && count > 0 && (
          <span className="font-normal normal-case tracking-normal text-spire-text-muted">
            ({count})
          </span>
        )}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </section>
  );
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
  if (!coaching) return null;

  const { verdict, reason } = splitHeadline(coaching.headline);
  const hasTradeoffs = coaching.keyTradeoffs.length > 0;
  const hasCallouts = coaching.teachingCallouts.length > 0;

  // Low confidence auto-opens the supporting sections so the player sees why
  // the coach is unsure without having to click.
  const lowConfidence = coaching.confidence < 0.6;

  return (
    <div className="flex flex-col gap-3">
      {/* Verdict banner — always visible. Tier 1. */}
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

      {/* Brief context — always visible, no toggle. Deck state + commitment
          are short and frame every other decision in this pick window. */}
      <div className="flex flex-col gap-2">
        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-spire-text-tertiary">
            Deck state
          </h4>
          <p className="mt-1 text-[13px] leading-[1.55] text-spire-text-secondary">
            {coaching.reasoning.deckState}
          </p>
        </section>
        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-spire-text-tertiary">
            Commitment
          </h4>
          <p className="mt-1 text-[13px] leading-[1.55] text-spire-text-secondary">
            {coaching.reasoning.commitment}
          </p>
        </section>
      </div>

      {/* Per-section disclosures — click to reveal. Tier 2. */}
      {hasTradeoffs && (
        <DisclosureSection
          label="Tradeoffs"
          count={coaching.keyTradeoffs.length}
          defaultOpen={lowConfidence}
        >
          <ul className="space-y-1.5">
            {coaching.keyTradeoffs.map((t) => (
              <TradeoffRow key={t.position} tradeoff={t} />
            ))}
          </ul>
        </DisclosureSection>
      )}

      {hasCallouts && (
        <DisclosureSection
          label="Patterns to remember"
          count={coaching.teachingCallouts.length}
          defaultOpen={lowConfidence}
        >
          <ul className="space-y-1.5">
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
        </DisclosureSection>
      )}
    </div>
  );
}
