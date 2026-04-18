import { describe, it, expect } from "vitest";
import { mapCoachOutputSchema } from "./map-coach-schema";

describe("mapCoachOutputSchema", () => {
  const valid = {
    reasoning: { risk_capacity: "Moderate buffer.", act_goal: "Heal to 70%+." },
    headline: "Take f25 elite, rest, treasure.",
    confidence: 0.82,
    macro_path: {
      floors: [
        { floor: 24, node_type: "monster", node_id: "24,2" },
        { floor: 25, node_type: "elite", node_id: "25,3" },
      ],
      summary: "Elite into rest into treasure.",
    },
    key_branches: [
      {
        floor: 25,
        decision: "Elite or Monster?",
        recommended: "Elite",
        alternatives: [{ option: "Monster", tradeoff: "Safer, lose relic." }],
        close_call: false,
      },
    ],
    teaching_callouts: [
      { pattern: "rest_after_elite", floors: [26], explanation: "Heals elite cost." },
    ],
  };

  it("parses a valid payload", () => {
    expect(mapCoachOutputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects more than 3 key_branches", () => {
    const tooMany = { ...valid, key_branches: Array(4).fill(valid.key_branches[0]) };
    expect(mapCoachOutputSchema.safeParse(tooMany).success).toBe(false);
  });

  it("rejects more than 4 teaching_callouts", () => {
    const tooMany = { ...valid, teaching_callouts: Array(5).fill(valid.teaching_callouts[0]) };
    expect(mapCoachOutputSchema.safeParse(tooMany).success).toBe(false);
  });

  it("requires reasoning fields", () => {
    const missing = { ...valid, reasoning: { risk_capacity: "" } };
    expect(mapCoachOutputSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects confidence out of range", () => {
    expect(mapCoachOutputSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(false);
  });
});
