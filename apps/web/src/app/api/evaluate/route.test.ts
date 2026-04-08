/**
 * @vitest-environment node
 *
 * Phase 4.5 integration smoke test (sts2-helper#46).
 *
 * Covers the AI SDK + zod + adapter boundary that the route handler depends
 * on. This is NOT a full route handler test — mocking the entire Supabase
 * surface, auth, and context builders is out of scope. Instead, it verifies
 * the runtime contract:
 *
 *   generateText + Output.object + zod schema + MockLanguageModelV3
 *     → validated output
 *     → toCardRewardEvaluation adapter
 *     → canonical CardRewardEvaluation shape
 *
 * and the strict-fail side for schema-level constraints:
 *
 *   malformed mock output (wrong types, missing required fields)
 *     → NoObjectGeneratedError
 *
 * Ranking COUNT enforcement moved out of the schema in #54 (the
 * schema-level `.refine()` rejected Claude's drift-added summary/placeholder
 * entries as hard 502s even when the real rankings were all present).
 * Count enforcement now lives in the route handler via `sanitizeRankings`,
 * which has its own unit test at
 * `packages/shared/evaluation/sanitize-rankings.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import {
  buildCardRewardSchema,
  buildMapEvalSchema,
} from "@sts2/shared/evaluation/eval-schemas";
import { toCardRewardEvaluation } from "@sts2/shared/evaluation/parse-tool-response";

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
  const items = [
    { id: "OFFERING", name: "Offering" },
    { id: "STRIKE", name: "Strike" },
    { id: "DEFEND", name: "Defend" },
  ];

  describe("card_reward / shop path", () => {
    it("validates a happy-path mock response and produces the canonical evaluation", async () => {
      const mockOutput = {
        rankings: [
          { position: 1, tier: "S", confidence: 95, reasoning: "Best card" },
          { position: 2, tier: "B", confidence: 70, reasoning: "Filler" },
          { position: 3, tier: "C", confidence: 50, reasoning: "Mediocre" },
        ],
        skip_recommended: false,
      };
      const model = mockModelWithText(JSON.stringify(mockOutput));
      const schema = buildCardRewardSchema(items, false);

      const result = await generateText({
        model,
        prompt: "evaluate these cards",
        output: Output.object({ schema }),
      });

      const evaluation = toCardRewardEvaluation(result.output, items);
      expect(evaluation.rankings).toHaveLength(3);
      expect(evaluation.rankings[0]).toMatchObject({
        itemId: "OFFERING",
        itemName: "Offering",
        itemIndex: 0,
        tier: "S",
        tierValue: 6,
      });
      expect(evaluation.skipRecommended).toBe(false);
    });

    it("accepts 2 of 3 rankings at the schema layer (count enforcement lives in the route handler post-#54)", async () => {
      // Pre-#54 the schema's `.refine()` rejected this. Post-#54 the schema
      // accepts any length (required so Claude's drift-added summary and
      // placeholder entries don't hard-502 the real rankings), and
      // `sanitizeRankings` in the route handler enforces the count after
      // filtering bogus entries. Unit coverage of that enforcement lives at
      // `packages/shared/evaluation/sanitize-rankings.test.ts`.
      const mockOutput = {
        rankings: [
          { position: 1, tier: "A", confidence: 80, reasoning: "ok" },
          { position: 2, tier: "B", confidence: 70, reasoning: "ok" },
        ],
        skip_recommended: false,
      };
      const model = mockModelWithText(JSON.stringify(mockOutput));
      const schema = buildCardRewardSchema(items, false);

      const result = await generateText({
        model,
        prompt: "evaluate these cards",
        output: Output.object({ schema }),
      });
      expect(result.output.rankings).toHaveLength(2);
    });

    it("throws NoObjectGeneratedError when a required field is missing", async () => {
      const mockOutput = {
        rankings: [
          // Missing `tier` field
          { position: 1, confidence: 80, reasoning: "ok" },
          { position: 2, tier: "B", confidence: 70, reasoning: "ok" },
          { position: 3, tier: "C", confidence: 50, reasoning: "ok" },
        ],
        skip_recommended: false,
      };
      const model = mockModelWithText(JSON.stringify(mockOutput));
      const schema = buildCardRewardSchema(items, false);

      await expect(
        generateText({
          model,
          prompt: "evaluate these cards",
          output: Output.object({ schema }),
        }),
      ).rejects.toSatisfy(NoObjectGeneratedError.isInstance);
    });
  });

  describe("map path (b11bef8 regression guard)", () => {
    it("validates a map response with node_preferences present", async () => {
      const mockOutput = {
        rankings: [
          {
            option_index: 1,
            tier: "S",
            confidence: 90,
            reasoning: "Elite gives relic",
          },
          {
            option_index: 2,
            tier: "B",
            confidence: 70,
            reasoning: "Safer route",
          },
          {
            option_index: 3,
            tier: "C",
            confidence: 50,
            reasoning: "Mediocre",
          },
        ],
        overall_advice: "Go right for the elite",
        node_preferences: {
          monster: 0.4,
          elite: 0.5,
          shop: 0.5,
          rest: 0.6,
          treasure: 0.9,
          event: 0.5,
        },
      };
      const model = mockModelWithText(JSON.stringify(mockOutput));
      const schema = buildMapEvalSchema(3);

      const result = await generateText({
        model,
        prompt: "evaluate these paths",
        output: Output.object({ schema }),
      });

      expect(result.output.rankings).toHaveLength(3);
      expect(result.output.node_preferences).toEqual({
        monster: 0.4,
        elite: 0.5,
        shop: 0.5,
        rest: 0.6,
        treasure: 0.9,
        event: 0.5,
      });
      expect(result.output.overall_advice).toBe("Go right for the elite");
    });

    it("throws NoObjectGeneratedError when node_preferences is missing (the b11bef8 silent-drop case)", async () => {
      const mockOutput = {
        rankings: [
          {
            option_index: 1,
            tier: "S",
            confidence: 90,
            reasoning: "Elite gives relic",
          },
          {
            option_index: 2,
            tier: "B",
            confidence: 70,
            reasoning: "Safer route",
          },
          {
            option_index: 3,
            tier: "C",
            confidence: 50,
            reasoning: "Mediocre",
          },
        ],
        overall_advice: "Go right for the elite",
        // node_preferences silently omitted — this is the exact shape the
        // old regex workaround at route.ts:326-366 would have accepted
        // with nodePreferences: null. The migration must reject it.
      };
      const model = mockModelWithText(JSON.stringify(mockOutput));
      const schema = buildMapEvalSchema(3);

      await expect(
        generateText({
          model,
          prompt: "evaluate these paths",
          output: Output.object({ schema }),
        }),
      ).rejects.toSatisfy(NoObjectGeneratedError.isInstance);
    });

    it("accepts 2 rankings for a 3-option map at the schema layer (count enforcement lives in the route handler post-#54)", async () => {
      // Same migration as the card_reward case above: count enforcement
      // moved out of the schema into `sanitizeRankings`. The schema only
      // validates shape (tier enum, required fields, node_preferences
      // presence — which is the b11bef8 regression that MUST stay at the
      // schema layer because it's about a missing required OBJECT, not a
      // wrong array length).
      const mockOutput = {
        rankings: [
          { option_index: 1, tier: "A", confidence: 80, reasoning: "ok" },
          { option_index: 2, tier: "B", confidence: 70, reasoning: "ok" },
        ],
        overall_advice: "x",
        node_preferences: {
          monster: 0.4,
          elite: 0.5,
          shop: 0.5,
          rest: 0.6,
          treasure: 0.9,
          event: 0.5,
        },
      };
      const model = mockModelWithText(JSON.stringify(mockOutput));
      const schema = buildMapEvalSchema(3);

      const result = await generateText({
        model,
        prompt: "evaluate these paths",
        output: Output.object({ schema }),
      });
      expect(result.output.rankings).toHaveLength(2);
    });
  });
});
