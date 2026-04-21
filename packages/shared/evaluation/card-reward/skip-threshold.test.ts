import { describe, it, expect } from "vitest";
import { shouldSkipAll, SKIP_THRESHOLDS } from "./skip-threshold";
import type { ModifierBreakdown } from "./modifier-stack";

function breakdown(tier: ModifierBreakdown["adjustedTier"], tierValue: number, mods: ModifierBreakdown["modifiers"] = []): ModifierBreakdown {
  return { baseTier: "C", modifiers: mods, adjustedTier: tier, tierValue, topReason: "test" };
}

describe("skip-threshold", () => {
  it("exports thresholds per act", () => {
    expect(SKIP_THRESHOLDS[1]).toBe(4);
    expect(SKIP_THRESHOLDS[2]).toBe(5);
    expect(SKIP_THRESHOLDS[3]).toBe(5);
  });

  it("skips Act 1 when no offer is B or better", () => {
    const result = shouldSkipAll([breakdown("C", 3), breakdown("D", 2)], 1);
    expect(result.skip).toBe(true);
    expect(result.reason).toContain("Act 1");
  });

  it("does not skip Act 1 when at least one B exists", () => {
    const result = shouldSkipAll([breakdown("B", 4), breakdown("D", 2)], 1);
    expect(result.skip).toBe(false);
  });

  it("skips Act 2 when no offer is A or better", () => {
    const result = shouldSkipAll([breakdown("B", 4), breakdown("C", 3)], 2);
    expect(result.skip).toBe(true);
  });

  it("does not skip Act 2 when at least one A exists", () => {
    const result = shouldSkipAll([breakdown("A", 5), breakdown("C", 3)], 2);
    expect(result.skip).toBe(false);
  });

  it("does not skip Act 3 when an A-tier card exists", () => {
    const result = shouldSkipAll([breakdown("A", 5), breakdown("C", 3)], 3);
    expect(result.skip).toBe(false);
  });

  it("does not skip Act 3 when a keystone-for-committed card exists", () => {
    const keystoneBreakdown = breakdown("B", 4, [
      { kind: "archetypeFit", delta: 2, reason: "keystone for exhaust" },
    ]);
    const result = shouldSkipAll([keystoneBreakdown, breakdown("C", 3)], 3);
    expect(result.skip).toBe(false);
  });

  it("skips Act 3 when no A-tier and no keystone exists", () => {
    const result = shouldSkipAll([breakdown("B", 4), breakdown("C", 3)], 3);
    expect(result.skip).toBe(true);
  });

  it("returns skip=false on an empty offer list (nothing to decide against)", () => {
    const result = shouldSkipAll([], 1);
    expect(result.skip).toBe(false);
  });
});
