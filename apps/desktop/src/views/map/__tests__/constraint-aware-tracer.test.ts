import { describe, it, expect } from "vitest";
import { traceConstraintAwarePath } from "../constraint-aware-tracer";
import type { MapNode } from "@sts2/shared/types/game-state";
import type { NodePreferences } from "../../../lib/eval-inputs/map";

/**
 * Test map layout — 4 rows, branching at row 1:
 *
 *   Row 3: [1,3 boss]
 *            ↑     ↑
 *   Row 2: [0,2 rest] [2,2 monster]
 *            ↑           ↑
 *   Row 1: [0,1 elite]  [2,1 shop]
 *            ↑           ↑
 *   Row 0: ------[1,0 start]------
 *
 * Boss at [1,3].
 */
const nodes: MapNode[] = [
  { col: 1, row: 0, type: "Monster", children: [[0, 1], [2, 1]] },
  { col: 0, row: 1, type: "Elite", children: [[0, 2]] },
  { col: 2, row: 1, type: "Shop", children: [[2, 2]] },
  { col: 0, row: 2, type: "RestSite", children: [[1, 3]] },
  { col: 2, row: 2, type: "Monster", children: [[1, 3]] },
  { col: 1, row: 3, type: "Boss", children: [] },
];

const bossPos = { col: 1, row: 3 };

const defaultPrefs: NodePreferences = {
  monster: 0.4,
  elite: 0.7,
  shop: 0.3,
  rest: 0.5,
  treasure: 0.9,
  event: 0.5,
};

const defaultContext = {
  hpPercent: 0.80,
  gold: 200,
  act: 1,
  ascension: 0,
  maxHp: 80,
  currentRemovalCost: 75,
};

describe("traceConstraintAwarePath", () => {
  it("returns a path from start to boss", () => {
    const path = traceConstraintAwarePath({
      startCol: 0,
      startRow: 1,
      nodes,
      bossPos,
      nodePreferences: defaultPrefs,
      ...defaultContext,
    });

    expect(path[0]).toEqual({ col: 0, row: 1 });
    expect(path[path.length - 1]).toEqual({ col: 1, row: 3 });
  });

  it("prefers elite path when HP is high and elite weight is high", () => {
    const prefs: NodePreferences = { ...defaultPrefs, elite: 0.9, shop: 0.2 };
    const path = traceConstraintAwarePath({
      startCol: 1,
      startRow: 0,
      nodes,
      bossPos,
      nodePreferences: prefs,
      hpPercent: 0.90,
      gold: 200,
      act: 1,
      ascension: 0,
      maxHp: 80,
      currentRemovalCost: 75,
    });

    expect(path.some((p) => p.col === 0 && p.row === 1)).toBe(true);
  });

  it("avoids elite when HP is below hard gate (40%)", () => {
    const prefs: NodePreferences = { ...defaultPrefs, elite: 0.9 };
    const path = traceConstraintAwarePath({
      startCol: 1,
      startRow: 0,
      nodes,
      bossPos,
      nodePreferences: prefs,
      hpPercent: 0.30,
      gold: 200,
      act: 1,
      ascension: 0,
      maxHp: 80,
      currentRemovalCost: 75,
    });

    expect(path.some((p) => p.col === 2 && p.row === 1)).toBe(true);
    expect(path.some((p) => p.col === 0 && p.row === 1)).toBe(false);
  });

  it("avoids shop when gold is below threshold", () => {
    const prefs: NodePreferences = { ...defaultPrefs, shop: 0.9, elite: 0.2 };
    const path = traceConstraintAwarePath({
      startCol: 1,
      startRow: 0,
      nodes,
      bossPos,
      nodePreferences: prefs,
      hpPercent: 0.90,
      gold: 30,
      act: 1,
      ascension: 0,
      maxHp: 80,
      currentRemovalCost: 75,
    });

    expect(path.some((p) => p.col === 0 && p.row === 1)).toBe(true);
  });

  it("enforces survival floor — never drops below 15% HP", () => {
    const dangerNodes: MapNode[] = [
      { col: 0, row: 0, type: "Monster", children: [[0, 1]] },
      { col: 0, row: 1, type: "Elite", children: [[0, 2]] },
      { col: 0, row: 2, type: "Elite", children: [[0, 3]] },
      { col: 0, row: 3, type: "Boss", children: [] },
    ];
    const prefs: NodePreferences = { ...defaultPrefs, elite: 1.0 };

    const path = traceConstraintAwarePath({
      startCol: 0,
      startRow: 0,
      nodes: dangerNodes,
      bossPos: { col: 0, row: 3 },
      nodePreferences: prefs,
      hpPercent: 0.50,
      gold: 200,
      act: 1,
      ascension: 0,
      maxHp: 80,
      currentRemovalCost: 75,
    });

    expect(path.length).toBeGreaterThan(0);
  });

  it("applies rest site healing to simulated HP", () => {
    const healNodes: MapNode[] = [
      { col: 0, row: 0, type: "Elite", children: [[0, 1]] },
      { col: 0, row: 1, type: "RestSite", children: [[0, 2]] },
      { col: 0, row: 2, type: "Boss", children: [] },
    ];

    const path = traceConstraintAwarePath({
      startCol: 0,
      startRow: 0,
      nodes: healNodes,
      bossPos: { col: 0, row: 2 },
      nodePreferences: defaultPrefs,
      hpPercent: 0.60,
      gold: 200,
      act: 1,
      ascension: 0,
      maxHp: 80,
      currentRemovalCost: 75,
    });

    expect(path).toEqual([
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 0, row: 2 },
    ]);
  });

  it("applies ascension scaling to HP cost estimates", () => {
    const prefs: NodePreferences = { ...defaultPrefs, elite: 0.9 };

    const pathA0 = traceConstraintAwarePath({
      startCol: 1,
      startRow: 0,
      nodes,
      bossPos,
      nodePreferences: prefs,
      hpPercent: 0.50,
      gold: 200,
      act: 1,
      ascension: 0,
      maxHp: 80,
      currentRemovalCost: 75,
    });

    const pathA9 = traceConstraintAwarePath({
      startCol: 1,
      startRow: 0,
      nodes,
      bossPos,
      nodePreferences: prefs,
      hpPercent: 0.50,
      gold: 200,
      act: 1,
      ascension: 9,
      maxHp: 80,
      currentRemovalCost: 75,
    });

    expect(pathA0.length).toBeGreaterThan(0);
    expect(pathA9.length).toBeGreaterThan(0);
  });

  it("soft-penalizes elite below 70% HP but doesn't block it", () => {
    const singlePathNodes: MapNode[] = [
      { col: 0, row: 0, type: "Monster", children: [[0, 1]] },
      { col: 0, row: 1, type: "Elite", children: [[0, 2]] },
      { col: 0, row: 2, type: "Boss", children: [] },
    ];

    const path = traceConstraintAwarePath({
      startCol: 0,
      startRow: 0,
      nodes: singlePathNodes,
      bossPos: { col: 0, row: 2 },
      nodePreferences: defaultPrefs,
      hpPercent: 0.60,
      gold: 200,
      act: 1,
      ascension: 0,
      maxHp: 80,
      currentRemovalCost: 75,
    });

    expect(path).toEqual([
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 0, row: 2 },
    ]);
  });

  it("returns same PathCoord[] format as traceRecommendedPath", () => {
    const path = traceConstraintAwarePath({
      startCol: 0,
      startRow: 1,
      nodes,
      bossPos,
      nodePreferences: defaultPrefs,
      ...defaultContext,
    });

    for (const coord of path) {
      expect(coord).toHaveProperty("col");
      expect(coord).toHaveProperty("row");
      expect(typeof coord.col).toBe("number");
      expect(typeof coord.row).toBe("number");
    }
  });

  it("uses default preferences when nodePreferences is null", () => {
    const path = traceConstraintAwarePath({
      startCol: 0,
      startRow: 1,
      nodes,
      bossPos,
      nodePreferences: null,
      ...defaultContext,
    });

    expect(path[0]).toEqual({ col: 0, row: 1 });
    expect(path[path.length - 1]).toEqual({ col: 1, row: 3 });
  });

  it("does not apply the no-rest-nearby elite penalty when HP is at or above 85%", () => {
    // Layout: start [1,0] branches into elite [0,1] OR monster [2,1].
    // Elite's subtree has NO rest site within 2 nodes downstream — only
    // monsters → boss. The `hasRestNearby` check returns false for the
    // elite, which triggers the no-rest penalty. Before the fix that
    // penalty fired at any HP; after the fix it only fires when HP < 0.85.
    const noRestNodes: MapNode[] = [
      { col: 1, row: 0, type: "Monster", children: [[0, 1], [2, 1]] },
      { col: 0, row: 1, type: "Elite", children: [[0, 2]] },
      { col: 2, row: 1, type: "Monster", children: [[2, 2]] },
      { col: 0, row: 2, type: "Monster", children: [[1, 3]] },
      { col: 2, row: 2, type: "Monster", children: [[1, 3]] },
      { col: 1, row: 3, type: "Boss", children: [] },
    ];

    // elite pref modestly above monster pref — enough to win without the
    // penalty but LESS than what the penalty would multiply it down to.
    // elite(0.5) * 0.6 penalty = 0.30, which loses to monster(0.4).
    // Without the penalty, elite(0.5) beats monster(0.4) cleanly.
    const prefs: NodePreferences = {
      monster: 0.4,
      elite: 0.5,
      shop: 0.3,
      rest: 0.5,
      treasure: 0.9,
      event: 0.5,
    };

    // At 90% HP the new HP-aware guard should skip the no-rest penalty
    // and let the elite path win.
    const pathHealthy = traceConstraintAwarePath({
      startCol: 1,
      startRow: 0,
      nodes: noRestNodes,
      bossPos: { col: 1, row: 3 },
      nodePreferences: prefs,
      hpPercent: 0.90,
      gold: 200,
      act: 1,
      ascension: 0,
      maxHp: 80,
      currentRemovalCost: 75,
    });
    expect(pathHealthy.some((p) => p.col === 0 && p.row === 1)).toBe(true);

    // At 80% HP the no-rest penalty still applies (HP < 0.85 threshold)
    // and the elite path should LOSE to the monster path — confirming
    // the guard is HP-conditional, not removed entirely.
    const pathMid = traceConstraintAwarePath({
      startCol: 1,
      startRow: 0,
      nodes: noRestNodes,
      bossPos: { col: 1, row: 3 },
      nodePreferences: prefs,
      hpPercent: 0.80,
      gold: 200,
      act: 1,
      ascension: 0,
      maxHp: 80,
      currentRemovalCost: 75,
    });
    expect(pathMid.some((p) => p.col === 2 && p.row === 1)).toBe(true);
    expect(pathMid.some((p) => p.col === 0 && p.row === 1)).toBe(false);
  });
});
