import { describe, it, expect } from "vitest";
import { enrichPaths } from "./enrich-paths";
import type { RunState } from "./run-state";

const runState: RunState = {
  hp: { current: 62, max: 80, ratio: 0.775 },
  gold: 215,
  act: 2,
  floor: 23,
  floorsRemainingInAct: 10,
  ascension: 10,
  deck: { size: 19, archetype: null, avgUpgradeRatio: 0.31, removalCandidates: 3 },
  relics: { combatRelevant: [], pathAffecting: [] },
  riskCapacity: {
    hpBufferAbsolute: 44,
    expectedDamagePerFight: 12,
    fightsBeforeDanger: 3,
    verdict: "moderate",
  },
  eliteBudget: { actTarget: [2, 3], eliteFloorsFought: [19], remaining: 2, shouldSeek: true },
  goldMath: { current: 215, removalAffordable: true, shopVisitsAhead: 2, projectedShopBudget: 320 },
  monsterPool: { currentPool: "hard", fightsUntilHardPool: 0 },
  bossPreview: {
    candidates: [],
    dangerousMatchups: [],
    preBossRestFloor: 32,
    hpEnteringPreBossRest: 38,
    preBossRestRecommendation: "heal",
  },
};

describe("enrichPaths", () => {
  it("annotates a path with expected patterns and aggregates", () => {
    const paths = [
      {
        id: "A",
        nodes: [
          { floor: 24, type: "monster" as const },
          { floor: 25, type: "elite" as const },
          { floor: 26, type: "rest" as const },
          { floor: 27, type: "treasure" as const },
          { floor: 28, type: "elite" as const },
          { floor: 29, type: "monster" as const },
          { floor: 30, type: "shop" as const },
          { floor: 31, type: "monster" as const },
          { floor: 32, type: "rest" as const },
          { floor: 33, type: "boss" as const },
        ],
      },
    ];

    const enriched = enrichPaths(paths, runState, /* treasureFloorByPath */ { A: 27 });
    expect(enriched).toHaveLength(1);
    const p = enriched[0];
    expect(p.patterns.some((x) => x.kind === "rest_after_elite")).toBe(true);
    expect(p.patterns.some((x) => x.kind === "elite_cluster")).toBe(true);
    expect(p.patterns.some((x) => x.kind === "treasure_before_rest")).toBe(false); // treasure→monster
    expect(p.aggregates.elitesTaken).toBe(2);
    expect(p.aggregates.restsTaken).toBe(2);
    expect(p.aggregates.shopsTaken).toBe(1);
    expect(p.aggregates.projectedHpEnteringPreBossRest).toBeLessThan(runState.hp.current);
  });
});
