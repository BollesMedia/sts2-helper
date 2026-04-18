import { describe, it, expect } from "vitest";
import { formatFactsBlock } from "./format-facts-block";
import type { RunState } from "./run-state";
import type { EnrichedPath } from "./enrich-paths";

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

const paths: EnrichedPath[] = [
  {
    id: "1",
    nodes: [
      { floor: 24, type: "monster" },
      { floor: 25, type: "elite" },
      { floor: 26, type: "rest" },
    ],
    patterns: [
      { kind: "rest_after_elite", eliteFloor: 25, restFloor: 26 },
      { kind: "heal_vs_smith_at_preboss", recommendation: "heal" },
    ],
    aggregates: {
      elitesTaken: 1,
      restsTaken: 1,
      shopsTaken: 0,
      hardPoolFightsOnPath: 1,
      projectedHpEnteringPreBossRest: 38,
    },
  },
];

describe("formatFactsBlock", () => {
  it("renders run state + candidate paths", () => {
    const out = formatFactsBlock(runState, paths);
    expect(out).toContain("=== RUN STATE ===");
    expect(out).toContain("HP: 62/80");
    expect(out).toContain("Risk capacity: MODERATE");
    expect(out).toContain("Elite budget: Act 2 target 2\u20133");
    expect(out).toContain("Monster pool: HARD");
    expect(out).toContain("=== CANDIDATE PATHS ===");
    expect(out).toContain("Path 1:");
    expect(out).toContain("Patterns: rest_after_elite");
    expect(out).toContain("Aggregate: 1 elites");
  });
});
