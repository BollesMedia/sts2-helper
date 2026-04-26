/**
 * @vitest-environment node
 *
 * Phase 4.5 integration smoke test (sts2-helper#46).
 *
 * Covers the AI SDK + zod + adapter boundary that the route handler depends
 * on for the **map coach** path. The card_reward / shop LLM path was
 * retired in #106; remaining tests in this file cover map coach only.
 *
 * Map coach (#70) uses `mapCoachOutputSchema` + `sanitizeMapCoachOutput`;
 * cap + clamp enforcement lives on the sanitizer, the schema side stays
 * constraint-free so Anthropic's structured-output endpoint doesn't reject
 * the emitted JSON Schema.
 */
import { describe, it, expect } from "vitest";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import {
  mapCoachOutputSchema,
  sanitizeMapCoachOutput,
  MAP_COACH_LIMITS,
  type MapCoachOutputRaw,
} from "@sts2/shared/evaluation/map-coach-schema";

// Minimal usage object matching LanguageModelV3Usage shape. The AI SDK
// middleware flattens this to `{ inputTokens: number, outputTokens: number }`
// on the result.
const mockUsage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 50, reasoning: undefined, text: undefined },
  totalTokens: { total: 150 },
};

// finishReason in V3 is a `{ unified, raw }` object. Output.object only
// parses the result when `unified === "stop"`.
const mockFinishReason = { unified: "stop" as const, raw: "stop" };

function mockModelWithText(text: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: mockFinishReason,
      usage: mockUsage,
      warnings: [],
    }),
  });
}

describe("AI SDK + zod integration (Phase 4.5 smoke)", () => {


  describe("map coach path (#70 — mapCoachOutputSchema + sanitizer)", () => {
    const validMapCoach = {
      reasoning: {
        risk_capacity: "Moderate HP buffer; 2 fights of headroom.",
        act_goal: "Heal to 70%+ before pre-boss rest.",
      },
      headline: "Take f25 elite, rest, treasure.",
      confidence: 0.82,
      macro_path: {
        floors: [
          { floor: 24, node_type: "monster", node_id: "24,2" },
          { floor: 25, node_type: "elite", node_id: "25,3" },
          { floor: 26, node_type: "rest", node_id: "26,3" },
        ],
        summary: "Elite then rest then treasure.",
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
        {
          pattern: "rest_after_elite",
          floors: [26],
          explanation: "Heals elite HP cost before the fight cluster.",
        },
      ],
    };

    it("validates a happy-path map coach response against mapCoachOutputSchema", async () => {
      const model = mockModelWithText(JSON.stringify(validMapCoach));

      const result = await generateText({
        model,
        prompt: "evaluate these paths",
        output: Output.object({ schema: mapCoachOutputSchema }),
      });

      expect(result.output.headline).toBe("Take f25 elite, rest, treasure.");
      expect(result.output.confidence).toBeCloseTo(0.82);
      expect(result.output.macro_path.floors).toHaveLength(3);
      expect(result.output.key_branches).toHaveLength(1);
      expect(result.output.teaching_callouts).toHaveLength(1);
    });

    it("rejects missing reasoning.risk_capacity (the scaffold-bypass case)", async () => {
      const bad = {
        ...validMapCoach,
        reasoning: { act_goal: "heal" },
      };
      const model = mockModelWithText(JSON.stringify(bad));

      await expect(
        generateText({
          model,
          prompt: "evaluate these paths",
          output: Output.object({ schema: mapCoachOutputSchema }),
        }),
      ).rejects.toSatisfy(NoObjectGeneratedError.isInstance);
    });

    it("rejects empty macro_path.floors", async () => {
      const bad = {
        ...validMapCoach,
        macro_path: { ...validMapCoach.macro_path, floors: [] },
      };
      const model = mockModelWithText(JSON.stringify(bad));

      await expect(
        generateText({
          model,
          prompt: "evaluate these paths",
          output: Output.object({ schema: mapCoachOutputSchema }),
        }),
      ).rejects.toSatisfy(NoObjectGeneratedError.isInstance);
    });

    it(
      `accepts >${MAP_COACH_LIMITS.maxKeyBranches} key_branches and >${MAP_COACH_LIMITS.maxTeachingCallouts} teaching_callouts at the schema layer — caps enforced post-parse by sanitizeMapCoachOutput`,
      async () => {
        // Same migration as buildMapEvalSchema/card_reward: array-length caps
        // cannot live in the emitted JSON Schema (Anthropic rejects maxItems
        // > 1 per #52), so the schema stays constraint-free and the route
        // handler runs `sanitizeMapCoachOutput` to truncate.
        const over = {
          ...validMapCoach,
          key_branches: Array(5).fill(validMapCoach.key_branches[0]),
          teaching_callouts: Array(6).fill(validMapCoach.teaching_callouts[0]),
        };
        const model = mockModelWithText(JSON.stringify(over));

        const result = await generateText({
          model,
          prompt: "evaluate these paths",
          output: Output.object({ schema: mapCoachOutputSchema }),
        });

        // Schema accepts over-cap arrays...
        expect(result.output.key_branches).toHaveLength(5);
        expect(result.output.teaching_callouts).toHaveLength(6);

        // ...sanitizer enforces caps.
        const sanitized = sanitizeMapCoachOutput(result.output);
        expect(sanitized.key_branches).toHaveLength(MAP_COACH_LIMITS.maxKeyBranches);
        expect(sanitized.teaching_callouts).toHaveLength(
          MAP_COACH_LIMITS.maxTeachingCallouts,
        );
      },
    );

    it("clamps out-of-range confidence via sanitizeMapCoachOutput", async () => {
      // Same story as the array caps: `z.number().min/.max` can't live in
      // the schema (Anthropic rejects number minimum/maximum per #68), so
      // the sanitizer clamps.
      const overConfident = { ...validMapCoach, confidence: 1.7 };
      const model = mockModelWithText(JSON.stringify(overConfident));

      const result = await generateText({
        model,
        prompt: "evaluate these paths",
        output: Output.object({ schema: mapCoachOutputSchema }),
      });

      expect(result.output.confidence).toBeCloseTo(1.7);
      expect(sanitizeMapCoachOutput(result.output).confidence).toBe(1);
    });
  });

  // Regression smoke: the route handler attaches the desktop-computed
  // `runStateSnapshot` onto the map-coach response without touching its shape.
  // The actual attachment code lives in `route.ts`; this tests the contract
  // we depend on (a spread of `{...sanitized, runStateSnapshot}` preserves
  // both sides and doesn't collide with any schema key).
  describe("runStateSnapshot passthrough contract", () => {
    it("composes cleanly with a sanitized map coach payload without key collision", () => {
      const sanitized = sanitizeMapCoachOutput({
        reasoning: { risk_capacity: "Tight.", act_goal: "Consolidate." },
        headline: "Skip elite.",
        confidence: 0.4,
        macro_path: {
          floors: [{ floor: 22, node_type: "monster", node_id: "22,1" }],
          summary: "Monster then rest.",
        },
        key_branches: [],
        teaching_callouts: [],
      });

      const runStateSnapshot = { riskCapacity: { verdict: "tight" } };

      const body = { ...sanitized, runStateSnapshot };
      expect(body.runStateSnapshot).toBe(runStateSnapshot);
      expect(body.headline).toBe("Skip elite.");
      // Schema keys and `runStateSnapshot` must not alias.
      expect(Object.keys(body)).toContain("reasoning");
      expect(Object.keys(body)).toContain("runStateSnapshot");
    });
  });
});
