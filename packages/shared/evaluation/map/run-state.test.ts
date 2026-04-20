import { describe, it, expect } from "vitest";
import {
  computeEliteBudget,
  computeGoldMath,
  computeHpBudget,
  computeMonsterPool,
  computePreBossRest,
  computeRunState,
} from "./run-state";
import type { RunStateInputs } from "./run-state";

const baseInputs: RunStateInputs = {
  player: { hp: 62, max_hp: 80, gold: 215 },
  act: 2,
  floor: 23,
  ascension: 10,
  deck: {
    cards: [
      ...Array(10).fill({ id: "strike", name: "Strike", upgraded: false }),
      ...Array(5).fill({ id: "defend", name: "Defend", upgraded: true }),
      ...Array(4).fill({ id: "bash", name: "Bash", upgraded: true }),
    ],
  },
  relics: [],
  map: {
    boss: { row: 33 },
    current_position: { row: 23 },
    visited: [
      { col: 1, row: 19, type: "Elite" },
    ],
    future: [
      { col: 1, row: 24, type: "Monster" },
      { col: 1, row: 25, type: "Elite" },
      { col: 1, row: 26, type: "Rest" },
      { col: 1, row: 27, type: "Treasure" },
      { col: 1, row: 28, type: "Monster" },
      { col: 1, row: 29, type: "Elite" },
      { col: 1, row: 30, type: "Shop" },
      { col: 1, row: 31, type: "Monster" },
      { col: 1, row: 32, type: "Rest" },
    ],
  },
  shopFloorsAhead: [30],
  cardRemovalCost: 75,
};

describe("computeHpBudget", () => {
  it("returns moderate verdict for mid-range buffer", () => {
    const hp = computeHpBudget({ hp: 62, max_hp: 80 }, 10, 19);
    expect(hp.verdict).toBe("moderate");
    expect(hp.expectedDamagePerFight).toBeGreaterThan(0);
    expect(hp.fightsBeforeDanger).toBeGreaterThanOrEqual(2);
  });

  it("returns critical verdict at low HP", () => {
    const hp = computeHpBudget({ hp: 10, max_hp: 80 }, 10, 19);
    expect(hp.verdict).toBe("critical");
  });

  it("returns abundant verdict at high HP with small deck", () => {
    const hp = computeHpBudget({ hp: 75, max_hp: 80 }, 10, 15);
    expect(hp.verdict).toBe("abundant");
  });
});

describe("computeEliteBudget", () => {
  it("Act 2 target (2,3) with 1 elite fought should-seek true", () => {
    const b = computeEliteBudget(2, [{ floor: 19, type: "Elite" }]);
    expect(b.actTarget).toEqual([2, 3]);
    expect(b.eliteFloorsFought).toEqual([19]);
    expect(b.remaining).toBe(2);
    expect(b.shouldSeek).toBe(true);
  });

  it("Act 3 with 1 elite already fought still wants 2 more — relic density goal", () => {
    const b = computeEliteBudget(3, [{ floor: 42, type: "Elite" }]);
    expect(b.actTarget).toEqual([2, 3]);
    expect(b.remaining).toBe(2);
    expect(b.shouldSeek).toBe(true);
  });

  it("Act 1 untouched returns target (2,3)", () => {
    const b = computeEliteBudget(1, []);
    expect(b.actTarget).toEqual([2, 3]);
    expect(b.remaining).toBe(3);
  });
});

describe("computeGoldMath", () => {
  it("affordable removal and 2 shops ahead projects budget", () => {
    const g = computeGoldMath({ gold: 215 }, 75, [30, 42]);
    expect(g.current).toBe(215);
    expect(g.removalAffordable).toBe(true);
    expect(g.shopVisitsAhead).toBe(2);
    expect(g.projectedShopBudget).toBeGreaterThan(215);
  });

  it("unaffordable removal flagged when gold below removal cost", () => {
    const g = computeGoldMath({ gold: 40 }, 75, []);
    expect(g.removalAffordable).toBe(false);
    expect(g.shopVisitsAhead).toBe(0);
  });

  it("removalAffordable is false when cost is null (unknown)", () => {
    const g = computeGoldMath({ gold: 200 }, null, [30]);
    expect(g.removalAffordable).toBe(false);
  });
});

describe("computeMonsterPool", () => {
  it("Act 1 after 2 monster fights is still easy pool, 1 until hard", () => {
    const p = computeMonsterPool(1, [
      { floor: 1, type: "Monster" },
      { floor: 2, type: "Monster" },
    ]);
    expect(p.currentPool).toBe("easy");
    expect(p.fightsUntilHardPool).toBe(1);
  });

  it("Act 1 after 3 monster fights switches to hard", () => {
    const p = computeMonsterPool(1, [
      { floor: 1, type: "Monster" },
      { floor: 2, type: "Monster" },
      { floor: 3, type: "Monster" },
    ]);
    expect(p.currentPool).toBe("hard");
    expect(p.fightsUntilHardPool).toBe(0);
  });

  it("Act 2 switches after 2 monster fights", () => {
    const p = computeMonsterPool(2, [
      { floor: 18, type: "Monster" },
      { floor: 19, type: "Monster" },
    ]);
    expect(p.currentPool).toBe("hard");
  });

  it("Elite fights do not count toward easy-pool quota", () => {
    const p = computeMonsterPool(1, [
      { floor: 1, type: "Monster" },
      { floor: 2, type: "Elite" },
    ]);
    expect(p.currentPool).toBe("easy");
    expect(p.fightsUntilHardPool).toBe(2);
  });
});

describe("computePreBossRest", () => {
  it("recommends heal when projected HP is below 65%", () => {
    const r = computePreBossRest({
      bossRow: 33,
      currentHp: 62,
      maxHp: 80,
      expectedDamagePerFight: 12,
      fightsOnExpectedPath: 4,
      upgradeCandidates: 3,
    });
    expect(r.preBossRestFloor).toBe(32); // bossRow - 1
    expect(r.hpEnteringPreBossRest).toBe(62 - 12 * 4); // 14
    expect(r.preBossRestRecommendation).toBe("heal");
  });

  it("recommends smith when HP is above 70% and candidates exist", () => {
    const r = computePreBossRest({
      bossRow: 33,
      currentHp: 78,
      maxHp: 80,
      expectedDamagePerFight: 12,
      fightsOnExpectedPath: 0,
      upgradeCandidates: 5,
    });
    expect(r.preBossRestRecommendation).toBe("smith");
  });

  it("recommends close_call in the 65-70% band", () => {
    const r = computePreBossRest({
      bossRow: 33,
      currentHp: 60,
      maxHp: 90, // 66% — in the close_call band
      expectedDamagePerFight: 8,
      fightsOnExpectedPath: 0,
      upgradeCandidates: 3,
    });
    expect(r.preBossRestRecommendation).toBe("close_call");
  });

  it("recommends heal when no upgrade candidates exist regardless of HP", () => {
    const r = computePreBossRest({
      bossRow: 33,
      currentHp: 80,
      maxHp: 80,
      expectedDamagePerFight: 8,
      fightsOnExpectedPath: 0,
      upgradeCandidates: 0,
    });
    expect(r.preBossRestRecommendation).toBe("heal");
  });
});

describe("computeRunState", () => {
  it("composes all computations with baseInputs", () => {
    const rs = computeRunState(baseInputs);
    expect(rs.act).toBe(2);
    expect(rs.floor).toBe(23);
    expect(rs.floorsRemainingInAct).toBe(10);
    expect(rs.hp.ratio).toBeCloseTo(62 / 80, 2);
    expect(rs.deck.size).toBe(19);
    expect(rs.deck.archetype).toBeNull(); // phase 1
    expect(rs.riskCapacity.verdict).toBe("moderate");
    expect(rs.eliteBudget.actTarget).toEqual([2, 3]);
    expect(rs.monsterPool.currentPool).toBe("easy");
    expect(rs.monsterPool.fightsUntilHardPool).toBe(2);
    expect(rs.bossPreview.preBossRestFloor).toBe(32);
  });
});
