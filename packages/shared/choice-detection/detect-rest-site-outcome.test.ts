import { describe, it, expect } from "vitest";
import { detectRestSiteOutcome } from "./detect-rest-site-outcome";

const baseDeck = new Set(["Strike", "Defend", "Bash"]);

describe("detectRestSiteOutcome", () => {
  it("detects rest when deck is unchanged", () => {
    const result = detectRestSiteOutcome({
      previousDeckNames: baseDeck,
      currentDeckNames: baseDeck,
    });
    expect(result).toEqual({ type: "rested" });
  });

  it("detects upgrade when a card gains a + suffix", () => {
    const upgradedDeck = new Set(["Strike", "Defend", "Bash+"]);
    const result = detectRestSiteOutcome({
      previousDeckNames: baseDeck,
      currentDeckNames: upgradedDeck,
    });
    expect(result).toEqual({ type: "upgraded", cardName: "Bash+" });
  });

  it("returns rested when new card is not an upgrade of existing", () => {
    const weirdDeck = new Set(["Strike", "Defend", "Bash", "Wound"]);
    const result = detectRestSiteOutcome({
      previousDeckNames: baseDeck,
      currentDeckNames: weirdDeck,
    });
    expect(result).toEqual({ type: "rested" });
  });

  it("detects upgrade when base card disappears and + version appears", () => {
    const upgradedDeck = new Set(["Strike", "Defend", "Bash+"]);
    const prevDeck = new Set(["Strike", "Defend", "Bash"]);
    const result = detectRestSiteOutcome({
      previousDeckNames: prevDeck,
      currentDeckNames: upgradedDeck,
    });
    expect(result).toEqual({ type: "upgraded", cardName: "Bash+" });
  });
});
