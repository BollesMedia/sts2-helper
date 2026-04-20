import { z } from "zod";

/**
 * Server output schema for map pathing coach evals. snake_case on the wire to
 * match Claude's output; camelCase conversion lives in the desktop adapter.
 *
 * ⚠️ This schema intentionally carries NO `z.number().min()/.max()` and NO
 * `z.array(...).max(N)` for N > 1. Anthropic's structured-output endpoint
 * rejects those JSON Schema constraints (see the header block in
 * `./eval-schemas.ts` for the full list of known rejections). Shape
 * constraints that WOULD be useful live at the prompt level (see
 * `MAP_NARRATOR_PROMPT` in `prompt-builder.ts`) and are enforced post-parse
 * by `sanitizeMapCoachOutput` below.
 */

const nodeTypeEnum = z.enum([
  "monster",
  "elite",
  "rest",
  "shop",
  "treasure",
  "event",
  "boss",
  "unknown",
]);

export type MapNodeType = z.infer<typeof nodeTypeEnum>;

// Derived from REPAIR_REASON_KINDS — compliance-report.ts is the source of
// truth. Adding a kind there automatically flows to the wire schema.
import { REPAIR_REASON_KINDS } from "./map/compliance-report";
const repairReasonKindEnum = z.enum(REPAIR_REASON_KINDS);

/**
 * Soft caps applied post-parse. Hard limits (number range, array length) are
 * NOT in the zod schema because `z.toJSONSchema` emits them as JSON Schema
 * constraints that Anthropic's structured-output endpoint rejects (#52, #68).
 */
export const MAP_COACH_LIMITS = {
  maxKeyBranches: 3,
  maxTeachingCallouts: 4,
  minConfidence: 0,
  maxConfidence: 1,
} as const;

export const mapCoachOutputSchema = z.object({
  reasoning: z.object({
    risk_capacity: z.string().min(1),
    act_goal: z.string().min(1),
  }),
  headline: z.string().min(1),
  confidence: z
    .number()
    .describe("0 to 1 float. Clamped post-parse."),
  macro_path: z.object({
    floors: z
      .array(
        z.object({
          floor: z.number(),
          node_type: nodeTypeEnum,
          node_id: z
            .string()
            .regex(/^\d+,\d+$/, 'node_id must be "col,row" format'),
        }),
      )
      .min(1),
    summary: z.string().min(1),
  }),
  key_branches: z
    .array(
      z.object({
        floor: z.number(),
        decision: z.string(),
        recommended: z.string(),
        alternatives: z.array(
          z.object({
            option: z.string(),
            tradeoff: z.string(),
          }),
        ),
        close_call: z.boolean(),
      }),
    )
    .describe(
      `At most ${MAP_COACH_LIMITS.maxKeyBranches} entries — only non-obvious decisions. Truncated post-parse if exceeded.`,
    ),
  teaching_callouts: z
    .array(
      z.object({
        pattern: z.string(),
        floors: z.array(z.number()),
        explanation: z.string(),
      }),
    )
    .describe(
      `At most ${MAP_COACH_LIMITS.maxTeachingCallouts} entries — only pedagogically useful patterns. Truncated post-parse if exceeded.`,
    ),
  compliance: z
    .object({
      repaired: z.boolean(),
      reranked: z.boolean(),
      rerank_reason: z.string().nullable(),
      repair_reasons: z.array(
        z.object({
          kind: repairReasonKindEnum,
          detail: z.string().optional(),
        }),
      ),
    })
    .optional(),
});

export type MapCoachOutputRaw = z.infer<typeof mapCoachOutputSchema>;

/**
 * Clamp confidence to [0,1] and truncate `key_branches` / `teaching_callouts`
 * to the documented caps. Returns a new object (does not mutate input).
 *
 * Caps are enforced here rather than on the schema because Anthropic
 * structured-output rejects `maxItems > 1` and `number minimum/maximum` in
 * the emitted JSON Schema.
 */
export function sanitizeMapCoachOutput(raw: MapCoachOutputRaw): MapCoachOutputRaw {
  const confidence = Math.min(
    MAP_COACH_LIMITS.maxConfidence,
    Math.max(MAP_COACH_LIMITS.minConfidence, raw.confidence),
  );
  const key_branches = raw.key_branches.slice(0, MAP_COACH_LIMITS.maxKeyBranches);
  const teaching_callouts = raw.teaching_callouts.slice(
    0,
    MAP_COACH_LIMITS.maxTeachingCallouts,
  );
  return { ...raw, confidence, key_branches, teaching_callouts };
}

/**
 * LLM-facing schema for the narrator step. The scorer picks the path; the LLM
 * produces coaching text only. The server assembles this into the
 * `mapCoachOutputSchema` response before returning to the desktop.
 */
export const mapNarratorOutputSchema = z.object({
  headline: z.string().min(1),
  reasoning: z.string().min(1),
  teaching_callouts: z
    .array(
      z.object({
        pattern: z.string(),
        explanation: z.string(),
      }),
    )
    .describe(
      `At most ${MAP_COACH_LIMITS.maxTeachingCallouts} entries — extras truncated post-parse.`,
    ),
});

export type MapNarratorOutputRaw = z.infer<typeof mapNarratorOutputSchema>;

export function sanitizeMapNarratorOutput(raw: MapNarratorOutputRaw): MapNarratorOutputRaw {
  return {
    ...raw,
    teaching_callouts: raw.teaching_callouts.slice(0, MAP_COACH_LIMITS.maxTeachingCallouts),
  };
}
