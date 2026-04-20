import { describe, it, expect } from "vitest";
import { deriveBranches } from "./derive-branches";
import type { ScoredPath } from "./score-paths";
import type { PathNode } from "./path-patterns";

function node(type: PathNode["type"], floor: number, col = 0): PathNode {
  return { type, floor, col, row: floor } as PathNode;
}

function makeScored(
  id: string,
  nodes: PathNode[],
  score: number,
  breakdown: Record<string, number> = {},
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
      projectedHpEnteringPreBossRest: 40,
      fightBudgetStatus: "within_budget",
      hpProjectionVerdict: "safe",
    },
    score,
    scoreBreakdown: breakdown,
    disqualified: false,
    disqualifyReasons: [],
  };
}

describe("deriveBranches", () => {
  it("returns zero branches when winner and runner-up are identical", () => {
    const nodes = [node("monster", 1), node("elite", 2)];
    const winner = makeScored("w", nodes, 10);
    const runnerUp = makeScored("r", nodes, 10);
    expect(deriveBranches(winner, runnerUp, { confidence: 0.95 })).toEqual([]);
  });

  it("emits one branch at the first divergence floor", () => {
    const winner = makeScored(
      "w",
      [node("elite", 1, 1), node("rest", 2)],
      20,
      { elitesTaken: 10 },
    );
    const runnerUp = makeScored(
      "r",
      [node("monster", 1, 2), node("rest", 2)],
      5,
      { elitesTaken: 0 },
    );
    const branches = deriveBranches(winner, runnerUp, { confidence: 0.9 });
    expect(branches).toHaveLength(1);
    expect(branches[0].floor).toBe(1);
    expect(branches[0].recommended.toLowerCase()).toContain("elite");
    expect(branches[0].alternatives[0].option.toLowerCase()).toContain("monster");
    expect(branches[0].close_call).toBe(false);
  });

  it("emits a second branch when paths converge then diverge again", () => {
    const winner = makeScored(
      "w",
      [node("elite", 1, 1), node("rest", 2), node("treasure", 3, 1)],
      20,
      { elitesTaken: 10, treasuresTaken: 6 },
    );
    const runnerUp = makeScored(
      "r",
      [node("monster", 1, 2), node("rest", 2), node("monster", 3, 2)],
      5,
    );
    const branches = deriveBranches(winner, runnerUp, { confidence: 0.7 });
    expect(branches).toHaveLength(2);
    expect(branches[0].floor).toBe(1);
    expect(branches[1].floor).toBe(3);
  });

  it("caps at 3 branches", () => {
    const winner = makeScored(
      "w",
      [
        node("elite", 1, 1),
        node("rest", 2),
        node("treasure", 3, 1),
        node("rest", 4),
        node("shop", 5, 1),
        node("rest", 6),
        node("elite", 7, 1),
      ],
      100,
    );
    const runnerUp = makeScored(
      "r",
      [
        node("monster", 1, 2),
        node("rest", 2),
        node("monster", 3, 2),
        node("rest", 4),
        node("monster", 5, 2),
        node("rest", 6),
        node("monster", 7, 2),
      ],
      50,
    );
    const branches = deriveBranches(winner, runnerUp, { confidence: 0.9 });
    expect(branches).toHaveLength(3);
  });

  it("flags close_call=true when confidence < 0.75", () => {
    const winner = makeScored("w", [node("elite", 1, 1)], 10, { elitesTaken: 10 });
    const runnerUp = makeScored("r", [node("monster", 1, 2)], 0);
    const branches = deriveBranches(winner, runnerUp, { confidence: 0.6 });
    expect(branches[0].close_call).toBe(true);
  });
});
