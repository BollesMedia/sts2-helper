import { describe, it, expect } from "vitest";
import { shouldEvaluateMap, type ShouldEvaluateMapInput } from "../should-evaluate-map";

/** Baseline "stable" input — on path, has context, no changes */
const stable: ShouldEvaluateMapInput = {
  optionCount: 3,
  hasPrevContext: true,
  actChanged: false,
  currentPosition: { col: 2, row: 5 },
  isOnRecommendedPath: true,
  hasSignificantContextChange: false,
};

function evaluate(overrides: Partial<ShouldEvaluateMapInput>) {
  return shouldEvaluateMap({ ...stable, ...overrides });
}

describe("shouldEvaluateMap", () => {
  describe("hard gate: zero options", () => {
    it("returns false when there are no options", () => {
      expect(evaluate({ optionCount: 0 })).toBe(false);
    });

    it("returns false even without prev context", () => {
      expect(evaluate({ optionCount: 0, hasPrevContext: false })).toBe(false);
    });
  });

  describe("soft gate: single option", () => {
    it("returns false when single option + prev context + on path", () => {
      expect(evaluate({ optionCount: 1 })).toBe(false);
    });

    it("returns true when single option + no prev context (needs initial path)", () => {
      expect(evaluate({ optionCount: 1, hasPrevContext: false })).toBe(true);
    });

    it("returns true when single option + prev context + deviated", () => {
      expect(evaluate({ optionCount: 1, isOnRecommendedPath: false })).toBe(true);
    });
  });

  describe("no previous context", () => {
    it("returns true with multiple options", () => {
      expect(evaluate({ hasPrevContext: false })).toBe(true);
    });
  });

  describe("act changed", () => {
    it("returns true when act changed", () => {
      expect(evaluate({ actChanged: true })).toBe(true);
    });
  });

  describe("position null", () => {
    it("returns true when current position is null", () => {
      expect(evaluate({ currentPosition: null })).toBe(true);
    });
  });

  describe("deviation from recommended path", () => {
    it("returns true when deviated with multiple options", () => {
      expect(evaluate({ isOnRecommendedPath: false })).toBe(true);
    });

    it("returns true when deviated with single option", () => {
      expect(evaluate({ optionCount: 1, isOnRecommendedPath: false })).toBe(true);
    });
  });

  describe("significant context change", () => {
    it("returns true when context changed significantly", () => {
      expect(evaluate({ hasSignificantContextChange: true })).toBe(true);
    });
  });

  describe("carry forward (no evaluation needed)", () => {
    it("returns false when on path with stable context", () => {
      expect(evaluate({})).toBe(false);
    });

    it("returns false with multiple options, on path, no changes", () => {
      expect(evaluate({ optionCount: 5 })).toBe(false);
    });
  });
});
