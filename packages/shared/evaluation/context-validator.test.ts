import { describe, it, expect } from "vitest";
import { validateEvaluationContext } from "./context-validator";
import type { EvaluationContext } from "./types";

function makeValidContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    character: "ironclad",
    archetypes: [],
    primaryArchetype: null,
    act: 2,
    floor: 15,
    ascension: 7,
    deckSize: 12,
    hpPercent: 0.8,
    gold: 150,
    energy: 3,
    relicIds: ["burning_blood"],
    hasScaling: true,
    curseCount: 0,
    deckCards: Array.from({ length: 12 }, (_, i) => ({
      name: `Card${i}`,
      description: `Does thing ${i}`,
    })),
    drawSources: [],
    scalingSources: [],
    curseNames: [],
    relics: [{ name: "Burning Blood", description: "Heal 6 HP at end of combat" }],
    potionNames: [],
    potionSlotCap: 2,
    upgradeCount: 3,
    deckMaturity: 0.5,
    relicCount: 1,
    ...overrides,
  };
}

describe("validateEvaluationContext", () => {
  it("returns valid for a well-formed context", () => {
    const result = validateEvaluationContext(makeValidContext());
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  describe("errors", () => {
    it("warns on empty deck past early game (degraded eval, not blocked)", () => {
      const ctx = makeValidContext({ deckSize: 0, deckCards: [], floor: 10 });
      const result = validateEvaluationContext(ctx);
      expect(result.isValid).toBe(true); // degraded, not blocked
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ field: "deckSize", severity: "warning" })
      );
    });

    it("allows empty deck at floor <= 2", () => {
      const ctx = makeValidContext({ deckSize: 0, deckCards: [], floor: 1, act: 1 });
      const result = validateEvaluationContext(ctx);
      const deckError = result.errors.find((e) => e.field === "deckSize");
      expect(deckError).toBeUndefined();
    });

    it("warns on deckCards/deckSize mismatch (degraded eval, not blocked)", () => {
      const ctx = makeValidContext({ deckSize: 5 }); // deckCards has 12
      const result = validateEvaluationContext(ctx);
      expect(result.isValid).toBe(true); // degraded, not blocked
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ field: "deckCards", severity: "warning" })
      );
    });

    it("flags unknown character", () => {
      const ctx = makeValidContext({ character: "unknown" });
      const result = validateEvaluationContext(ctx);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: "character", severity: "error" })
      );
    });

    it("flags empty character", () => {
      const ctx = makeValidContext({ character: "" });
      const result = validateEvaluationContext(ctx);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: "character", severity: "error" })
      );
    });

    it("warns on 0% HP (degraded eval, not blocked)", () => {
      const ctx = makeValidContext({ hpPercent: 0 });
      const result = validateEvaluationContext(ctx);
      expect(result.isValid).toBe(true); // degraded, not blocked
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ field: "hpPercent", severity: "warning" })
      );
    });
  });

  describe("warnings", () => {
    it("warns on suspiciously small deck past floor 5", () => {
      const cards = Array.from({ length: 5 }, (_, i) => ({
        name: `Card${i}`,
        description: `Does thing ${i}`,
      }));
      const ctx = makeValidContext({ deckSize: 5, deckCards: cards, floor: 10 });
      const result = validateEvaluationContext(ctx);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ field: "deckSize", severity: "warning" })
      );
    });

    it("does not warn on small deck at early floors", () => {
      const cards = Array.from({ length: 5 }, (_, i) => ({
        name: `Card${i}`,
        description: `Does thing ${i}`,
      }));
      const ctx = makeValidContext({ deckSize: 5, deckCards: cards, floor: 3, act: 1 });
      const result = validateEvaluationContext(ctx);
      const deckWarning = result.warnings.find((w) => w.field === "deckSize");
      expect(deckWarning).toBeUndefined();
    });

    it("warns on no relics in Act 2+", () => {
      const ctx = makeValidContext({ relics: [], relicIds: [], relicCount: 0, act: 2 });
      const result = validateEvaluationContext(ctx);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ field: "relics", severity: "warning" })
      );
    });

    it("does not warn on no relics in Act 1", () => {
      const ctx = makeValidContext({ relics: [], relicIds: [], relicCount: 0, act: 1 });
      const result = validateEvaluationContext(ctx);
      const relicWarning = result.warnings.find((w) => w.field === "relics");
      expect(relicWarning).toBeUndefined();
    });

    it("warns on HP over 100%", () => {
      const ctx = makeValidContext({ hpPercent: 1.5 });
      const result = validateEvaluationContext(ctx);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ field: "hpPercent", severity: "warning" })
      );
    });

    it("warns on cards with empty names", () => {
      const cards = [
        { name: "Strike", description: "Deal 6 damage" },
        { name: "", description: "Mystery card" },
      ];
      const ctx = makeValidContext({ deckSize: 2, deckCards: cards });
      const result = validateEvaluationContext(ctx);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ field: "deckCards", severity: "warning" })
      );
    });
  });

  describe("multiple issues", () => {
    it("collects errors and warnings", () => {
      const ctx = makeValidContext({
        character: "unknown",
        hpPercent: 0,
        deckSize: 0,
        deckCards: [],
        floor: 15,
        relics: [],
        relicIds: [],
        act: 2,
      });
      const result = validateEvaluationContext(ctx);
      expect(result.isValid).toBe(false); // character=unknown is still an error
      expect(result.errors.length).toBeGreaterThanOrEqual(1); // character
      expect(result.warnings.length).toBeGreaterThanOrEqual(3); // deckSize, hpPercent, relics
    });
  });
});
