import { describe, it, expect } from "vitest";
import { rerankIfDominated } from "./rerank-if-dominated";
import type { RerankInputs } from "./rerank-if-dominated";
import type { MapCoachOutputRaw } from "../map-coach-schema";
import type { EnrichedPath } from "./enrich-paths";

function path(
  id: string,
  firstNodeId: string,
  hpVerdict: EnrichedPath["aggregates"]["hpProjectionVerdict"],
  budget: EnrichedPath["aggregates"]["fightBudgetStatus"],
): EnrichedPath {
  const [, rowStr] = firstNodeId.split(",");
  const row = Number(rowStr);
  return {
    id,
    nodes: [{ floor: row, type: "monster", nodeId: firstNodeId }],
    patterns: [],
    aggregates: {
      elitesTaken: 0,
      monstersTaken: 0,
      restsTaken: 0,
      shopsTaken: 0,
      hardPoolFightsOnPath: 0,
      totalFights: 0,
      projectedHpEnteringPreBossRest: 50,
      fightBudgetStatus: budget,
      hpProjectionVerdict: hpVerdict,
    },
  };
}

function output(firstNodeId: string): MapCoachOutputRaw {
  return {
    reasoning: { risk_capacity: "m", act_goal: "g" },
    headline: "original",
    confidence: 0.8,
    macro_path: {
      floors: [{ floor: 1, node_type: "monster", node_id: firstNodeId }],
      summary: "s",
    },
    key_branches: [
      {
        floor: 1,
        decision: "take this?",
        recommended: "yes",
        alternatives: [],
        close_call: false,
      },
    ],
    teaching_callouts: [
      { pattern: "rest_after_elite", floors: [1], explanation: "..." },
    ],
  };
}

describe("rerankIfDominated", () => {
  it("passes through when LLM pick is not dominated", () => {
    const candidates = [
      path("A", "1,1", "safe", "exceeds_budget"),
      path("B", "2,1", "risky", "within_budget"),
    ];
    const inputs: RerankInputs = {
      output: output("1,1"),
      candidates,
    };
    const result = rerankIfDominated(inputs);
    expect(result.reranked).toBe(false);
    expect(result.rerank_reason).toBeNull();
    expect(result.output.headline).toBe("original");
  });

  it("swaps to the dominator when LLM pick is dominated", () => {
    const candidates = [
      path("A", "1,1", "critical", "exceeds_budget"),
      path("B", "2,1", "safe", "within_budget"),
    ];
    const inputs: RerankInputs = {
      output: output("1,1"),
      candidates,
    };
    const result = rerankIfDominated(inputs);
    expect(result.reranked).toBe(true);
    expect(result.rerank_reason).toBe("dominated_by_path_B");
    expect(result.output.macro_path.floors[0].node_id).toBe("2,1");
    expect(result.output.headline).toContain("Safer alternative");
    expect(result.output.confidence).toBeCloseTo(0.65, 2);
  });

  it("picks the strictly-best dominator among multiple", () => {
    const candidates = [
      path("A", "1,1", "critical", "exceeds_budget"),
      path("B", "2,1", "risky", "tight"),
      path("C", "3,1", "safe", "within_budget"),
    ];
    const inputs: RerankInputs = { output: output("1,1"), candidates };
    const result = rerankIfDominated(inputs);
    expect(result.reranked).toBe(true);
    expect(result.rerank_reason).toBe("dominated_by_path_C");
  });

  it("does not swap when LLM pick is already best possible", () => {
    const candidates = [
      path("A", "1,1", "safe", "within_budget"),
      path("B", "2,1", "risky", "tight"),
    ];
    const inputs: RerankInputs = { output: output("1,1"), candidates };
    const result = rerankIfDominated(inputs);
    expect(result.reranked).toBe(false);
  });

  it("does not swap when all paths are equally bad", () => {
    const candidates = [
      path("A", "1,1", "critical", "exceeds_budget"),
      path("B", "2,1", "critical", "exceeds_budget"),
    ];
    const inputs: RerankInputs = { output: output("1,1"), candidates };
    const result = rerankIfDominated(inputs);
    expect(result.reranked).toBe(false);
  });

  it("filters key_branches + teaching_callouts to new path's floors", () => {
    const candidates = [
      path("A", "1,1", "critical", "exceeds_budget"),
      path("B", "2,1", "safe", "within_budget"),
    ];
    const llmOutput = output("1,1");
    llmOutput.key_branches = [
      {
        floor: 1,
        decision: "d1",
        recommended: "r1",
        alternatives: [],
        close_call: false,
      },
      {
        floor: 5,
        decision: "d5",
        recommended: "r5",
        alternatives: [],
        close_call: false,
      },
    ];
    llmOutput.teaching_callouts = [
      { pattern: "x", floors: [1], explanation: "a" },
      { pattern: "y", floors: [99], explanation: "b" },
    ];
    const inputs: RerankInputs = { output: llmOutput, candidates };
    const result = rerankIfDominated(inputs);
    expect(result.reranked).toBe(true);
    expect(result.output.key_branches.length).toBeGreaterThanOrEqual(1);
    expect(result.output.key_branches[0].decision).toContain(
      "Coach initially picked",
    );
    expect(result.output.teaching_callouts).toHaveLength(1);
    expect(result.output.teaching_callouts[0].floors).toEqual([1]);
  });
});
