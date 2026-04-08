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
 * - Numeric fields use plain `z.number()` — NOT `z.number().int()` or
 *   `z.int()`. Both add `minimum: -Number.MAX_SAFE_INTEGER, maximum:
 *   Number.MAX_SAFE_INTEGER` to the emitted JSON Schema, and Anthropic's
 *   structured-output endpoint rejects integer types that carry
 *   minimum/maximum ("For 'integer' type, properties maximum, minimum are
 *   not supported"). This caused #48. Downstream consumers assign into
 *   TypeScript `number` (float) anyway, and the comment about Haiku
 *   returning out-of-range values that the consumer coerces silently
 *   already implied no real safety from the int constraint. The regression
 *   guard lives in `eval-schemas.test.ts`.
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
 * return. Also enforces `.length(optionCount)` so missing entries fail zod
 * validation → 502 (per the strict-fail decision).
 */
export function buildMapEvalSchema(optionCount: number) {
  return z.object({
    rankings: z
      .array(mapEvalRankingSchema)
      .length(optionCount)
      .describe(`Exactly ${optionCount} entries, one per path option in order.`),
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
 * `route.ts:479-507`) and enforces `.length(items.length)` so Haiku returning
 * fewer entries than items becomes a zod parse error → 502 (per the
 * strict-fail decision; replaces the silent fallback fill at route.ts:573-592).
 */
export function buildCardRewardSchema(items: CardRewardItem[], includeShopPlan: boolean) {
  const baseShape = {
    rankings: z
      .array(cardRewardRankingSchema)
      .length(items.length)
      .describe(
        `Exactly ${items.length} entries in this EXACT order: ${items
          .map((it, i) => `${i + 1}=${it.name}`)
          .join(", ")}.`,
      ),
    skip_recommended: z.boolean(),
    skip_reasoning: z.string().nullish(),
  };

  return includeShopPlan
    ? z.object({
        ...baseShape,
        spending_plan: z.string().nullish(),
      })
    : z.object(baseShape);
}
export type CardRewardEvalRaw = z.infer<ReturnType<typeof buildCardRewardSchema>>;
