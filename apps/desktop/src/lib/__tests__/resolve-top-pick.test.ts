import { describe, it, expect } from "vitest";
import { resolveTopPick } from "../resolve-top-pick";

describe("resolveTopPick", () => {
  it("picks highest tier", () => {
    const result = resolveTopPick([
      { itemId: "1", itemName: "Card A", tier: "B", recommendation: "good_pick" },
      { itemId: "2", itemName: "Card S", tier: "S", recommendation: "strong_pick" },
    ], false);
    expect(result?.item.itemName).toBe("Card S");
  });

  it("breaks tier tie by recommendation strength", () => {
    const result = resolveTopPick([
      { itemId: "1", itemName: "Havoc", tier: "A", recommendation: "good_pick" },
      { itemId: "2", itemName: "Dominate", tier: "A", recommendation: "strong_pick" },
    ], false);
    expect(result?.item.itemName).toBe("Dominate");
  });

  it("badge and summary agree (the bug scenario)", () => {
    // Havoc is A/good_pick, Dominate is B/good_pick
    // findTopPick should pick Havoc (higher tier)
    const rankings = [
      { itemId: "1", itemName: "Havoc", tier: "A", recommendation: "good_pick", reasoning: "Draw fuel" },
      { itemId: "2", itemName: "Breakthrough", tier: "B", recommendation: "situational", reasoning: "AoE" },
      { itemId: "3", itemName: "Dominate", tier: "B", recommendation: "good_pick", reasoning: "Vulnerable synergy" },
    ];
    const result = resolveTopPick(rankings, false);
    expect(result?.item.itemName).toBe("Havoc");
    expect(result?.summary).toContain("Havoc");
  });

  it("returns null when skip recommended", () => {
    expect(resolveTopPick([
      { itemId: "1", itemName: "Card", tier: "D", recommendation: "skip" },
    ], true)).toBeNull();
  });

  it("returns null for empty rankings", () => {
    expect(resolveTopPick([], false)).toBeNull();
  });

  it("returns null when best is skip recommendation", () => {
    expect(resolveTopPick([
      { itemId: "1", itemName: "Bad Card", tier: "F", recommendation: "skip" },
    ], false)).toBeNull();
  });

  it("generates summary from reasoning", () => {
    const result = resolveTopPick([
      { itemId: "1", itemName: "Demon Form", tier: "S", recommendation: "strong_pick", reasoning: "Permanent scaling" },
    ], false);
    expect(result?.summary).toBe("Pick Demon Form — Permanent scaling");
  });

  it("generates summary without reasoning", () => {
    const result = resolveTopPick([
      { itemId: "1", itemName: "Demon Form", tier: "S", recommendation: "strong_pick" },
    ], false);
    expect(result?.summary).toBe("Pick Demon Form");
  });

  it("stable on full tie — first wins", () => {
    const result = resolveTopPick([
      { itemId: "1", itemName: "First", tier: "A", recommendation: "good_pick" },
      { itemId: "2", itemName: "Second", tier: "A", recommendation: "good_pick" },
    ], false);
    expect(result?.item.itemName).toBe("First");
  });
});
