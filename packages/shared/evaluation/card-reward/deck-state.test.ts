import { describe, it, expect } from "vitest";
import { computeDeckState } from "./deck-state";
import type { DeckStateInputs } from "./deck-state";

function card(name: string, upgraded = false) {
  return { name: upgraded ? `${name}+` : name, description: "", keywords: [] };
}

const baseInputs = (overrides: Partial<DeckStateInputs> = {}): DeckStateInputs => ({
  deck: [],
  relics: [],
  act: 1,
  floor: 1,
  ascension: 10,
  hp: { current: 80, max: 80 },
  ...overrides,
});

describe("computeDeckState — size verdict", () => {
  it("returns too_thin for a 10-card starter in Act 1", () => {
    const deck = [
      ...Array(5).fill(0).map(() => card("Strike")),
      ...Array(4).fill(0).map(() => card("Defend")),
      card("Bash"),
    ];
    const state = computeDeckState(baseInputs({ deck }));
    expect(state.sizeVerdict).toBe("too_thin");
    expect(state.size).toBe(10);
  });

  it("returns healthy for a 14-card Act 1 deck", () => {
    const deck = Array(14).fill(0).map(() => card("Strike"));
    const state = computeDeckState(baseInputs({ deck, floor: 8 }));
    expect(state.sizeVerdict).toBe("healthy");
  });

  it("returns bloated for a 20-card Act 1 deck", () => {
    const deck = Array(20).fill(0).map(() => card("Strike"));
    const state = computeDeckState(baseInputs({ deck }));
    expect(state.sizeVerdict).toBe("bloated");
  });

  it("returns healthy for an 18-card Act 2 deck", () => {
    const deck = Array(18).fill(0).map(() => card("Strike"));
    const state = computeDeckState(baseInputs({ deck, act: 2, floor: 22 }));
    expect(state.sizeVerdict).toBe("healthy");
  });
});

describe("computeDeckState — archetypes", () => {
  it("flags a viable archetype when 2+ support cards present", () => {
    const deck = [
      { name: "Inflame", description: "", keywords: [] },
      { name: "Demon Form", description: "", keywords: [] },
      { name: "Strike", description: "", keywords: [] },
    ];
    const state = computeDeckState(baseInputs({ deck }));
    const strength = state.archetypes.viable.find((a) => a.name === "strength");
    expect(strength).toBeDefined();
    expect(strength?.supportCount).toBeGreaterThanOrEqual(2);
    expect(strength?.hasKeystone).toBe(true); // Inflame is a keystone
    expect(state.archetypes.committed).toBe("strength");
  });

  it("does not commit when no keystone is present", () => {
    // Brand and Howl from Beyond are strength signals but not keystones in card-roles.json.
    const deck = [
      { name: "Brand", description: "", keywords: [] },
      { name: "Howl From Beyond", description: "", keywords: [] },
      { name: "Strike", description: "", keywords: [] },
    ];
    const state = computeDeckState(baseInputs({ deck }));
    expect(state.archetypes.committed).toBeNull();
  });

  it("returns zero viable archetypes for a pure starter deck", () => {
    const deck = [
      ...Array(5).fill(0).map(() => ({ name: "Strike", description: "", keywords: [] })),
      ...Array(4).fill(0).map(() => ({ name: "Defend", description: "", keywords: [] })),
      { name: "Bash", description: "", keywords: [] },
    ];
    const state = computeDeckState(baseInputs({ deck }));
    expect(state.archetypes.viable).toEqual([]);
    expect(state.archetypes.committed).toBeNull();
    expect(state.archetypes.orphaned).toEqual([]);
  });
});

describe("computeDeckState — engine status", () => {
  it("hasScaling true when deck contains a scaling source", () => {
    const deck = [{ name: "Inflame", description: "", keywords: [] }];
    const state = computeDeckState(baseInputs({ deck }));
    expect(state.engine.hasScaling).toBe(true);
  });

  it("hasScaling false for a starter deck", () => {
    const deck = [{ name: "Strike", description: "", keywords: [] }];
    const state = computeDeckState(baseInputs({ deck }));
    expect(state.engine.hasScaling).toBe(false);
  });
});
