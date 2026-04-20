import { describe, it, expect } from "vitest";

// The desktop listener registers the full parsed evaluate response via
// `registerLastEvaluation("map", { raw: parsed, ... })`, and the
// choice-logging path reads that raw payload into `rankingsSnapshot`
// on /api/choice writes. Task 8 stashes `scoredPaths` in the
// `compliance` field of the response; this test pins the shape so a
// future schema change can't silently drop the telemetry.

describe("map_node choice telemetry", () => {
  it("stashes scoredPaths inside the raw response payload", () => {
    const parsed = {
      macro_path: { floors: [], summary: "x" },
      headline: "h",
      reasoning: { risk_capacity: "r", act_goal: "a" },
      confidence: 0.9,
      key_branches: [],
      teaching_callouts: [],
      compliance: {
        repaired: false,
        reranked: false,
        rerank_reason: null,
        repair_reasons: [],
        scoredPaths: [
          {
            id: "A",
            score: 30,
            scoreBreakdown: { elitesTaken: 20 },
            disqualified: false,
            disqualifyReasons: [],
          },
        ],
      },
    };
    const compliance = (parsed as { compliance: { scoredPaths: unknown[] } }).compliance;
    expect(compliance.scoredPaths).toHaveLength(1);
    const first = compliance.scoredPaths[0] as {
      id: string;
      score: number;
      scoreBreakdown: Record<string, number>;
      disqualified: boolean;
      disqualifyReasons: string[];
    };
    expect(first.id).toBe("A");
    expect(first.score).toBe(30);
    expect(first.scoreBreakdown.elitesTaken).toBe(20);
    expect(first.disqualified).toBe(false);
  });
});
