import { describe, it, expect } from "vitest";
import { buildNarratorInput } from "./build-narrator-input";
import type { ScoredPath } from "./score-paths";
import type { PathNode } from "./path-patterns";
import type { RunState } from "./run-state";

function emptyRunState(overrides: Partial<RunState> = {}): RunState {
  return {
    hp: { current: 60, max: 80, ratio: 0.75 },
    gold: 100,
    act: 2,
    floor: 20,
    floorsRemainingInAct: 10,
    ascension: 10,
    deck: { size: 18, archetype: null, avgUpgradeRatio: 0.2, removalCandidates: 4 },
    relics: { combatRelevant: [], pathAffecting: [] },
    riskCapacity: { hpBufferAbsolute: 20, expectedDamagePerFight: 16, fightsBeforeDanger: 1, verdict: "tight" },
    eliteBudget: { actTarget: [2, 3], eliteFloorsFought: [], remaining: 2, shouldSeek: true },
    goldMath: { current: 100, removalAffordable: true, shopVisitsAhead: 1, projectedShopBudget: 220 },
    monsterPool: { currentPool: "easy", fightsUntilHardPool: 3 },
    bossPreview: {
      candidates: [],
      dangerousMatchups: [],
      preBossRestFloor: 30,
      hpEnteringPreBossRest: 40,
      preBossRestRecommendation: "heal",
    },
    ...overrides,
  };
}

function node(type: PathNode["type"], floor: number, col = 0): PathNode {
  return { type, floor, nodeId: `${col},${floor}` } as PathNode;
}

function makeScored(
  id: string,
  nodes: PathNode[],
  score: number,
  breakdown: Record<string, number>,
): ScoredPath {
  return {
    id,
    nodes,
    patterns: [],
    aggregates: {
      elitesTaken: nodes.filter((n) => n.type === "elite").length,
      monstersTaken: nodes.filter((n) => n.type === "monster").length,
      restsTaken: nodes.filter((n) => n.type === "rest").length,
      shopsTaken: nodes.filter((n) => n.type === "shop").length,
      hardPoolFightsOnPath: 0,
      totalFights: 0,
      projectedHpEnteringPreBossRest: 50,
      fightBudgetStatus: "within_budget",
      hpProjectionVerdict: "safe",
    },
    score,
    scoreBreakdown: breakdown,
    disqualified: false,
    disqualifyReasons: [],
  };
}

describe("buildNarratorInput", () => {
  it("summarizes the chosen path as a short arrow-separated sequence", () => {
    const winner = makeScored(
      "w",
      [node("monster", 1), node("elite", 2), node("rest", 3), node("treasure", 4)],
      30,
      { elitesTaken: 10, restBeforeElite: 8, treasuresTaken: 6 },
    );
    const input = buildNarratorInput(winner, [], emptyRunState());
    expect(input.chosenPath.summary).toMatch(/monster.*elite.*rest.*treasure/i);
    expect(input.chosenPath.elites).toBe(1);
    expect(input.chosenPath.treasures).toBe(1);
  });

  it("emits an active rule for each feature clearing its threshold", () => {
    const winner = makeScored(
      "w",
      [node("elite", 1), node("rest", 2)],
      25,
      {
        elitesTaken: 10,
        restAfterElite: 5,
        treasuresTaken: 0,
        unknownsActs1And2: 0,
        projectedHpAtBossFight: 3.2,
        hpDipBelow30PctPenalty: 0,
        hpDipBelow15PctPenalty: 0,
        backToBackShopPairUnderGold: 0,
        hardPoolChainLength: 0,
      },
    );
    const input = buildNarratorInput(winner, [], emptyRunState());
    const kinds = input.activeRules.map((r) => r.kind);
    expect(kinds).toContain("elitesTaken");
    expect(kinds).toContain("restAfterElite");
    expect(kinds).toContain("projectedHpAtBossFight");
    expect(kinds).not.toContain("treasuresTaken");
    expect(kinds).not.toContain("hpDipBelow30PctPenalty");
  });

  it("emits a runners-up tradeoff entry for each provided runner-up up to 2", () => {
    const winner = makeScored(
      "w",
      [node("elite", 1), node("rest", 2)],
      30,
      { elitesTaken: 10, restBeforeElite: 8 },
    );
    const runnerA = makeScored(
      "a",
      [node("monster", 1), node("rest", 2)],
      15,
      { elitesTaken: 0 },
    );
    const runnerB = makeScored(
      "b",
      [node("shop", 1), node("rest", 2)],
      10,
      { elitesTaken: 0, backToBackShopPairUnderGold: -3 },
    );
    const input = buildNarratorInput(winner, [runnerA, runnerB], emptyRunState());
    expect(input.runnersUpTradeoffs).toHaveLength(2);
    expect(input.runnersUpTradeoffs[0].vsPosition).toBe(1);
    expect(input.runnersUpTradeoffs[1].vsPosition).toBe(2);
  });

  it("caps runnersUpTradeoffs at 2 even when more runners-up are supplied", () => {
    const winner = makeScored("w", [node("elite", 1)], 10, { elitesTaken: 10 });
    const r1 = makeScored("r1", [node("monster", 1)], 5, { elitesTaken: 0 });
    const r2 = makeScored("r2", [node("shop", 1)], 4, { elitesTaken: 0 });
    const r3 = makeScored("r3", [node("rest", 1)], 3, { elitesTaken: 0 });
    const input = buildNarratorInput(winner, [r1, r2, r3], emptyRunState());
    expect(input.runnersUpTradeoffs).toHaveLength(2);
  });

  it("trims runState to the documented fields only", () => {
    const winner = makeScored("w", [node("elite", 1)], 10, { elitesTaken: 10 });
    const input = buildNarratorInput(winner, [], emptyRunState({
      act: 3,
      ascension: 10,
      floor: 44,
      hp: { current: 40, max: 80, ratio: 0.5 },
      gold: 250,
      deck: { size: 16, archetype: "exhaust", avgUpgradeRatio: 0.3, removalCandidates: 2 },
    }));
    expect(input.runState.hpPct).toBeCloseTo(0.5, 2);
    expect(input.runState.gold).toBe(250);
    expect(input.runState.act).toBe(3);
    expect(input.runState.floor).toBe(44);
    expect(input.runState.ascension).toBe(10);
    expect(input.runState.committedArchetype).toBe("exhaust");
  });
});
