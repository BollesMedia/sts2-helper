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
    expect(p.aggregates.monstersTaken).toBe(3);
    expect(p.aggregates.restsTaken).toBe(2);
    expect(p.aggregates.shopsTaken).toBe(1);
    expect(p.aggregates.totalFights).toBe(5);
    expect(p.aggregates.projectedHpEnteringPreBossRest).toBeLessThan(runState.hp.current);
  });

  it("reports within_budget when total fights fit inside fightsBeforeDanger + rest equivalents", () => {
    // fightsBeforeDanger=3, restsTaken=1 → restEquivalents=2 → effectiveBudget=5.
    // 3 fights ≤ 5 → within_budget.
    const paths = [
      {
        id: "A",
        nodes: [
          { floor: 24, type: "monster" as const },
          { floor: 25, type: "monster" as const },
          { floor: 26, type: "rest" as const },
          { floor: 27, type: "monster" as const },
        ],
      },
    ];
    const enriched = enrichPaths(paths, runState, {});
    expect(enriched[0].aggregates.fightBudgetStatus).toBe("within_budget");
  });

  it("reports tight when total fights slightly exceed effective budget", () => {
    // Use a larger fightsBeforeDanger so the 1.3× band spans integer counts.
    // fightsBeforeDanger=10, rests=0 → effectiveBudget=10, 1.3× = 13.
    // 12 fights > 10 but ≤ 13 → tight.
    const abundant: RunState = {
      ...runState,
      riskCapacity: { ...runState.riskCapacity, fightsBeforeDanger: 10 },
    };
    const paths = [
      {
        id: "A",
        nodes: Array.from({ length: 12 }, (_, i) => ({
          floor: 24 + i,
          type: "monster" as const,
        })),
      },
    ];
    const enriched = enrichPaths(paths, abundant, {});
    expect(enriched[0].aggregates.fightBudgetStatus).toBe("tight");
  });

  it("reports exceeds_budget when total fights significantly exceed effective budget", () => {
    // fightsBeforeDanger=3, restsTaken=0 → effectiveBudget=3, 1.3× = 3.9.
    // 6 fights > 3.9 → exceeds_budget.
    const paths = [
      {
        id: "A",
        nodes: [
          { floor: 24, type: "monster" as const },
          { floor: 25, type: "monster" as const },
          { floor: 26, type: "monster" as const },
          { floor: 27, type: "monster" as const },
          { floor: 28, type: "monster" as const },
          { floor: 29, type: "elite" as const },
        ],
      },
    ];
    const enriched = enrichPaths(paths, runState, {});
    expect(enriched[0].aggregates.fightBudgetStatus).toBe("exceeds_budget");
  });

  it("maps hpProjectionVerdict from projected ratio buckets", () => {
    // hp.max=80. projectedHp = 62 - 12*fights.
    //   0 fights → 62/80 = 0.775 → safe
    const safePath = [{ id: "S", nodes: [{ floor: 24, type: "rest" as const }] }];
    expect(enrichPaths(safePath, runState, {})[0].aggregates.hpProjectionVerdict).toBe("safe");

    // 3 fights → 62 - 36 = 26 → 26/80 = 0.325 → risky
    const riskyPath = [
      {
        id: "R",
        nodes: [
          { floor: 24, type: "monster" as const },
          { floor: 25, type: "monster" as const },
          { floor: 26, type: "monster" as const },
        ],
      },
    ];
    expect(enrichPaths(riskyPath, runState, {})[0].aggregates.hpProjectionVerdict).toBe("risky");

    // 5 fights → 62 - 60 = 2 → 2/80 = 0.025 → critical
    const criticalPath = [
      {
        id: "C",
        nodes: [
          { floor: 24, type: "monster" as const },
          { floor: 25, type: "monster" as const },
          { floor: 26, type: "monster" as const },
          { floor: 27, type: "monster" as const },
          { floor: 28, type: "monster" as const },
        ],
      },
    ];
    expect(enrichPaths(criticalPath, runState, {})[0].aggregates.hpProjectionVerdict).toBe("critical");
  });

  it("REST→ELITE pairs survive from low HP — walk simulator accounts for in-path heals", () => {
    // Mirrors the real failure case: player at 19/77 HP, path has two
    // rest→elite pairs. Old linear projection flagged this CRITICAL
    // (19 - 5·expectedDmg = negative); walk sim sees the heals and
    // returns a survivable (non-critical) verdict.
    const lowHpRunState: RunState = {
      ...runState,
      hp: { current: 19, max: 77, ratio: 19 / 77 },
      riskCapacity: {
        ...runState.riskCapacity,
        expectedDamagePerFight: 10,
        fightsBeforeDanger: 0,
      },
      bossPreview: { ...runState.bossPreview, preBossRestFloor: 40 },
    };
    const restEliteRestElite = [
      {
        id: "P",
        nodes: [
          { floor: 24, type: "rest" as const }, // +23 → 42
          { floor: 25, type: "elite" as const }, // -15 → 27
          { floor: 26, type: "monster" as const }, // -10 → 17
          { floor: 27, type: "treasure" as const }, // 17
          { floor: 28, type: "rest" as const }, // +23 → 40
          { floor: 29, type: "elite" as const }, // -15 → 25
        ],
      },
    ];
    const p = enrichPaths(restEliteRestElite, lowHpRunState, {})[0];
    expect(p.aggregates.hpProjectionVerdict).not.toBe("critical");
    expect(p.aggregates.projectedHpEnteringPreBossRest).toBeGreaterThan(0);
  });

  it("flags paths with mid-path 0-HP dips as CRITICAL even if final HP is fine", () => {
    // Starts 19/77, no rests until very late, so HP crashes to 0 mid-path
    // before the eventual rest restores it. The minHpAlongPath floor
    // catches this.
    const lowHpRunState: RunState = {
      ...runState,
      hp: { current: 19, max: 77, ratio: 19 / 77 },
      riskCapacity: {
        ...runState.riskCapacity,
        expectedDamagePerFight: 10,
        fightsBeforeDanger: 0,
      },
      bossPreview: { ...runState.bossPreview, preBossRestFloor: 40 },
    };
    const deathDipPath = [
      {
        id: "D",
        nodes: [
          { floor: 24, type: "monster" as const }, // 19-10=9
          { floor: 25, type: "monster" as const }, // -10 → -1 (death)
          { floor: 26, type: "monster" as const },
          { floor: 27, type: "rest" as const },
          { floor: 28, type: "monster" as const },
        ],
      },
    ];
    expect(
      enrichPaths(deathDipPath, lowHpRunState, {})[0].aggregates
        .hpProjectionVerdict,
    ).toBe("critical");
  });
});
