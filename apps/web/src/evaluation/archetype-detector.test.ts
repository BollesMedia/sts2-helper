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
  it("detects poison archetype when deck has multiple poison cards", () => {
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

  it("detects exhaust archetype from Ironclad exhaust cards", () => {
    const deck = [
      card("Corruption"),
      card("Feel No Pain"),
      card("Dark Embrace"),
      card("Burning Pact"),
    ];
    const result = detectArchetypes(deck, []);
    const exhaustArch = result.find((a) => a.archetype === "exhaust");
    expect(exhaustArch).toBeDefined();
  });

  it("boosts archetype confidence when matching relics are present", () => {
    const deck = [card("Strike"), card("Defend")];
    const withRelic = detectArchetypes(deck, [{ id: "DEAD_BRANCH", name: "Dead Branch" }]);
    const withoutRelic = detectArchetypes(deck, []);

    const exhaustWith = withRelic.find((a) => a.archetype === "exhaust");
    const exhaustWithout = withoutRelic.find((a) => a.archetype === "exhaust");

    expect(exhaustWith?.confidence ?? 0).toBeGreaterThan(exhaustWithout?.confidence ?? 0);
  });

  it("returns ranked results sorted by confidence (highest first)", () => {
    const deck = [
      card("Noxious Fumes"),
      card("Deadly Poison"),
      card("Catalyst"),
      card("Blade Dance"),
    ];
    const result = detectArchetypes(deck, []);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].confidence).toBeGreaterThanOrEqual(result[i].confidence);
    }
  });

  it("does not detect a dominant archetype from a starter deck", () => {
    const deck = [
      card("Strike"), card("Strike"), card("Strike"), card("Strike"), card("Strike"),
      card("Defend"), card("Defend"), card("Defend"), card("Defend"),
      card("Bash"),
    ];
    const result = detectArchetypes(deck, []);
    // No archetype should be dominant — either empty or all low confidence
    const dominant = result.find((a) => a.confidence > 60);
    expect(dominant).toBeUndefined();
  });
});

describe("hasScalingSources", () => {
  it("returns true for decks containing known scaling cards", () => {
    expect(hasScalingSources([card("Demon Form")])).toBe(true);
    expect(hasScalingSources([card("Noxious Fumes")])).toBe(true);
  });

  it("returns false for decks with only basic cards", () => {
    expect(hasScalingSources([card("Strike"), card("Defend")])).toBe(false);
  });
});

describe("getDrawSources", () => {
  it("returns names of cards that provide draw", () => {
    const sources = getDrawSources([
      card("Acrobatics"),
      card("Offering"),
      card("Strike"),
    ]);
    expect(sources).toContain("Acrobatics");
    expect(sources).toContain("Offering");
    expect(sources).not.toContain("Strike");
  });

  it("returns empty array when no draw sources exist", () => {
    expect(getDrawSources([card("Strike")])).toHaveLength(0);
  });
});

describe("getScalingSources", () => {
  it("returns names of cards that provide scaling", () => {
    const sources = getScalingSources([
      card("Demon Form"),
      card("Strike"),
    ]);
    expect(sources).toContain("Demon Form");
    expect(sources).not.toContain("Strike");
  });

  it("returns empty array when no scaling sources exist", () => {
    expect(getScalingSources([card("Strike")])).toHaveLength(0);
  });
});
