import { describe, it, expect } from "vitest";
import { detectArchetypes, hasScalingSources, getDrawSources, getScalingSources } from "./archetype-detector";
import type { CombatCard } from "@/lib/types/game-state";

function card(name: string, keywords: string[] = []): CombatCard {
  return {
    name,
    description: "",
    keywords: keywords.map((k) => ({ name: k, description: "" })),
  };
}

describe("detectArchetypes", () => {
  it("detects poison archetype from Silent cards", () => {
    const deck = [
      card("Noxious Fumes"),
      card("Deadly Poison"),
      card("Catalyst"),
      card("Strike"),
      card("Defend"),
    ];
    const result = detectArchetypes(deck, []);
    const poisonArch = result.find((a) => a.archetype === "poison");
    expect(poisonArch).toBeDefined();
    expect(poisonArch!.confidence).toBeGreaterThan(0);
  });

  it("detects exhaust archetype from Ironclad cards", () => {
    const deck = [
      card("Corruption"),
      card("Feel No Pain"),
      card("Dark Embrace"),
      card("Sentinel"),
    ];
    const result = detectArchetypes(deck, []);
    const exhaustArch = result.find((a) => a.archetype === "exhaust");
    expect(exhaustArch).toBeDefined();
  });

  it("boosts archetype from relics", () => {
    const deck = [card("Strike"), card("Defend")];
    const withRelic = detectArchetypes(deck, [{ id: "DEAD_BRANCH", name: "Dead Branch" }]);
    const withoutRelic = detectArchetypes(deck, []);

    const exhaustWith = withRelic.find((a) => a.archetype === "exhaust");
    const exhaustWithout = withoutRelic.find((a) => a.archetype === "exhaust");

    expect(exhaustWith?.confidence ?? 0).toBeGreaterThan(exhaustWithout?.confidence ?? 0);
  });

  it("returns empty for a starter deck", () => {
    const deck = [
      card("Strike"), card("Strike"), card("Strike"), card("Strike"), card("Strike"),
      card("Defend"), card("Defend"), card("Defend"), card("Defend"),
      card("Bash"),
    ];
    const result = detectArchetypes(deck, []);
    // Starter deck has no clear archetype
    expect(result.every((a) => a.confidence < 50)).toBe(true);
  });

  it("filters low-confidence archetypes", () => {
    const deck = [card("Strike")];
    const result = detectArchetypes(deck, []);
    // All should be filtered out (below 10% threshold)
    expect(result.length).toBe(0);
  });
});

describe("hasScalingSources", () => {
  it("returns true for decks with scaling cards", () => {
    expect(hasScalingSources([card("Demon Form")])).toBe(true);
    expect(hasScalingSources([card("Noxious Fumes")])).toBe(true);
    expect(hasScalingSources([card("Defragment")])).toBe(true);
  });

  it("returns false for decks without scaling", () => {
    expect(hasScalingSources([card("Strike"), card("Defend")])).toBe(false);
  });
});

describe("getDrawSources", () => {
  it("identifies draw cards", () => {
    const sources = getDrawSources([
      card("Acrobatics"),
      card("Offering"),
      card("Strike"),
    ]);
    expect(sources).toContain("Acrobatics");
    expect(sources).toContain("Offering");
    expect(sources).not.toContain("Strike");
  });
});

describe("getScalingSources", () => {
  it("identifies scaling cards", () => {
    const sources = getScalingSources([
      card("Demon Form"),
      card("Strike"),
      card("Noxious Fumes"),
    ]);
    expect(sources).toContain("Demon Form");
    expect(sources).toContain("Noxious Fumes");
    expect(sources).not.toContain("Strike");
  });
});
