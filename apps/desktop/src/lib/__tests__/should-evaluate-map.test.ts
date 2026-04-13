import { describe, it, expect } from "vitest";
import { shouldEvaluateMap, type ShouldEvaluateMapInput } from "../should-evaluate-map";

/** Baseline "stable" input — on path, has context, no changes */
const stable: ShouldEvaluateMapInput = {
  optionCount: 3,
  hasPrevContext: true,
  actChanged: false,
  currentPosition: { col: 2, row: 5 },
  isOnRecommendedPath: true,
  allOptionsAreAncient: false,
  hpDropExceedsThreshold: false,
  goldCrossedThreshold: false,
  deckSizeChangedSignificantly: false,
  shopInPathBecameWorthless: false,
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

    it("returns true when act changed even with prev context and on path", () => {
      // Scenario: pre-eval dispatch set hasPrevContext=true and isOnRecommendedPath=true
      // but the act changed (API failed on act transition) — must still re-evaluate
      expect(evaluate({ actChanged: true, hasPrevContext: true, isOnRecommendedPath: true })).toBe(true);
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


  describe("deviation after carry forward", () => {
    it("returns true when deviated even if options unchanged", () => {
      // Scenario: carry-forwarded at a fork, went through combat,
      // returned to same fork but current position is off-path.
      // mapKey is same (same options) but position changed.
      expect(evaluate({ isOnRecommendedPath: false })).toBe(true);
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

  describe("hard gate: forced ancient event (#56)", () => {
    it("returns false when the only option is an Ancient node, even on act transition", () => {
      // This is the exact Act 1 → Act 2 case: `actChanged` is true and
      // `next_options` contains a single Ancient entry. Pre-fix, `actChanged`
      // short-circuited to `true` and an eval fired with stale pre-Ancient
      // context. Post-fix the Ancient gate takes precedence.
      expect(
        evaluate({
          optionCount: 1,
          actChanged: true,
          hasPrevContext: true,
          isOnRecommendedPath: false, // transitional state at act start
          currentPosition: null,
          allOptionsAreAncient: true,
        }),
      ).toBe(false);
    });

    it("returns false when all options are Ancient even with no prev context (fresh run)", () => {
      expect(
        evaluate({
          optionCount: 1,
          hasPrevContext: false,
          allOptionsAreAncient: true,
        }),
      ).toBe(false);
    });

    it("returns true for a mixed row where only one option is Ancient (player has a real choice)", () => {
      // Structurally disallowed in STS2 today — Ancient nodes sit alone in
      // their row — but the gate is defensive: if the invariant is ever
      // broken, a mixed row should still be evaluated.
      expect(
        evaluate({
          optionCount: 2,
          allOptionsAreAncient: false,
          actChanged: true,
        }),
      ).toBe(true);
    });

    it("returns true for a normal non-Ancient act transition", () => {
      // Act 2 start where the first row is Monster nodes — existing behavior.
      expect(
        evaluate({
          optionCount: 3,
          actChanged: true,
          hasPrevContext: true,
          currentPosition: null,
          isOnRecommendedPath: false,
          allOptionsAreAncient: false,
        }),
      ).toBe(true);
    });
  });

  describe("Tier 2: context change triggers", () => {
    it("returns false when on-path even with HP drop (LLM planned for this)", () => {
      expect(evaluate({ hpDropExceedsThreshold: true })).toBe(false);
    });

    it("returns false when on-path even with gold change (LLM planned for this)", () => {
      expect(evaluate({ goldCrossedThreshold: true })).toBe(false);
    });

    it("returns false when on-path even with deck size change (LLM planned for this)", () => {
      expect(evaluate({ deckSizeChangedSignificantly: true })).toBe(false);
    });

    it("returns true when deviated — context flags escalate to full re-eval in listener", () => {
      // When off-path, shouldEvaluateMap returns true regardless of Tier 2 flags.
      // The Tier 2 flags are consumed by mapListeners to decide Tier 1 vs Tier 2.
      expect(evaluate({ isOnRecommendedPath: false, hpDropExceedsThreshold: true })).toBe(true);
    });

    it("returns false when context changes are below thresholds", () => {
      expect(evaluate({
        hpDropExceedsThreshold: false,
        goldCrossedThreshold: false,
        deckSizeChangedSignificantly: false,
      })).toBe(false);
    });
  });
});
