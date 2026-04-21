import type { ScoreOffersResult, ScoredOffer } from "./score-offers";
import type { Modifier, ModifierKind } from "./modifier-stack";
import { COACHING_CATALOG, type CatalogKind, getTeaching } from "./coaching-catalog";

export interface CoachingContext {
  act: 1 | 2 | 3;
  floor: number;
  deckSize: number;
  committed: string | null;
}

export interface CoachingOutput {
  reasoning: { deckState: string; commitment: string };
  headline: string;
  confidence: number;
  keyTradeoffs: { position: number; upside: string; downside: string }[];
  teachingCallouts: { pattern: string; explanation: string }[];
}

const MAX_CALLOUTS = 3;
const MAX_TRADEOFFS = 2;

function confidenceFromTierValue(tv: number): number {
  if (tv >= 5) return 0.95;
  if (tv === 4) return 0.85;
  if (tv === 3) return 0.65;
  return 0.45;
}

function dominantModifier(offer: ScoredOffer): Modifier | null {
  if (offer.breakdown.modifiers.length === 0) return null;
  return offer.breakdown.modifiers.reduce((best, m) =>
    Math.abs(m.delta) > Math.abs(best.delta) ? m : best,
  );
}

function kindsSortedByAbsDelta(offer: ScoredOffer): ModifierKind[] {
  return [...offer.breakdown.modifiers]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .map((m) => m.kind);
}

function buildTeachingCallouts(top: ScoredOffer): CoachingOutput["teachingCallouts"] {
  const kinds = kindsSortedByAbsDelta(top);
  const unique: ModifierKind[] = [];
  for (const k of kinds) {
    if (!unique.includes(k)) unique.push(k);
    if (unique.length >= MAX_CALLOUTS) break;
  }
  return unique.map((k) => ({ pattern: k, explanation: getTeaching(k as CatalogKind) }));
}

function buildTradeoffs(
  top: ScoredOffer,
  runnerUp: ScoredOffer | null,
): CoachingOutput["keyTradeoffs"] {
  if (!runnerUp) return [];
  if (top.breakdown.modifiers.length === 0) return [];

  const topKinds = kindsSortedByAbsDelta(top);
  const runnerUpKinds = new Set(kindsSortedByAbsDelta(runnerUp));

  const distinguishing = topKinds.filter((k) => !runnerUpKinds.has(k)).slice(0, MAX_TRADEOFFS);
  if (distinguishing.length === 0) return [];

  return distinguishing.map((k) => {
    const entry = COACHING_CATALOG[k as CatalogKind];
    return { position: runnerUp.itemIndex, upside: entry.upside, downside: entry.downside };
  });
}

function buildHeadline(result: ScoreOffersResult): string {
  if (result.skipRecommended) {
    return `Skip all — ${result.skipReason ?? "no offer cleared the threshold"}`;
  }
  if (!result.topOffer) return "Skip all — no offers to rank";
  const top = result.topOffer;
  const dom = dominantModifier(top);
  const reason = dom?.reason ?? top.breakdown.topReason;
  return `Pick ${top.itemName} — ${reason}`;
}

function buildReasoning(
  result: ScoreOffersResult,
  ctx: CoachingContext,
): CoachingOutput["reasoning"] {
  void result;
  const commitmentPhrase = ctx.committed
    ? `Act ${ctx.act}; ${ctx.committed} locked`
    : `Act ${ctx.act}; archetypes still open`;
  const deckState = `${ctx.deckSize}-card deck, ${ctx.committed ?? "uncommitted"}`;
  return { deckState, commitment: commitmentPhrase };
}

export function buildCoaching(
  result: ScoreOffersResult,
  ctx: CoachingContext,
): CoachingOutput {
  const top = result.topOffer;
  const runnerUp = result.offers[1] ?? null;

  const tvForConfidence = result.skipRecommended ? 0 : top?.tierValue ?? 0;
  const confidence = result.skipRecommended ? 0.80 : confidenceFromTierValue(tvForConfidence);

  return {
    reasoning: buildReasoning(result, ctx),
    headline: buildHeadline(result),
    confidence,
    keyTradeoffs: top ? buildTradeoffs(top, runnerUp) : [],
    teachingCallouts: top ? buildTeachingCallouts(top) : [],
  };
}
