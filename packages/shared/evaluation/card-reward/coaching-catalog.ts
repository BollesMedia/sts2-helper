import type { ModifierKind } from "./modifier-stack";

export type CatalogKind = ModifierKind | "baseTier";

export interface CatalogEntry {
  teaching: string;
  upside: string;
  downside: string;
}

export const COACHING_CATALOG: Record<CatalogKind, CatalogEntry> = {
  archetypeFit: {
    teaching: "On-archetype picks compound; off-archetype picks dilute the deck.",
    upside: "Strengthens the committed archetype",
    downside: "Dilutes the deck with off-archetype cards",
  },
  deckGap: {
    teaching: "Cards that fill an engine gap (block / scaling / draw / removal) pay off every subsequent fight.",
    upside: "Fills a hole the current deck cannot cover",
    downside: "Leaves a structural gap open",
  },
  duplicate: {
    teaching: "Duplicates of non-core cards dilute the draw; duplicates of engine pieces compound.",
    upside: "Fresh card, not a redundant copy",
    downside: "Third copy of a non-core card",
  },
  winRateDelta: {
    teaching: "Historical pick-vs-skip win rate outweighs vibes when sample size is large enough.",
    upside: "Historically wins more when picked",
    downside: "Historically wins more when skipped",
  },
  actTiming: {
    teaching: "Act 3 is for finishing the engine, not fishing for side bets.",
    upside: "On-archetype in the finish stretch",
    downside: "Off-archetype pick this late in the run",
  },
  keystoneOverride: {
    teaching: "Keystones unlock scaling; grabbing one beats a higher raw tier in almost every case.",
    upside: "Unlocks the archetype's scaling",
    downside: "Leaves the archetype without its keystone",
  },
  baseTier: {
    teaching: "Community tier is a prior. It is not the full story once the deck takes shape.",
    upside: "Community consensus rates this well",
    downside: "Community consensus rates this poorly",
  },
};

export function getTeaching(kind: CatalogKind): string {
  return COACHING_CATALOG[kind].teaching;
}

export function getTradeoffPhrases(kind: CatalogKind): { upside: string; downside: string } {
  const e = COACHING_CATALOG[kind];
  return { upside: e.upside, downside: e.downside };
}
