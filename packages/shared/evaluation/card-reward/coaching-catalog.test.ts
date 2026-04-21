import { describe, it, expect } from "vitest";
import { COACHING_CATALOG, getTeaching, getTradeoffPhrases } from "./coaching-catalog";

describe("COACHING_CATALOG", () => {
  it("has an entry for every ModifierKind plus baseTier", () => {
    const required = [
      "archetypeFit",
      "deckGap",
      "duplicate",
      "winRateDelta",
      "actTiming",
      "keystoneOverride",
      "baseTier",
    ];
    for (const key of required) {
      expect(COACHING_CATALOG[key as keyof typeof COACHING_CATALOG]).toBeDefined();
    }
  });

  it("getTeaching returns the catalog teaching for a modifier kind", () => {
    expect(getTeaching("archetypeFit")).toMatch(/archetype/i);
  });

  it("getTradeoffPhrases returns upside/downside for a kind", () => {
    const t = getTradeoffPhrases("archetypeFit");
    expect(t.upside.length).toBeGreaterThan(0);
    expect(t.downside.length).toBeGreaterThan(0);
  });
});
