import { describe, it, expect } from "vitest";
import { deriveBranches } from "./derive-branches";
import type { ScoredPath } from "./score-paths";
import type { PathNode } from "./path-patterns";

function node(type: PathNode["type"], floor: number, col = 0): PathNode {
  return { type, floor, nodeId: `${col},${floor}` } as PathNode;
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
      { elitesTaken: 10, restBeforeElite: 8 },
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

  it("falls back to generic rationale when winner has no positive scoreBreakdown delta", () => {
    // Identical breakdowns — tiebreaker-won winner with no positive delta.
    const winner = makeScored("w", [node("rest", 1, 1), node("elite", 2, 1)], 18, {
      elitesTaken: 10, restBeforeElite: 8,
    });
    const runnerUp = makeScored("r", [node("monster", 1, 2), node("elite", 2, 2)], 18, {
      elitesTaken: 10, restBeforeElite: 8,
    });
    const branches = deriveBranches(winner, runnerUp, { confidence: 0.9 });
    expect(branches).toHaveLength(1);
    // Fallback rationale: "Rest — scorer preferred" / "Monster — lower weighted score"
    expect(branches[0].recommended).toContain("Rest");
    expect(branches[0].alternatives[0].tradeoff).toContain("Monster");
  });

  it("uses nodeId for divergence detection on real-shape PathNodes", () => {
    // Two monster nodes at floor 1 with different nodeIds should diverge.
    const n1: PathNode = { floor: 1, type: "monster", nodeId: "1,1" };
    const n2: PathNode = { floor: 1, type: "monster", nodeId: "2,1" };
    const winner = makeScored("w", [n1], 10);
    const runnerUp = makeScored("r", [n2], 5);
    const branches = deriveBranches(winner, runnerUp, { confidence: 0.9 });
    expect(branches).toHaveLength(1);
  });
});
