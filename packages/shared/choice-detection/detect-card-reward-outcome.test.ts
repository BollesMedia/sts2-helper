import { describe, it, expect } from "vitest";
import { detectCardRewardOutcome } from "./detect-card-reward-outcome";
import type { DetectCardRewardInput, OfferedCard } from "./types";

const offered: OfferedCard[] = [
  { id: "card_001", name: "Carnage" },
  { id: "card_002", name: "Uppercut" },
  { id: "card_003", name: "Shrug It Off" },
];

const baseDeck = new Set(["Strike", "Strike", "Defend", "Defend", "Bash"]);

function detect(overrides: Partial<DetectCardRewardInput> = {}) {
  return detectCardRewardOutcome({
    offeredCards: offered,
    previousDeckNames: baseDeck,
    currentDeckNames: baseDeck,
    ...overrides,
  });
}

describe("detectCardRewardOutcome", () => {
  it("detects a picked card when deck gains a new name matching an offered card", () => {
    const newDeck = new Set([...baseDeck, "Carnage"]);
    const result = detect({ currentDeckNames: newDeck });
    expect(result).toEqual({ type: "picked", chosenName: "Carnage" });
  });

  it("detects skip when deck is unchanged", () => {
    const result = detect();
    expect(result).toEqual({ type: "skipped" });
  });

  it("detects the correct card when multiple new names appear (picks first match)", () => {
    const newDeck = new Set([...baseDeck, "Carnage", "Uppercut"]);
    const result = detect({ currentDeckNames: newDeck });
    expect(result).toEqual({ type: "picked", chosenName: "Carnage" });
  });

  it("detects skip when deck gains a card NOT in offered list", () => {
    const newDeck = new Set([...baseDeck, "Wound"]);
    const result = detect({ currentDeckNames: newDeck });
    expect(result).toEqual({ type: "skipped" });
  });

  it("handles empty offered cards gracefully", () => {
    const result = detect({ offeredCards: [] });
    expect(result).toEqual({ type: "skipped" });
  });

  it("handles case where offered card name matches existing deck card", () => {
    const offeredWithExisting: OfferedCard[] = [
      { id: "card_001", name: "Strike" },
      { id: "card_002", name: "Uppercut" },
      { id: "card_003", name: "Shrug It Off" },
    ];
    const result = detect({ offeredCards: offeredWithExisting });
    expect(result).toEqual({ type: "skipped" });
  });
});
