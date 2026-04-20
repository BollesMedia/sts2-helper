import { describe, it, expect } from "vitest";
import {
  scorePaths,
  MAP_SCORE_WEIGHTS,
  MIN_SHOP_PRICE_FLOOR,
  REST_HEAL_PCT,
} from "./score-paths";
import type { EnrichedPath } from "./enrich-paths";
import type { RunState } from "./run-state";
import type { PathNode } from "./path-patterns";

function emptyRunState(overrides: Partial<RunState> = {}): RunState {
  return {
    hp: { current: 60, max: 80, ratio: 0.75 },
    gold: 100,
    act: 1,
    floor: 1,
    floorsRemainingInAct: 16,
    ascension: 10,
    deck: { size: 15, archetype: null, avgUpgradeRatio: 0, removalCandidates: 10 },
    relics: { combatRelevant: [], pathAffecting: [] },
    riskCapacity: { hpBufferAbsolute: 30, expectedDamagePerFight: 16, fightsBeforeDanger: 2, verdict: "moderate" },
    eliteBudget: { actTarget: [2, 3], eliteFloorsFought: [], remaining: 2, shouldSeek: true },
    goldMath: { current: 100, removalAffordable: true, shopVisitsAhead: 1, projectedShopBudget: 220 },
    monsterPool: { currentPool: "easy", fightsUntilHardPool: 3 },
    bossPreview: {
      candidates: [],
      dangerousMatchups: [],
      preBossRestFloor: 16,
      hpEnteringPreBossRest: 40,
      preBossRestRecommendation: "heal",
    },
    ...overrides,
  };
}

describe("scorePaths constants", () => {
  it("exports the documented weight set", () => {
    expect(MAP_SCORE_WEIGHTS.elitesTaken).toBe(10);
    expect(MAP_SCORE_WEIGHTS.elitesInAct1Bonus).toBe(2);
    expect(MAP_SCORE_WEIGHTS.restBeforeElite).toBe(8);
    expect(MAP_SCORE_WEIGHTS.restAfterElite).toBe(5);
    expect(MAP_SCORE_WEIGHTS.treasuresTaken).toBe(6);
    expect(MAP_SCORE_WEIGHTS.unknownsActs1And2).toBe(2);
    expect(MAP_SCORE_WEIGHTS.unknownsAct3).toBe(1);
    expect(MAP_SCORE_WEIGHTS.projectedHpAtBossFight).toBe(4);
    expect(MAP_SCORE_WEIGHTS.distanceToAct3EliteOpportunities).toBe(3);
    expect(MAP_SCORE_WEIGHTS.hpDipBelow30PctPenalty).toBe(-5);
    expect(MAP_SCORE_WEIGHTS.hpDipBelow15PctPenalty).toBe(-12);
    expect(MAP_SCORE_WEIGHTS.backToBackShopPairUnderGold).toBe(-3);
    expect(MAP_SCORE_WEIGHTS.hardPoolChainLength).toBe(-2);
  });
  it("exports the shop-floor constant in gold", () => {
    expect(MIN_SHOP_PRICE_FLOOR).toBe(50);
  });
  it("exports the rest-heal ratio used by the post-rest projection", () => {
    expect(REST_HEAL_PCT).toBe(0.3);
  });
});

describe("scorePaths smoke", () => {
  it("returns an empty array when given no paths", () => {
    const result = scorePaths([] as EnrichedPath[], emptyRunState(), { cardRemovalCost: 75 });
    expect(result).toEqual([]);
  });
});

function makeEnriched(
  id: string,
  nodes: PathNode[],
  overrides: Partial<EnrichedPath["aggregates"]> = {},
): EnrichedPath {
  const elitesTaken = nodes.filter((n) => n.type === "elite").length;
  const restsTaken = nodes.filter((n) => n.type === "rest").length;
  const shopsTaken = nodes.filter((n) => n.type === "shop").length;
  const monstersTaken = nodes.filter((n) => n.type === "monster").length;
  return {
    id,
    nodes,
    patterns: [],
    aggregates: {
      elitesTaken,
      monstersTaken,
      restsTaken,
      shopsTaken,
      hardPoolFightsOnPath: 0,
      totalFights: elitesTaken + monstersTaken,
      projectedHpEnteringPreBossRest: 40,
      fightBudgetStatus: "within_budget",
      hpProjectionVerdict: "safe",
      ...overrides,
    },
  };
}

function node(type: PathNode["type"], floor: number, col = 0): PathNode {
  return { type, floor, col, row: floor } as PathNode;
}

describe("scorePaths — phase 1 hard filter", () => {
  it("disqualifies a path whose min HP reaches 0", () => {
    // 5 monsters in a row with expectedDmg=16 and hp=60 → dips to -20.
    const lethal = makeEnriched("lethal", [
      node("monster", 1),
      node("monster", 2),
      node("monster", 3),
      node("monster", 4),
      node("monster", 5),
    ], { monstersTaken: 5, totalFights: 5 });
    const safe = makeEnriched("safe", [
      node("monster", 1),
      node("rest", 2),
      node("monster", 3),
    ]);
    const result = scorePaths([lethal, safe], emptyRunState(), { cardRemovalCost: 75 });
    const scored = result.find((p) => p.id === "lethal");
    expect(scored?.disqualified).toBe(true);
    expect(scored?.disqualifyReasons).toContain("fatal");
  });

  it("disqualifies a 0-elite path in Act 1 when a 2-elite alternative exists and survives", () => {
    const zeroElite = makeEnriched("zero", [node("monster", 1), node("rest", 2)]);
    const twoElite = makeEnriched(
      "two",
      [node("rest", 1), node("elite", 2), node("rest", 3), node("elite", 4)],
      { elitesTaken: 2 },
    );
    const result = scorePaths(
      [zeroElite, twoElite],
      emptyRunState({ act: 1 }),
      { cardRemovalCost: 75 },
    );
    expect(result.find((p) => p.id === "zero")?.disqualified).toBe(true);
    expect(result.find((p) => p.id === "zero")?.disqualifyReasons).toContain("elite_abdication");
    expect(result.find((p) => p.id === "two")?.disqualified).toBe(false);
  });

  it("disqualifies a 0-elite path in Act 2 when a 1-elite alternative exists and survives", () => {
    const zeroElite = makeEnriched("zero", [node("monster", 1), node("rest", 2)]);
    const oneElite = makeEnriched("one", [node("rest", 1), node("elite", 2)], { elitesTaken: 1 });
    const result = scorePaths(
      [zeroElite, oneElite],
      emptyRunState({ act: 2 }),
      { cardRemovalCost: 75 },
    );
    expect(result.find((p) => p.id === "zero")?.disqualified).toBe(true);
    expect(result.find((p) => p.id === "zero")?.disqualifyReasons).toContain("elite_abdication");
  });

  it("does NOT disqualify a 0-elite path in Act 3 (abdication rule is Acts 1/2 only)", () => {
    const zeroElite = makeEnriched("zero", [node("monster", 1), node("rest", 2)]);
    const twoElite = makeEnriched(
      "two",
      [node("rest", 1), node("elite", 2), node("rest", 3), node("elite", 4)],
      { elitesTaken: 2 },
    );
    const result = scorePaths(
      [zeroElite, twoElite],
      emptyRunState({ act: 3 }),
      { cardRemovalCost: 75 },
    );
    expect(result.find((p) => p.id === "zero")?.disqualified).toBe(false);
  });

  it("disqualifies a naked-shop path when projected gold < MIN_SHOP_PRICE_FLOOR and an alternative exists", () => {
    // Starting gold 30, ~40g per fight, shop at floor 2 so gold ≈ 30 + ~0 fights = 30 < 50.
    const nakedShop = makeEnriched("naked", [node("shop", 2)], { shopsTaken: 1 });
    const viable = makeEnriched(
      "viable",
      [node("elite", 1), node("elite", 2)],
      { elitesTaken: 2 },
    );
    const result = scorePaths(
      [nakedShop, viable],
      emptyRunState({ gold: 30 }),
      { cardRemovalCost: 75 },
    );
    expect(result.find((p) => p.id === "naked")?.disqualified).toBe(true);
    expect(result.find((p) => p.id === "naked")?.disqualifyReasons).toContain("naked_shop");
  });

  it("keeps a shop path when projected gold at the shop floor is >= MIN_SHOP_PRICE_FLOOR", () => {
    const okShop = makeEnriched("ok", [node("shop", 2)], { shopsTaken: 1 });
    const other = makeEnriched("other", [node("monster", 1)]);
    const result = scorePaths(
      [okShop, other],
      emptyRunState({ gold: 100 }),
      { cardRemovalCost: 75 },
    );
    expect(result.find((p) => p.id === "ok")?.disqualified).toBe(false);
  });

  it("falls back to 'least bad' when every path is disqualified", () => {
    const fatal1 = makeEnriched("f1", [
      node("monster", 1), node("monster", 2), node("monster", 3),
      node("monster", 4), node("monster", 5),
    ]);
    const fatal2 = makeEnriched("f2", [
      node("monster", 1), node("monster", 2), node("monster", 3),
      node("monster", 4), node("monster", 5), node("monster", 6),
    ]);
    const result = scorePaths(
      [fatal1, fatal2],
      emptyRunState(),
      { cardRemovalCost: 75 },
    );
    // Both disqualified, but result is non-empty — caller still gets something.
    expect(result.length).toBe(2);
    expect(result.every((p) => p.disqualified)).toBe(true);
  });
});

describe("scorePaths — phase 2 weighted sum", () => {
  it("scores elite count with the act-1 bonus in Act 1", () => {
    const p = makeEnriched(
      "twoElite",
      [node("elite", 1), node("elite", 2)],
      { elitesTaken: 2 },
    );
    const result = scorePaths([p], emptyRunState({ act: 1 }), { cardRemovalCost: 75 });
    const breakdown = result[0].scoreBreakdown;
    expect(breakdown.elitesTaken).toBe(20);
    expect(breakdown.elitesInAct1Bonus).toBe(4);
  });

  it("applies no Act 1 bonus outside Act 1", () => {
    const p = makeEnriched(
      "twoElite",
      [node("elite", 1), node("elite", 2)],
      { elitesTaken: 2 },
    );
    const result = scorePaths([p], emptyRunState({ act: 2 }), { cardRemovalCost: 75 });
    expect(result[0].scoreBreakdown.elitesInAct1Bonus ?? 0).toBe(0);
  });

  it("counts rest-before-elite and rest-after-elite pairs", () => {
    const path = makeEnriched(
      "pair",
      [
        node("monster", 1),
        node("rest", 2),
        node("elite", 3),   // rest-before-elite pair at 2→3
        node("rest", 4),     // rest-after-elite pair at 3→4
        node("monster", 5),
      ],
      { elitesTaken: 1, restsTaken: 2, monstersTaken: 2 },
    );
    const result = scorePaths([path], emptyRunState(), { cardRemovalCost: 75 });
    expect(result[0].scoreBreakdown.restBeforeElite).toBe(8);
    expect(result[0].scoreBreakdown.restAfterElite).toBe(5);
  });

  it("scores unknowns at 2 in Act 1, 2 in Act 2, 1 in Act 3", () => {
    const mk = (act: 1 | 2 | 3) => {
      const p = makeEnriched("u", [node("event", 1), node("event", 2)]);
      return scorePaths([p], emptyRunState({ act }), { cardRemovalCost: 75 });
    };
    expect(mk(1)[0].scoreBreakdown.unknownsActs1And2).toBe(4);
    expect(mk(2)[0].scoreBreakdown.unknownsActs1And2).toBe(4);
    expect(mk(3)[0].scoreBreakdown.unknownsAct3).toBe(2);
  });

  it("treasures contribute +6 each", () => {
    const p = makeEnriched("t", [node("treasure", 1)]);
    const result = scorePaths([p], emptyRunState(), { cardRemovalCost: 75 });
    expect(result[0].scoreBreakdown.treasuresTaken).toBe(6);
  });

  it("projectedHpAtBossFight uses the post-rest HP (clamped to max)", () => {
    // Starting HP 60, max 80, expected dmg 16, restHeal = 24.
    // Path has 1 monster: HP 60 - 16 = 44 entering pre-boss rest.
    // post-rest = 44 + 24 = 68 / 80 = 0.85 × 4 = 3.4.
    const p = makeEnriched("idle", [node("monster", 1)]);
    const result = scorePaths(
      [p],
      emptyRunState({ hp: { current: 60, max: 80, ratio: 0.75 } }),
      { cardRemovalCost: 75 },
    );
    expect(result[0].scoreBreakdown.projectedHpAtBossFight).toBeCloseTo(3.4, 2);
  });

  it("penalizes hp dips below 30% and below 15%", () => {
    // Starting 80/80 hp; expected dmg 16 — 5 monsters dip to 0.
    const p = makeEnriched("dip", [
      node("monster", 1), node("monster", 2), node("monster", 3),
      node("monster", 4), node("monster", 5),
    ]);
    const result = scorePaths(
      [p],
      emptyRunState({ hp: { current: 80, max: 80, ratio: 1 } }),
      { cardRemovalCost: 75 },
    );
    expect(result[0].scoreBreakdown.hpDipBelow30PctPenalty ?? 0).toBeLessThan(0);
    expect(result[0].scoreBreakdown.hpDipBelow15PctPenalty ?? 0).toBeLessThan(0);
  });

  it("penalizes a naked back-to-back shop pair at -3", () => {
    const p = makeEnriched(
      "shops",
      [node("shop", 2), node("shop", 3)],
      { shopsTaken: 2 },
    );
    const result = scorePaths(
      [p],
      emptyRunState({ gold: 30 }),
      { cardRemovalCost: 75 },
    );
    expect(result[0].scoreBreakdown.backToBackShopPairUnderGold).toBe(-3);
  });

  it("does not penalize a back-to-back shop pair if gold at shop #2 >= cardRemovalCost", () => {
    // Gold at shop #2 = 30 + 2×40 = 110 >= 75.
    const p = makeEnriched(
      "shops",
      [
        node("monster", 1),
        node("monster", 2),
        node("shop", 3),
        node("shop", 4),
      ],
      { shopsTaken: 2, monstersTaken: 2 },
    );
    const result = scorePaths(
      [p],
      emptyRunState({ gold: 30 }),
      { cardRemovalCost: 75 },
    );
    expect(result[0].scoreBreakdown.backToBackShopPairUnderGold ?? 0).toBeCloseTo(0);
  });

  it("penalizes hard-pool chain length in Act 2 (one -2 per monster in the chain)", () => {
    const p = makeEnriched(
      "chain",
      [node("monster", 1), node("monster", 2), node("monster", 3), node("rest", 4)],
      { monstersTaken: 3, restsTaken: 1 },
    );
    const result = scorePaths([p], emptyRunState({ act: 2 }), { cardRemovalCost: 75 });
    expect(result[0].scoreBreakdown.hardPoolChainLength).toBe(-6);
  });

  it("applies no hard-pool chain penalty in Act 1", () => {
    const p = makeEnriched(
      "chain",
      [node("monster", 1), node("monster", 2), node("monster", 3)],
      { monstersTaken: 3 },
    );
    const result = scorePaths([p], emptyRunState({ act: 1 }), { cardRemovalCost: 75 });
    expect(result[0].scoreBreakdown.hardPoolChainLength ?? 0).toBe(0);
  });
});
