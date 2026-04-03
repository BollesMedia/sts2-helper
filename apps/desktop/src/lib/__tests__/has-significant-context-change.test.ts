import { describe, it, expect } from "vitest";
import { hasSignificantContextChange } from "../has-significant-context-change";

describe("hasSignificantContextChange", () => {
  describe("HP drop", () => {
    it("returns true when HP dropped more than 15%", () => {
      expect(hasSignificantContextChange({
        prevHpPercent: 0.8,
        currentHpPercent: 0.6,
        prevDeckSize: 10,
        currentDeckSize: 10,
      })).toBe(true);
    });

    it("returns false when HP dropped 14% (below threshold)", () => {
      expect(hasSignificantContextChange({
        prevHpPercent: 0.8,
        currentHpPercent: 0.668,
        prevDeckSize: 10,
        currentDeckSize: 10,
      })).toBe(false);
    });

    it("returns false when HP increased (healed)", () => {
      expect(hasSignificantContextChange({
        prevHpPercent: 0.5,
        currentHpPercent: 0.8,
        prevDeckSize: 10,
        currentDeckSize: 10,
      })).toBe(false);
    });
  });

  describe("deck growth", () => {
    it("returns true when deck grew by 2", () => {
      expect(hasSignificantContextChange({
        prevHpPercent: 0.8,
        currentHpPercent: 0.8,
        prevDeckSize: 10,
        currentDeckSize: 12,
      })).toBe(true);
    });

    it("returns false when deck grew by exactly 1 (boundary)", () => {
      expect(hasSignificantContextChange({
        prevHpPercent: 0.8,
        currentHpPercent: 0.8,
        prevDeckSize: 10,
        currentDeckSize: 11,
      })).toBe(false);
    });

    it("returns false when deck shrank (card removal)", () => {
      expect(hasSignificantContextChange({
        prevHpPercent: 0.8,
        currentHpPercent: 0.8,
        prevDeckSize: 12,
        currentDeckSize: 11,
      })).toBe(false);
    });
  });

  describe("combined", () => {
    it("returns true when both HP dropped and deck grew", () => {
      expect(hasSignificantContextChange({
        prevHpPercent: 0.9,
        currentHpPercent: 0.6,
        prevDeckSize: 10,
        currentDeckSize: 13,
      })).toBe(true);
    });

    it("returns false when nothing changed", () => {
      expect(hasSignificantContextChange({
        prevHpPercent: 0.8,
        currentHpPercent: 0.8,
        prevDeckSize: 10,
        currentDeckSize: 10,
      })).toBe(false);
    });
  });
});
