import { describe, it, expect } from "vitest";
import { scoreShopNonCards, type ShopNonCardItem } from "./score-non-cards";

function item(overrides: Partial<ShopNonCardItem> = {}): ShopNonCardItem {
  return {
    itemId: "x",
    itemName: "Something",
    itemIndex: 1,
    cost: 50,
    description: "",
    ...overrides,
  };
}

describe("scoreShopNonCards", () => {
  it("ranks card removal as S-tier in Act 1", () => {
    const result = scoreShopNonCards({
      items: [item({ itemName: "Card Removal", cost: 75 })],
      act: 1,
      goldBudget: 200,
      potionCount: 0,
    });
    expect(result[0].tier).toBe("S");
    expect(result[0].kind).toBe("card_removal");
  });

  it("ranks relics as A in Act 1 and S in Act 2", () => {
    const items = [item({ itemName: "Relic X", description: "Gain 3 strength" })];
    const act1 = scoreShopNonCards({ items, act: 1, goldBudget: 500, potionCount: 0 });
    const act2 = scoreShopNonCards({ items, act: 2, goldBudget: 500, potionCount: 0 });
    expect(act1[0].tier).toBe("A");
    expect(act2[0].tier).toBe("S");
  });

  it("ranks potions as B when slots are open, F when full (default cap = 2)", () => {
    const items = [item({ itemName: "Strength Potion", description: "Gain strength" })];
    const open = scoreShopNonCards({ items, act: 1, goldBudget: 200, potionCount: 0 });
    const full = scoreShopNonCards({ items, act: 1, goldBudget: 200, potionCount: 2 });
    expect(open[0].tier).toBe("B");
    expect(full[0].tier).toBe("F");
  });

  it("respects an explicit potionSlotCap higher than the baseline (expansion relics)", () => {
    const items = [item({ itemName: "Strength Potion", description: "Gain strength" })];
    // potionCount=2 is full at baseline cap=2 → F. With expansion relic
    // raising cap to 4, two filled slots leave headroom → B.
    const expanded = scoreShopNonCards({
      items,
      act: 1,
      goldBudget: 200,
      potionCount: 2,
      potionSlotCap: 4,
    });
    expect(expanded[0].tier).toBe("B");
  });

  it("breaks ties by lifting on-sale items above same-tier full-price ones", () => {
    const items = [
      item({ itemIndex: 1, itemName: "Strength Potion", description: "Gain strength", cost: 50 }),
      item({ itemIndex: 2, itemName: "Block Potion", description: "Gain block", cost: 30, onSale: true }),
    ];
    const result = scoreShopNonCards({ items, act: 1, goldBudget: 200, potionCount: 0 });
    expect(result[0].itemName).toBe("Block Potion");
    expect(result[0].reasoning).toContain("on sale");
  });

  it("forces F tier and affordable=false when the cost exceeds the gold budget", () => {
    const result = scoreShopNonCards({
      items: [item({ itemName: "Card Removal", cost: 100 })],
      act: 1,
      goldBudget: 50,
      potionCount: 0,
    });
    expect(result[0].tier).toBe("F");
    expect(result[0].affordable).toBe(false);
  });

  it("honors explicit kind over name substring heuristic", () => {
    // A relic literally named "Potion Belt" — name substring would mis-classify.
    const result = scoreShopNonCards({
      items: [item({ itemName: "Potion Belt", kind: "relic", description: "Expands potion slots" })],
      act: 1,
      goldBudget: 500,
      potionCount: 0,
    });
    expect(result[0].kind).toBe("relic");
    expect(result[0].tier).toBe("A");
  });

  it("sorts ranked items by tier desc, stable by original index", () => {
    const items = [
      item({ itemIndex: 1, itemName: "Potion A", description: "Gain strength", cost: 50 }),
      item({ itemIndex: 2, itemName: "Relic B", description: "A shiny relic", cost: 150 }),
      item({ itemIndex: 3, itemName: "Card Removal", cost: 75 }),
    ];
    const result = scoreShopNonCards({ items, act: 1, goldBudget: 300, potionCount: 0 });
    expect(result.map((r) => r.itemName)).toEqual(["Card Removal", "Relic B", "Potion A"]);
  });
});
