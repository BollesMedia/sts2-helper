import { describe, it, expect } from "vitest";
import { tierToValue, valueToTier, tierColor, tierBgColor } from "./tier-utils";

describe("tierToValue", () => {
  it("maps each tier letter to the correct value", () => {
    expect(tierToValue("S")).toBe(6);
    expect(tierToValue("A")).toBe(5);
    expect(tierToValue("B")).toBe(4);
    expect(tierToValue("C")).toBe(3);
    expect(tierToValue("D")).toBe(2);
    expect(tierToValue("F")).toBe(1);
  });
});

describe("valueToTier", () => {
  it("maps each value to the correct tier letter", () => {
    expect(valueToTier(6)).toBe("S");
    expect(valueToTier(5)).toBe("A");
    expect(valueToTier(4)).toBe("B");
    expect(valueToTier(3)).toBe("C");
    expect(valueToTier(2)).toBe("D");
    expect(valueToTier(1)).toBe("F");
  });

  it("clamps values outside range", () => {
    expect(valueToTier(0)).toBe("F");
    expect(valueToTier(10)).toBe("S");
    expect(valueToTier(-1)).toBe("F");
  });

  it("rounds fractional values", () => {
    expect(valueToTier(5.7)).toBe("S");
    expect(valueToTier(4.3)).toBe("B");
    expect(valueToTier(2.5)).toBe("C");
  });
});

describe("tierColor", () => {
  it("returns a tailwind text color class for each tier", () => {
    expect(tierColor("S")).toContain("text-");
    expect(tierColor("F")).toContain("text-");
  });
});

describe("tierBgColor", () => {
  it("returns tailwind bg + border classes for each tier", () => {
    expect(tierBgColor("S")).toContain("bg-");
    expect(tierBgColor("S")).toContain("border-");
  });
});
