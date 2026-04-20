import { describe, it, expect } from "vitest";
import { tagCard } from "./card-tags";
import type { DeckState } from "./deck-state";

const emptyDeckState: DeckState = {
  size: 10,
  act: 1,
  floor: 1,
  ascension: 10,
  composition: { strikes: 5, defends: 4, deadCards: 9, upgraded: 0, upgradeRatio: 0 },
  sizeVerdict: "too_thin",
  archetypes: { viable: [], committed: null, orphaned: [] },
  engine: {
    hasScaling: false,
    hasBlockPayoff: false,
    hasRemovalMomentum: 0,
    hasDrawPower: false,
  },
  hp: { current: 80, max: 80, ratio: 1 },
  upcoming: { nextNodeType: null, bossesPossible: [], dangerousMatchups: [] },
};

const committedPoisonState: DeckState = {
  ...emptyDeckState,
  archetypes: {
    viable: [{ name: "poison", supportCount: 3, hasKeystone: true }],
    committed: "poison",
    orphaned: [],
  },
};

describe("tagCard — lookup-driven", () => {
  it("keystone card returns keystoneFor + role from lookup", () => {
    const tags = tagCard({ name: "Inflame" }, emptyDeckState);
    expect(tags.role).toBe("scaling");
    expect(tags.keystoneFor).toBe("strength");
  });

  it("upgrade suffix strips for lookup but sets upgradeLevel=1", () => {
    const tags = tagCard({ name: "Inflame+" }, emptyDeckState);
    expect(tags.keystoneFor).toBe("strength");
    expect(tags.upgradeLevel).toBe(1);
  });
});

describe("tagCard — deadWithCurrentDeck", () => {
  it("NEVER flags a keystone as dead, regardless of deck state", () => {
    const tags = tagCard({ name: "Inflame" }, emptyDeckState);
    expect(tags.deadWithCurrentDeck).toBe(false);
  });

  it("NEVER flags a scaling card as dead in an uncommitted deck", () => {
    const tags = tagCard({ name: "Inflame" }, emptyDeckState);
    expect(tags.deadWithCurrentDeck).toBe(false);
  });

  it("flags a scaling card as dead when committed to a DIFFERENT archetype", () => {
    // Inflame fits strength; current deck committed to poison.
    const tags = tagCard({ name: "Inflame" }, committedPoisonState);
    expect(tags.deadWithCurrentDeck).toBe(true);
  });

  it("flags a power_payoff as dead when no scaling source AND no scaling sibling", () => {
    // Heavy Blade classified as power_payoff; deck has no scaling; no siblings
    // provide scaling either.
    const tags = tagCard({ name: "Heavy Blade" }, emptyDeckState, [
      { name: "Bash" },
      { name: "Pommel Strike" },
    ]);
    expect(tags.deadWithCurrentDeck).toBe(true);
  });

  it("does NOT flag a power_payoff as dead when a sibling pick is scaling", () => {
    const tags = tagCard({ name: "Heavy Blade" }, emptyDeckState, [
      { name: "Bash" },
      { name: "Inflame" }, // scaling sibling — saves the payoff
    ]);
    expect(tags.deadWithCurrentDeck).toBe(false);
  });
});

describe("tagCard — duplicatePenalty", () => {
  it("flags duplicate when deck already has maxCopies and this is over", () => {
    const stateWithInflame: DeckState = {
      ...emptyDeckState,
      size: 11,
    };
    const tags = tagCard({ name: "Inflame" }, stateWithInflame, [], [
      { name: "Inflame" },
    ]);
    expect(tags.duplicatePenalty).toBe(true);
  });

  it("does not flag duplicate for high-maxCopies basics", () => {
    const tags = tagCard({ name: "Strike" }, emptyDeckState, [], [
      { name: "Strike" },
      { name: "Strike" },
    ]);
    expect(tags.duplicatePenalty).toBe(false);
  });
});
