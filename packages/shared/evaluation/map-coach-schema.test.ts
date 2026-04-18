import { describe, it, expect } from "vitest";
import {
  mapCoachOutputSchema,
  sanitizeMapCoachOutput,
  MAP_COACH_LIMITS,
} from "./map-coach-schema";

const validBranch = {
  floor: 25,
  decision: "Elite or Monster?",
  recommended: "Elite",
  alternatives: [{ option: "Monster", tradeoff: "Safer, lose relic." }],
  close_call: false,
};

const validCallout = {
  pattern: "rest_after_elite",
  floors: [26],
  explanation: "Heals elite cost.",
};

const valid = {
  reasoning: { risk_capacity: "Moderate buffer.", act_goal: "Heal to 70%+." },
  headline: "Take f25 elite, rest, treasure.",
  confidence: 0.82,
  macro_path: {
    floors: [
      { floor: 24, node_type: "monster" as const, node_id: "24,2" },
      { floor: 25, node_type: "elite" as const, node_id: "25,3" },
    ],
    summary: "Elite into rest into treasure.",
  },
  key_branches: [validBranch],
  teaching_callouts: [validCallout],
};

describe("mapCoachOutputSchema", () => {
  it("parses a valid payload", () => {
    expect(mapCoachOutputSchema.safeParse(valid).success).toBe(true);
  });

  // Caps moved from schema to `sanitizeMapCoachOutput` because
  // Anthropic's structured-output endpoint rejects `maxItems > 1` (#52).
  // The schema intentionally accepts over-cap arrays; truncation is enforced
  // in the route handler post-parse.
  it("accepts more than 3 key_branches at the schema layer (caps enforced post-parse)", () => {
    const tooMany = { ...valid, key_branches: Array(4).fill(validBranch) };
    expect(mapCoachOutputSchema.safeParse(tooMany).success).toBe(true);
  });

  it("accepts more than 4 teaching_callouts at the schema layer (caps enforced post-parse)", () => {
    const tooMany = { ...valid, teaching_callouts: Array(5).fill(validCallout) };
    expect(mapCoachOutputSchema.safeParse(tooMany).success).toBe(true);
  });

  it("requires reasoning fields", () => {
    const missing = { ...valid, reasoning: { risk_capacity: "" } };
    expect(mapCoachOutputSchema.safeParse(missing).success).toBe(false);
  });

  // Confidence range moved from schema to `sanitizeMapCoachOutput` because
  // Anthropic's structured-output endpoint rejects `number minimum/maximum`
  // (#68). The schema accepts any number; clamping is enforced post-parse.
  it("accepts confidence out of range at the schema layer (clamp lives in sanitizer)", () => {
    expect(mapCoachOutputSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(true);
    expect(mapCoachOutputSchema.safeParse({ ...valid, confidence: -0.3 }).success).toBe(true);
  });

  it("rejects invalid node_type", () => {
    const bad = {
      ...valid,
      macro_path: {
        ...valid.macro_path,
        floors: [{ floor: 24, node_type: "bogus", node_id: "24,2" }],
      },
    };
    expect(mapCoachOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("requires at least one floor in macro_path", () => {
    const bad = {
      ...valid,
      macro_path: { ...valid.macro_path, floors: [] },
    };
    expect(mapCoachOutputSchema.safeParse(bad).success).toBe(false);
  });

  it.each([
    ["1,", "trailing comma, missing row"],
    [",2", "missing col"],
    ["abc", "non-numeric"],
    ["1,2,3", "too many parts"],
    ["1.5,2", "non-integer"],
    ["-1,2", "negative"],
    ["", "empty string"],
  ])('rejects malformed node_id %p (%s)', (nodeId) => {
    const bad = {
      ...valid,
      macro_path: {
        ...valid.macro_path,
        floors: [{ floor: 24, node_type: "monster" as const, node_id: nodeId }],
      },
    };
    expect(mapCoachOutputSchema.safeParse(bad).success).toBe(false);
  });
});

describe("sanitizeMapCoachOutput", () => {
  it("passes through a valid within-caps payload unchanged in shape", () => {
    const sanitized = sanitizeMapCoachOutput(valid);
    expect(sanitized.confidence).toBe(0.82);
    expect(sanitized.key_branches).toHaveLength(1);
    expect(sanitized.teaching_callouts).toHaveLength(1);
  });

  it(`truncates key_branches to ${MAP_COACH_LIMITS.maxKeyBranches}`, () => {
    const tooMany = { ...valid, key_branches: Array(5).fill(validBranch) };
    expect(sanitizeMapCoachOutput(tooMany).key_branches).toHaveLength(
      MAP_COACH_LIMITS.maxKeyBranches,
    );
  });

  it(`truncates teaching_callouts to ${MAP_COACH_LIMITS.maxTeachingCallouts}`, () => {
    const tooMany = { ...valid, teaching_callouts: Array(6).fill(validCallout) };
    expect(sanitizeMapCoachOutput(tooMany).teaching_callouts).toHaveLength(
      MAP_COACH_LIMITS.maxTeachingCallouts,
    );
  });

  it("clamps confidence above 1", () => {
    expect(sanitizeMapCoachOutput({ ...valid, confidence: 1.8 }).confidence).toBe(1);
  });

  it("clamps confidence below 0", () => {
    expect(sanitizeMapCoachOutput({ ...valid, confidence: -0.5 }).confidence).toBe(0);
  });

  it("does not mutate its input", () => {
    const tooMany = { ...valid, key_branches: Array(5).fill(validBranch) };
    sanitizeMapCoachOutput(tooMany);
    expect(tooMany.key_branches).toHaveLength(5);
  });
});
