import { z } from "zod";

/**
 * Output schema for card reward coach. snake_case on the wire to match
 * Claude's output; camelCase conversion lives in the desktop adapter.
 *
 * No `.max()`/`.min()` numeric bounds on arrays or confidence — Anthropic's
 * structured-output endpoint rejects the emitted JSON Schema constraints.
 * Caps + clamping happen post-parse in sanitizeCardRewardCoachOutput.
 */

export const cardRewardCoachingSchema = z.object({
  reasoning: z.object({
    deck_state: z.string().min(1),
    commitment: z.string().min(1),
  }),
  headline: z.string().min(1),
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

export type CardRewardCoachingRaw = z.infer<typeof cardRewardCoachingSchema>;

const MAX_TRADEOFFS = 3;
const MAX_CALLOUTS = 3;

export function sanitizeCardRewardCoachOutput(
  raw: CardRewardCoachingRaw,
): CardRewardCoachingRaw {
  const seen = new Set<number>();
  const dedupedTradeoffs: CardRewardCoachingRaw["key_tradeoffs"] = [];
  for (const t of raw.key_tradeoffs) {
    if (seen.has(t.position)) continue;
    seen.add(t.position);
    dedupedTradeoffs.push(t);
    if (dedupedTradeoffs.length >= MAX_TRADEOFFS) break;
  }

  return {
    ...raw,
    confidence: Math.max(0, Math.min(1, raw.confidence)),
    key_tradeoffs: dedupedTradeoffs,
    teaching_callouts: raw.teaching_callouts.slice(0, MAX_CALLOUTS),
  };
}
