import { describe, it, expect } from "vitest";
import type { TierLetter } from "./tier-utils";
import { tierToValue, valueToTier, tierColor, tierBgColor } from "./tier-utils";

const ALL_TIERS: TierLetter[] = ["S", "A", "B", "C", "D", "F"];

describe("tierToValue", () => {
  it("maps each tier letter to a unique ascending value (F lowest, S highest)", () => {
    expect(tierToValue("F")).toBeLessThan(tierToValue("D"));
    expect(tierToValue("D")).toBeLessThan(tierToValue("C"));
    expect(tierToValue("C")).toBeLessThan(tierToValue("B"));
    expect(tierToValue("B")).toBeLessThan(tierToValue("A"));
    expect(tierToValue("A")).toBeLessThan(tierToValue("S"));
  });
});

describe("valueToTier", () => {
  it("round-trips with tierToValue for all tiers", () => {
    for (const tier of ALL_TIERS) {
      expect(valueToTier(tierToValue(tier))).toBe(tier);
    }
  });

  it("returns a valid tier for out-of-range values", () => {
    expect(ALL_TIERS).toContain(valueToTier(0));
    expect(ALL_TIERS).toContain(valueToTier(100));
    expect(ALL_TIERS).toContain(valueToTier(-5));
  });

  it("returns a valid tier for fractional values", () => {
    expect(ALL_TIERS).toContain(valueToTier(3.7));
    expect(ALL_TIERS).toContain(valueToTier(5.2));
    expect(ALL_TIERS).toContain(valueToTier(1.5));
  });
});

describe("tierColor", () => {
  it("returns a tailwind text color class for every tier", () => {
    for (const tier of ALL_TIERS) {
      expect(tierColor(tier)).toMatch(/^text-/);
    }
  });

  it("returns different colors for different tiers", () => {
    const colors = new Set(ALL_TIERS.map(tierColor));
    expect(colors.size).toBe(ALL_TIERS.length);
  });
});

describe("tierBgColor", () => {
  it("returns bg and border classes for every tier", () => {
    for (const tier of ALL_TIERS) {
      const classes = tierBgColor(tier);
      expect(classes).toContain("bg-");
      expect(classes).toContain("border-");
    }
  });
});
