import { describe, it, expect } from "vitest";
import { createContextHash } from "./context-hash";
import type { EvaluationContext } from "./types";

const baseContext: EvaluationContext = {
  character: "the ironclad",
  archetypes: [{ archetype: "exhaust", confidence: 80 }],
  primaryArchetype: "exhaust",
  act: 2,
  floor: 15,
  ascension: 6,
  deckSize: 18,
  hpPercent: 0.75,
  gold: 200,
  energy: 3,
  relicIds: ["BURNING_BLOOD"],
  hasScaling: true,
  curseCount: 0,
  deckCards: [],
  drawSources: [],
  scalingSources: [],
  curseNames: [],
  relics: [],
  potionNames: [],
  upgradeCount: 3,
  deckMaturity: 0.5,
  relicCount: 1,
};

describe("createContextHash", () => {
  it("creates a deterministic hash from context", () => {
    const hash1 = createContextHash(baseContext);
    const hash2 = createContextHash(baseContext);
    expect(hash1).toBe(hash2);
  });

  it("includes character, archetype, act, and deck size bucket", () => {
    const hash = createContextHash(baseContext);
    expect(hash).toContain("the ironclad");
    expect(hash).toContain("exhaust");
    expect(hash).toContain("act2");
  });

  it("changes when archetype changes", () => {
    const hash1 = createContextHash(baseContext);
    const hash2 = createContextHash({ ...baseContext, primaryArchetype: "strength" });
    expect(hash1).not.toBe(hash2);
  });

  it("handles null archetype", () => {
    const hash = createContextHash({ ...baseContext, primaryArchetype: null });
    expect(hash).toContain("none");
  });

  it("buckets deck size correctly", () => {
    const small = createContextHash({ ...baseContext, deckSize: 12 });
    const medium = createContextHash({ ...baseContext, deckSize: 20 });
    const large = createContextHash({ ...baseContext, deckSize: 30 });
    expect(small).not.toBe(medium);
    expect(medium).not.toBe(large);
  });
});

