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
 *
 * Map coach (#70) uses `mapCoachOutputSchema` + `sanitizeMapCoachOutput`
 * in the same boundary; cap + clamp enforcement lives on the sanitizer, the
 * schema side stays constraint-free so Anthropic's structured-output endpoint
 * doesn't reject the emitted JSON Schema.
 */
import { describe, it, expect } from "vitest";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { buildCardRewardSchema } from "@sts2/shared/evaluation/eval-schemas";
import { sanitizeCardRewardCoachOutput } from "@sts2/shared/evaluation/card-reward-coach-schema";
import {
  mapCoachOutputSchema,
  sanitizeMapCoachOutput,
  MAP_COACH_LIMITS,
  type MapCoachOutputRaw,
} from "@sts2/shared/evaluation/map-coach-schema";
import { toCardRewardEvaluation } from "@sts2/shared/evaluation/parse-tool-response";
import { repairMacroPath } from "@sts2/shared/evaluation/map/repair-macro-path";
import type {
  RepairMapNode,
  RepairNextOption,
} from "@sts2/shared/evaluation/map/repair-macro-path";
import { rerankIfDominated } from "@sts2/shared/evaluation/map/rerank-if-dominated";
import type { EnrichedPath } from "@sts2/shared/evaluation/map/enrich-paths";
import { buildComplianceReport } from "@sts2/shared/evaluation/map/compliance-report";

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

  // Task 8: verify the optional `coaching` block on card_reward responses
  // round-trips through the same AI SDK + zod + adapter boundary the route
  // handler uses. Mirrors the existing map-coach boundary tests above.
  describe("card_reward coaching pipeline", () => {
    const items = [
      { id: "OFFERING", name: "Offering" },
      { id: "INFLAME", name: "Inflame" },
      { id: "DEFEND", name: "Defend" },
    ];

    const validCoaching = {
      reasoning: {
        deck_state: "10-card starter, no archetype committed, Act 1 floor 3.",
        commitment: "Pick a keystone this reward — card acquisition over HP.",
      },
      headline: "Take Inflame — only keystone offered; starts the strength engine.",
      confidence: 0.78,
      key_tradeoffs: [
        { position: 1, upside: "Cheap card draw, thins deck.", downside: "Loses HP on play." },
        { position: 2, upside: "Keystone for Strength archetype.", downside: "Dead until scaling cards appear." },
        { position: 3, upside: "Safe, always playable.", downside: "Dead weight — 4 Defends already in deck." },
      ],
      teaching_callouts: [
        { pattern: "keystone_commit", explanation: "A deck with no archetype keystone has no ceiling." },
        { pattern: "duplicate_defend", explanation: "2+ Defends past floor 3 is overcommitted to block." },
      ],
    };

    it("passes coaching block through to response when LLM returns it", async () => {
      const mockOutput = {
        rankings: [
          { position: 1, tier: "C", confidence: 50, reasoning: "Situational." },
          { position: 2, tier: "S", confidence: 90, reasoning: "Keystone pick." },
          { position: 3, tier: "F", confidence: 20, reasoning: "Dead weight." },
        ],
        skip_recommended: false,
        coaching: validCoaching,
      };
      const model = mockModelWithText(JSON.stringify(mockOutput));
      const schema = buildCardRewardSchema(items, false);

      const result = await generateText({
        model,
        prompt: "evaluate these cards",
        output: Output.object({ schema }),
      });

      expect(result.output.coaching).toBeDefined();
      // Sanitize runs in route.ts — exercise it here so the boundary matches.
      const sanitized = sanitizeCardRewardCoachOutput(result.output.coaching!);
      const evaluation = toCardRewardEvaluation(
        { ...result.output, coaching: sanitized },
        items,
      );

      expect(evaluation.coaching).toBeDefined();
      expect(evaluation.coaching!.headline).toContain("Inflame");
      expect(evaluation.coaching!.reasoning.deckState).toContain("starter");
      expect(evaluation.coaching!.reasoning.commitment).toContain("keystone");
      expect(evaluation.coaching!.keyTradeoffs.length).toBeLessThanOrEqual(3);
      expect(evaluation.coaching!.keyTradeoffs[0]).toEqual({
        position: 1,
        upside: "Cheap card draw, thins deck.",
        downside: "Loses HP on play.",
      });
      expect(evaluation.coaching!.teachingCallouts.length).toBeLessThanOrEqual(3);
      expect(evaluation.coaching!.confidence).toBeGreaterThanOrEqual(0);
      expect(evaluation.coaching!.confidence).toBeLessThanOrEqual(1);
      // Rankings still flow through unchanged.
      expect(evaluation.rankings).toHaveLength(3);
    });

    it("passes through without coaching when LLM omits it (backwards compat)", async () => {
      const mockOutput = {
        rankings: [
          { position: 1, tier: "B", confidence: 60, reasoning: "Fine." },
          { position: 2, tier: "A", confidence: 80, reasoning: "Good." },
          { position: 3, tier: "C", confidence: 40, reasoning: "Meh." },
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

      expect(result.output.coaching).toBeUndefined();
      const evaluation = toCardRewardEvaluation(result.output, items);
      expect(evaluation.coaching).toBeUndefined();
      // Rankings + skip fields still populate.
      expect(evaluation.rankings).toHaveLength(3);
      expect(evaluation.skipRecommended).toBe(false);
    });
  });

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

  // Phase 2 integration: the route handler calls the compliance pipeline
  // (repair → rerank → attach compliance) immediately after
  // `sanitizeMapCoachOutput`. These tests drive the identical call sequence
  // against a MockLanguageModelV3 so the end-to-end contract is covered
  // without booting Next / Supabase / auth.
  describe("map coach compliance pipeline", () => {
    // Shared graph: f0 (start) → two next options at f1, each leading to boss
    // at f2. Path 1 = monster@1,1 → boss@1,2. Path 2 = monster@2,1 → boss@1,2.
    const nodes: RepairMapNode[] = [
      { col: 0, row: 0, type: "Unknown", children: [[1, 1], [2, 1]] },
      { col: 1, row: 1, type: "Monster", children: [[1, 2]] },
      { col: 2, row: 1, type: "Monster", children: [[1, 2]] },
      { col: 1, row: 2, type: "Boss", children: [] },
    ];
    const nextOptions: RepairNextOption[] = [
      { col: 1, row: 1, type: "Monster" },
      { col: 2, row: 1, type: "Monster" },
    ];
    const boss = { col: 1, row: 2 };
    const currentPosition = { col: 0, row: 0 };

    function enrichedPath(
      id: string,
      firstNodeId: string,
      hpVerdict: EnrichedPath["aggregates"]["hpProjectionVerdict"],
      budget: EnrichedPath["aggregates"]["fightBudgetStatus"],
    ): EnrichedPath {
      const [, rowStr] = firstNodeId.split(",");
      const row = Number(rowStr);
      return {
        id,
        nodes: [
          { floor: row, type: "monster", nodeId: firstNodeId },
          { floor: row + 1, type: "boss", nodeId: "1,2" },
        ],
        patterns: [],
        aggregates: {
          elitesTaken: 0,
          monstersTaken: 1,
          restsTaken: 0,
          shopsTaken: 0,
          hardPoolFightsOnPath: 0,
          totalFights: 1,
          projectedHpEnteringPreBossRest: 50,
          fightBudgetStatus: budget,
          hpProjectionVerdict: hpVerdict,
        },
      };
    }

    /**
     * Runs the exact pipeline wired into `route.ts`:
     *   sanitize → repair → rerank → buildComplianceReport → re-sanitize.
     */
    function runPipeline(
      raw: MapCoachOutputRaw,
      enrichedPaths: EnrichedPath[],
    ): MapCoachOutputRaw {
      const sanitized = sanitizeMapCoachOutput(raw);
      const repair = repairMacroPath({
        output: sanitized,
        nodes,
        nextOptions,
        boss,
        currentPosition,
      });
      const rerank = rerankIfDominated({
        output: repair.output,
        candidates: enrichedPaths,
      });
      const compliance = buildComplianceReport(repair, rerank);
      const recapped = sanitizeMapCoachOutput(rerank.output);
      return { ...recapped, compliance };
    }

    const validLlmOutput = {
      reasoning: { risk_capacity: "Tight.", act_goal: "Consolidate." },
      headline: "Take monster cluster via 1,1.",
      confidence: 0.82,
      macro_path: {
        floors: [
          { floor: 1, node_type: "monster" as const, node_id: "1,1" },
          { floor: 2, node_type: "boss" as const, node_id: "1,2" },
        ],
        summary: "Monster then boss.",
      },
      key_branches: [
        {
          floor: 1,
          decision: "Path 1 or 2?",
          recommended: "Path 1",
          alternatives: [{ option: "Path 2", tradeoff: "Safer." }],
          close_call: false,
        },
      ],
      teaching_callouts: [
        {
          pattern: "monster_chain",
          floors: [1],
          explanation: "Reliable gold.",
        },
      ],
    };

    it("reranks a dominated LLM pick and attaches compliance", async () => {
      // LLM picks path 1 (node 1,1). Enrichment scores it as
      // (exceeds_budget, critical). Path 2 (node 2,1) is (within_budget, safe)
      // — strictly dominates path 1 on both axes.
      const enrichedPaths: EnrichedPath[] = [
        enrichedPath("1", "1,1", "critical", "exceeds_budget"),
        enrichedPath("2", "2,1", "safe", "within_budget"),
      ];
      const model = mockModelWithText(JSON.stringify(validLlmOutput));
      const result = await generateText({
        model,
        prompt: "evaluate these paths",
        output: Output.object({ schema: mapCoachOutputSchema }),
      });

      const originalHeadline = validLlmOutput.headline;
      const finalOutput = runPipeline(result.output, enrichedPaths);

      expect(finalOutput.compliance).toBeDefined();
      expect(finalOutput.compliance!.reranked).toBe(true);
      expect(finalOutput.compliance!.rerank_reason).toMatch(
        /^dominated_by_path_/,
      );
      expect(finalOutput.headline).not.toBe(originalHeadline);
      expect(finalOutput.headline).toContain("Safer alternative");
      expect(finalOutput.macro_path.floors[0].node_id).toBe("2,1");
      // Synthetic branch is always floor-indexed to the new path; at minimum
      // one key_branch (the synthetic swap entry) survives the cap.
      expect(finalOutput.key_branches.length).toBeGreaterThanOrEqual(1);
      expect(finalOutput.key_branches[0].decision).toContain(
        "Coach initially picked",
      );
    });

    it("passes compliance.repaired=false and reranked=false on a clean response", async () => {
      // Path 1 is already (within_budget, safe) — not dominated. Path is
      // well-formed (monster@1,1 → boss@1,2), so repair is also a no-op.
      const enrichedPaths: EnrichedPath[] = [
        enrichedPath("1", "1,1", "safe", "within_budget"),
        enrichedPath("2", "2,1", "risky", "tight"),
      ];
      const model = mockModelWithText(JSON.stringify(validLlmOutput));
      const result = await generateText({
        model,
        prompt: "evaluate these paths",
        output: Output.object({ schema: mapCoachOutputSchema }),
      });

      const finalOutput = runPipeline(result.output, enrichedPaths);

      expect(finalOutput.compliance).toBeDefined();
      expect(finalOutput.compliance!.repaired).toBe(false);
      expect(finalOutput.compliance!.reranked).toBe(false);
      expect(finalOutput.compliance!.rerank_reason).toBeNull();
      expect(finalOutput.compliance!.repair_reasons).toEqual([]);
      // Output is otherwise untouched.
      expect(finalOutput.headline).toBe(validLlmOutput.headline);
      expect(finalOutput.macro_path.floors[0].node_id).toBe("1,1");
    });

    it("does not rerank when no alternative dominates", async () => {
      // Path 1 is (tight, risky). Path 2 is (tight, safe) — ties on budget,
      // so does NOT strictly dominate. Path 3 is (exceeds_budget, safe) —
      // strictly worse on budget. No alternative wins on BOTH axes.
      const enrichedPaths: EnrichedPath[] = [
        enrichedPath("1", "1,1", "risky", "tight"),
        enrichedPath("2", "2,1", "safe", "tight"),
      ];
      const model = mockModelWithText(JSON.stringify(validLlmOutput));
      const result = await generateText({
        model,
        prompt: "evaluate these paths",
        output: Output.object({ schema: mapCoachOutputSchema }),
      });

      const finalOutput = runPipeline(result.output, enrichedPaths);

      expect(finalOutput.compliance).toBeDefined();
      expect(finalOutput.compliance!.reranked).toBe(false);
      expect(finalOutput.compliance!.rerank_reason).toBeNull();
      // Headline + macro_path stay on the LLM's pick.
      expect(finalOutput.headline).toBe(validLlmOutput.headline);
      expect(finalOutput.macro_path.floors[0].node_id).toBe("1,1");
    });
  });
});
