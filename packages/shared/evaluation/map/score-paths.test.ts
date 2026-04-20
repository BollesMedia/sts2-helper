import { describe, it, expect } from "vitest";
import {
  scorePaths,
  MAP_SCORE_WEIGHTS,
  MIN_SHOP_PRICE_FLOOR,
  REST_HEAL_PCT,
} from "./score-paths";
import type { EnrichedPath } from "./enrich-paths";
import type { RunState } from "./run-state";

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
