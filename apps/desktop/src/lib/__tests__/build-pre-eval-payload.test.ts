import { describe, it, expect } from "vitest";
import { buildPreEvalPayload } from "../build-pre-eval-payload";
import type { MapNode, MapNextOption } from "@sts2/shared/types/game-state";

/**
 * Simple 3-row map:
 *
 *   Row 2:  [0,2 monster]  [2,2 elite]
 *             ↑                ↑
 *   Row 1:  [0,1 monster]  [2,1 shop]
 *             ↑                ↑
 *   Row 0:  --------[1,0 start]--------
 *
 * Boss at [1,3].
 * Options from [1,0]: go left (0,1) or right (2,1).
 */
const nodes: MapNode[] = [
  { col: 1, row: 0, type: "Monster", children: [[0, 1], [2, 1]] },
  { col: 0, row: 1, type: "Monster", children: [[0, 2]] },
  { col: 2, row: 1, type: "Shop", children: [[2, 2]] },
  { col: 0, row: 2, type: "Monster", children: [] },
  { col: 2, row: 2, type: "Elite", children: [] },
];

const options: MapNextOption[] = [
  { col: 0, row: 1, type: "Monster", index: 0, leads_to: [{ col: 0, row: 2, type: "Monster" }] },
  { col: 2, row: 1, type: "Shop", index: 1, leads_to: [{ col: 2, row: 2, type: "Elite" }] },
];

const bossPos = { col: 1, row: 3 };

const baseParams = {
  options,
  allNodes: nodes,
  bossPos,
  hpPercent: 1,
  gold: 100,
  act: 1,
  deckSize: 12,
  deckMaturity: 0.5,
  relicCount: 2,
  floor: 1,
  ascension: 0,
  maxHp: 80,
  currentRemovalCost: 75,
  nodePreferences: null,
};

describe("buildPreEvalPayload", () => {
  it("includes all option coordinates in recommendedNodes", () => {
    const result = buildPreEvalPayload(baseParams);

    expect(result.recommendedNodes).toContain("0,1");
    expect(result.recommendedNodes).toContain("2,1");
  });

  it("includes traced path nodes from each option", () => {
    const result = buildPreEvalPayload(baseParams);

    expect(result.recommendedNodes).toContain("0,2");
    expect(result.recommendedNodes).toContain("2,2");
  });

  it("builds correct lastEvalContext", () => {
    const result = buildPreEvalPayload({
      ...baseParams,
      hpPercent: 0.75,
      gold: 50,
      act: 2,
      deckSize: 20,
      ascension: 5,
    });

    expect(result.lastEvalContext).toEqual({
      hpPercent: 0.75,
      deckSize: 20,
      act: 2,
      gold: 50,
      ascension: 5,
    });
  });

  it("returns no duplicates in recommendedNodes", () => {
    const result = buildPreEvalPayload(baseParams);

    const unique = new Set(result.recommendedNodes);
    expect(result.recommendedNodes.length).toBe(unique.size);
  });
});
