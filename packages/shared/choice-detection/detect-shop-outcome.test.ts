import { describe, it, expect } from "vitest";
import { detectShopOutcome } from "./detect-shop-outcome";
import type { DetectShopInput } from "./types";

const baseDeck = new Set(["Strike", "Strike", "Defend", "Defend", "Bash"]);

function detect(overrides: Partial<DetectShopInput> = {}) {
  return detectShopOutcome({
    previousDeckNames: baseDeck,
    currentDeckNames: baseDeck,
    previousDeckSize: 5,
    currentDeckSize: 5,
    ...overrides,
  });
}

describe("detectShopOutcome", () => {
  it("detects a card purchase when deck gains a new name", () => {
    const newDeck = new Set([...baseDeck, "Immolate"]);
    const result = detect({ currentDeckNames: newDeck, currentDeckSize: 6 });
    expect(result).toEqual({ purchases: ["Immolate"], removals: 0, browsedOnly: false });
  });

  it("detects multiple purchases", () => {
    const newDeck = new Set([...baseDeck, "Immolate", "Offering"]);
    const result = detect({ currentDeckNames: newDeck, currentDeckSize: 7 });
    expect(result).toEqual({ purchases: ["Immolate", "Offering"], removals: 0, browsedOnly: false });
  });

  it("detects card removal when deck shrinks", () => {
    const smallerDeck = new Set(["Strike", "Defend", "Defend", "Bash"]);
    const result = detect({ currentDeckNames: smallerDeck, currentDeckSize: 4 });
    expect(result).toEqual({ purchases: [], removals: 1, browsedOnly: false });
  });

  it("detects purchase + removal in same shop visit", () => {
    const newDeck = new Set(["Strike", "Defend", "Defend", "Bash", "Immolate"]);
    const result = detect({ currentDeckNames: newDeck, currentDeckSize: 5 });
    expect(result).toEqual({ purchases: ["Immolate"], removals: 0, browsedOnly: false });
  });

  it("detects browse only when nothing changed", () => {
    const result = detect();
    expect(result).toEqual({ purchases: [], removals: 0, browsedOnly: true });
  });
});
