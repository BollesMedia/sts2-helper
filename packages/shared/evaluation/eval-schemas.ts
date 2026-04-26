import { z } from "zod";

/**
 * Zod schemas for AI eval responses, shared between the web route handler
 * (server) and the desktop evaluationApi (client). Mirrors the JSON Schemas
 * previously defined in `prompt-builder.ts` (`buildMapToolSchema`,
 * `buildGenericToolSchema`, `buildSimpleToolSchema`) and the inline card/shop
 * tool schema in `apps/web/src/app/api/evaluate/route.ts`.
 *
 * Notes:
 * - Field names are snake_case to match what Claude outputs today (zero
 *   behavior change at the wire). camelCase conversion stays in adapters.
 * - ⚠️ Avoid zod constraints that leak into the emitted JSON Schema.
 *   Anthropic's structured-output endpoint rejects several JSON Schema
 *   constraints that zod v4 bakes in by default. Known-rejected:
 *     • `z.number().int()` / `z.int()` → `minimum: -MAX_SAFE_INTEGER,
 *       maximum: MAX_SAFE_INTEGER` on integer type (#48). Use `z.number()`.
 *     • `z.array(...).length(N)` / `.min(N)` / `.max(N)` → `minItems: N,
 *       maxItems: N` (#52). These cannot be replaced with `.refine()` at
 *       the schema level either (see next point), so count enforcement
 *       lives in the route handler via `sanitizeRankings`.
 *   `z.toJSONSchema()` also throws on any schema containing a `.transform()`
 *   ("Transforms cannot be represented in JSON Schema"), so transform-based
 *   workarounds are off the table. The regression test in
 *   `eval-schemas.test.ts` walks every exported schema and fails on the
 *   known-rejected patterns above, so new instances trip CI.
 * - ⚠️ Strict-fail count enforcement. After #52 removed the JSON Schema
 *   `minItems/maxItems` constraint, Claude started drifting — adding
 *   placeholder entries (position N+1) and summary entries (position 0)
 *   that a schema-level `.refine()` rejected as hard 502s even though
 *   the real rankings were all present. Count enforcement moved to the
 *   route handler: `sanitizeRankings` filters to valid indices, dedupes,
 *   and sorts, and the handler returns 502 only if the cleaned count is
 *   still wrong. The describe() text on each array still hammers the
 *   expected count as a prompt-level signal (#54).
 * - The `tier` enum mirrors `TierLetter` from `./tier-utils`. Kept inline as
 *   a zod enum (rather than imported) so this module has zero runtime deps
 *   beyond zod.
 *
 * Migration ref: sts2-helper#46
 */

export const tierEnum = z.enum(["S", "A", "B", "C", "D", "F"]);
export const recommendationEnum = z.enum([
  "strong_pick",
  "good_pick",
  "situational",
  "skip",
]);

// ─── Boss briefing ───

export const bossBriefingSchema = z.object({
  strategy: z.string(),
});
export type BossBriefingRaw = z.infer<typeof bossBriefingSchema>;

// ─── Map path eval ───

export const nodePreferencesSchema = z.object({
  monster: z.number(),
  elite: z.number(),
  shop: z.number(),
  rest: z.number(),
  treasure: z.number(),
  event: z.number(),
});
export type NodePreferencesRaw = z.infer<typeof nodePreferencesSchema>;

export const mapEvalRankingSchema = z.object({
  option_index: z.number(),
  node_type: z.string().optional(),
  tier: tierEnum,
  confidence: z.number(),
  recommendation: recommendationEnum.optional(),
  reasoning: z.string(),
});
export type MapEvalRankingRaw = z.infer<typeof mapEvalRankingSchema>;

/**
 * Server-side schema for map evals. Embeds the dynamic option count in the
 * `rankings` array description so Haiku is told exactly how many entries to
 * return. Does NOT enforce count at the schema level — see the "strict-fail
 * count enforcement" note in the header.
 */
export function buildMapEvalSchema(optionCount: number) {
  return z.object({
    rankings: z
      .array(mapEvalRankingSchema)
      .describe(
        `Exactly ${optionCount} ranking objects, one per path option. ` +
          `Use option_index values 1 through ${optionCount} (no duplicates, no gaps, no option_index 0). ` +
          `Do NOT add placeholder entries. Do NOT add a summary entry.`,
      ),
    overall_advice: z.string(),
    node_preferences: nodePreferencesSchema,
  });
}
export type MapEvalRaw = z.infer<ReturnType<typeof buildMapEvalSchema>>;

/**
 * Client-side variant — same shape, no `.length()` enforcement and no
 * description (those are server-only concerns). The client trusts the
 * server already validated the response with the parameterized schema.
 */
export const mapEvalResponseSchema = z.object({
  rankings: z.array(mapEvalRankingSchema),
  overall_advice: z.string(),
  node_preferences: nodePreferencesSchema,
});

// ─── Generic eval (event, rest_site, relic_select, etc.) ───

export const genericEvalRankingSchema = z.object({
  item_id: z.string(),
  rank: z.number().optional(),
  tier: tierEnum,
  synergy_score: z.number().optional(),
  confidence: z.number(),
  recommendation: recommendationEnum.optional(),
  reasoning: z.string(),
});
export type GenericEvalRankingRaw = z.infer<typeof genericEvalRankingSchema>;

export const genericEvalSchema = z.object({
  rankings: z.array(genericEvalRankingSchema),
  pick_summary: z.string().nullish(),
  skip_recommended: z.boolean().optional(),
  skip_reasoning: z.string().nullish(),
  overall_advice: z.string().nullish(),
});
export type GenericEvalRaw = z.infer<typeof genericEvalSchema>;

// ─── Simple eval (card_removal, card_upgrade, card_select) ───

export const simpleEvalSchema = z.object({
  card_name: z.string(),
  reasoning: z.string(),
});
export type SimpleEvalRaw = z.infer<typeof simpleEvalSchema>;

// ─── Card reward / shop eval ───

export const cardRewardRankingSchema = z.object({
  position: z.number(),
  tier: tierEnum,
  confidence: z.number(),
  reasoning: z.string(),
});
export type CardRewardRankingRaw = z.infer<typeof cardRewardRankingSchema>;

/**
 * Coaching block surfaced by the card-pick UI alongside the per-card
 * rankings. The LLM-produced variant is no longer emitted (PR #106 retired
 * that path), but the field is still consumed by `card-pick-view` to gate
 * legacy summary vs. coaching display, and inlined here so the type stays
 * stable for downstream consumers + future scorer-emitted coaching.
 */
const cardRewardCoachingShape = z.object({
  reasoning: z.object({
    deck_state: z.string(),
    commitment: z.string(),
  }),
  headline: z.string(),
  confidence: z.number(),
  key_tradeoffs: z.array(
    z.object({
      position: z.number(),
      upside: z.string(),
      downside: z.string(),
    }),
  ),
  teaching_callouts: z.array(
    z.object({
      pattern: z.string(),
      explanation: z.string(),
    }),
  ),
});

/**
 * Static schema for card_reward + shop eval responses. Replaces the
 * dynamically-built per-call factory removed when the LLM card-reward path
 * was retired (#106). Count enforcement and shop-vs-card discrimination
 * happen post-parse in the route handler.
 */
export const cardRewardEvalSchema = z.object({
  rankings: z.array(cardRewardRankingSchema),
  skip_recommended: z.boolean(),
  skip_reasoning: z.string().nullish(),
  spending_plan: z.string().nullish(),
  coaching: cardRewardCoachingShape.optional(),
});
export type CardRewardEvalRaw = z.infer<typeof cardRewardEvalSchema>;
