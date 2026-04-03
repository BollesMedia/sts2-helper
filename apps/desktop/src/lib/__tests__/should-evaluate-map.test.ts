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
    it("returns true when position null and no prev context (fresh start)", () => {
      expect(evaluate({ currentPosition: null, hasPrevContext: false })).toBe(true);
    });

    it("returns true when position null and act changed", () => {
      expect(evaluate({ currentPosition: null, actChanged: true })).toBe(true);
    });

    it("returns false when position null but has prev context and no act change", () => {
      // Transitional state — game briefly reports null position during node
      // transition. Prev context exists so we have a valid path. Don't re-eval.
      expect(evaluate({ currentPosition: null })).toBe(false);
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
    it("returns true when context changed AND deviated from path", () => {
      expect(evaluate({ hasSignificantContextChange: true, isOnRecommendedPath: false })).toBe(true);
    });

    it("returns false when context changed but still on recommended path", () => {
      // User followed the recommended path, went through combat (HP dropped),
      // returned to map. Path is still valid — don't re-eval.
      expect(evaluate({ hasSignificantContextChange: true, isOnRecommendedPath: true })).toBe(false);
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
