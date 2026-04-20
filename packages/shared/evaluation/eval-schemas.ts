import { z } from "zod";
import { cardRewardCoachingSchema } from "./card-reward-coach-schema";

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

interface CardRewardItem {
  name: string;
}

/**
 * Per-call schema for card_reward and shop evals. Embeds exact item position
 * labels in the `rankings` description (mirroring the inline tool schema at
 * `route.ts:479-507`). Does NOT enforce count at the schema level — see the
 * "strict-fail count enforcement" note in the header.
 */
export function buildCardRewardSchema(items: CardRewardItem[], includeShopPlan: boolean) {
  const baseShape = {
    rankings: z
      .array(cardRewardRankingSchema)
      .describe(
        `Exactly ${items.length} ranking objects, one per offered item. ` +
          `Use position values 1 through ${items.length} in this EXACT order: ${items
            .map((it, i) => `${i + 1}=${it.name}`)
            .join(", ")}. ` +
          `Do NOT add placeholder entries. Do NOT include a position 0 summary entry. ` +
          `If skipping all, still return one ranking per item with the skip reason in each \`reasoning\`.`,
      ),
    skip_recommended: z.boolean(),
    skip_reasoning: z.string().nullish(),
    coaching: cardRewardCoachingSchema.optional(),
  };

  return includeShopPlan
    ? z.object({
        ...baseShape,
        spending_plan: z.string().nullish(),
      })
    : z.object(baseShape);
}
export type CardRewardEvalRaw = z.infer<ReturnType<typeof buildCardRewardSchema>>;
