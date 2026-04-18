import { describe, it, expect } from "vitest";
import {
  detectRestBeforeElite,
  detectRestAfterElite,
  detectEliteCluster,
  detectBackToBackShops,
  detectTreasureBeforeRest,
  detectMonsterChain,
  detectNoRestInLateHalf,
  detectHealVsSmithAtPreboss,
  detectRestSpentTooEarly,
} from "./path-patterns";
import type { PathNode } from "./path-patterns";

describe("detectRestBeforeElite", () => {
  it("detects a rest immediately followed by an elite", () => {
    const path: PathNode[] = [
      { floor: 24, type: "monster" },
      { floor: 25, type: "rest" },
      { floor: 26, type: "elite" },
    ];
    expect(detectRestBeforeElite(path)).toEqual({
      kind: "rest_before_elite",
      restFloor: 25,
      eliteFloor: 26,
    });
  });

  it("returns null when rest is not directly before elite", () => {
    const path: PathNode[] = [
      { floor: 24, type: "rest" },
      { floor: 25, type: "monster" },
      { floor: 26, type: "elite" },
    ];
    expect(detectRestBeforeElite(path)).toBeNull();
  });

  it("returns null with no elite on path", () => {
    const path: PathNode[] = [
      { floor: 24, type: "rest" },
      { floor: 25, type: "monster" },
    ];
    expect(detectRestBeforeElite(path)).toBeNull();
  });
});

describe("detectRestAfterElite", () => {
  it("detects rest immediately after elite", () => {
    const r = detectRestAfterElite([
      { floor: 25, type: "elite" },
      { floor: 26, type: "rest" },
    ]);
    expect(r).toEqual({ kind: "rest_after_elite", eliteFloor: 25, restFloor: 26 });
  });

  it("returns null without rest after elite", () => {
    expect(
      detectRestAfterElite([
        { floor: 25, type: "elite" },
        { floor: 26, type: "monster" },
      ]),
    ).toBeNull();
  });
});

describe("detectEliteCluster", () => {
  it("flags two elites within 3 floors", () => {
    const r = detectEliteCluster([
      { floor: 25, type: "elite" },
      { floor: 26, type: "rest" },
      { floor: 27, type: "elite" },
    ]);
    expect(r?.kind).toBe("elite_cluster");
  });

  it("null when elites are 4+ floors apart", () => {
    const r = detectEliteCluster([
      { floor: 25, type: "elite" },
      { floor: 30, type: "elite" },
    ]);
    expect(r).toBeNull();
  });

  it("returns only clustered floors, excluding unrelated elites", () => {
    const r = detectEliteCluster([
      { floor: 19, type: "elite" },
      { floor: 30, type: "elite" },
      { floor: 32, type: "elite" },
    ]);
    expect(r).toEqual({ kind: "elite_cluster", floors: [30, 32] });
  });
});

describe("detectBackToBackShops", () => {
  it("flags adjacent shops", () => {
    const r = detectBackToBackShops([
      { floor: 30, type: "shop" },
      { floor: 31, type: "shop" },
    ]);
    expect(r?.kind).toBe("back_to_back_shops");
  });

  it("null when shops are separated", () => {
    const r = detectBackToBackShops([
      { floor: 30, type: "shop" },
      { floor: 31, type: "monster" },
      { floor: 32, type: "shop" },
    ]);
    expect(r).toBeNull();
  });
});

describe("detectTreasureBeforeRest", () => {
  it("flags treasure directly before rest", () => {
    const r = detectTreasureBeforeRest([
      { floor: 27, type: "treasure" },
      { floor: 28, type: "rest" },
    ]);
    expect(r?.kind).toBe("treasure_before_rest");
  });

  it("null when treasure is not before rest", () => {
    const r = detectTreasureBeforeRest([{ floor: 27, type: "treasure" }]);
    expect(r).toBeNull();
  });
});

describe("detectMonsterChain", () => {
  it("flags 3 monsters in a row", () => {
    const r = detectMonsterChain([
      { floor: 1, type: "monster" },
      { floor: 2, type: "monster" },
      { floor: 3, type: "monster" },
    ]);
    expect(r?.kind).toBe("monster_chain_for_rewards");
    if (r?.kind === "monster_chain_for_rewards") {
      expect(r.length).toBe(3);
    }
  });

  it("null for 2 in a row", () => {
    const r = detectMonsterChain([
      { floor: 1, type: "monster" },
      { floor: 2, type: "monster" },
    ]);
    expect(r).toBeNull();
  });
});

describe("detectNoRestInLateHalf", () => {
  it("flags late elite without mid-late rest", () => {
    const r = detectNoRestInLateHalf(
      [
        { floor: 27, type: "treasure" },
        { floor: 28, type: "elite" },
        { floor: 29, type: "monster" },
        { floor: 32, type: "rest" },
        { floor: 33, type: "boss" },
      ],
      27,
      32,
    );
    expect(r?.kind).toBe("no_rest_in_late_half");
  });

  it("null when late elite has mid-late rest before pre-boss", () => {
    const r = detectNoRestInLateHalf(
      [
        { floor: 27, type: "treasure" },
        { floor: 28, type: "elite" },
        { floor: 29, type: "rest" },
        { floor: 30, type: "monster" },
        { floor: 32, type: "rest" },
        { floor: 33, type: "boss" },
      ],
      27,
      32,
    );
    expect(r).toBeNull();
  });

  it("flags late elite when boss is terminal and only rest is the pre-boss rest", () => {
    // Regression: using path[last].floor as the bound let the pre-boss rest
    // satisfy the mid-half-rest check. With preBossRestFloor passed in, the
    // late elite is correctly flagged.
    const r = detectNoRestInLateHalf(
      [
        { floor: 27, type: "treasure" },
        { floor: 28, type: "elite" },
        { floor: 29, type: "monster" },
        { floor: 30, type: "monster" },
        { floor: 31, type: "shop" },
        { floor: 32, type: "rest" },
        { floor: 33, type: "boss" },
      ],
      27,
      32,
    );
    expect(r?.kind).toBe("no_rest_in_late_half");
  });
});

describe("detectHealVsSmithAtPreboss", () => {
  it("tags with smith recommendation", () => {
    expect(detectHealVsSmithAtPreboss("smith")).toEqual({
      kind: "heal_vs_smith_at_preboss",
      recommendation: "smith",
    });
  });
});

describe("detectRestSpentTooEarly", () => {
  it("flags non-pre-boss rest at high HP", () => {
    const r = detectRestSpentTooEarly(
      [
        { floor: 25, type: "rest" },
        { floor: 26, type: "monster" },
      ],
      0.95,
      32,
    );
    expect(r?.kind).toBe("rest_spent_too_early");
  });

  it("null when HP is low enough to justify heal", () => {
    const r = detectRestSpentTooEarly(
      [{ floor: 25, type: "rest" }],
      0.5,
      32,
    );
    expect(r).toBeNull();
  });
});
