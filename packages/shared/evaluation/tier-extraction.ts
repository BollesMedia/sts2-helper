import { z } from "zod";

/**
 * Claude Sonnet extracts tier list data from uploaded images.
 * Returns structured JSON matching this schema, or an error marker.
 *
 * ⚠️ Avoid zod constraints that emit JSON Schema features rejected by
 * Anthropic's structured-output endpoint — see the notes in eval-schemas.ts.
 * In particular: no z.number().int(), no z.array().min/max/length(),
 * no z.number().min/max() — numeric bounds are also rejected. Enforce
 * via prompt instructions + post-parse clamping in the caller instead.
 */

export const tierExtractionSchema = z.object({
  error: z.string().nullable().optional(),
  detected_scale: z
    .enum(["letter_6", "letter_5", "numeric_10", "numeric_5", "binary"])
    .nullable()
    .optional(),
  detected_character: z
    .string()
    .nullable()
    .optional()
    .describe("Ironclad|Silent|Defect|Regent|Necrobinder, or null if cross-character"),
  tiers: z
    .array(
      z.object({
        label: z
          .string()
          .describe("The tier label from the image (e.g. 'S', 'A', '9', 'good')"),
        cards: z.array(
          z.object({
            name: z
              .string()
              .describe("Canonical card name from the provided authoritative list"),
            confidence: z
              .number()
              .describe("0.0–1.0 — how confident the match is. Clamped server-side."),
          }),
        ),
      }),
    )
    .default([]),
  warnings: z.array(z.string()).default([]),
});

export type TierExtractionResult = z.infer<typeof tierExtractionSchema>;

/**
 * Build the system prompt for tier list extraction.
 * Intentionally minimal — Gemini 2.5 Pro one-shots this task with a short prompt
 * and degrades under verbose instructions (thinking-token burn). The
 * authoritative card list is the only load-bearing anti-hallucination lever;
 * everything else is a hint.
 */
export function buildTierExtractionSystemPrompt(cardNames: string[]): string {
  const nameList = cardNames.slice().sort().join(", ");
  return `This is a Slay the Spire 2 card tier list. Extract every card into the JSON schema.

Layout: tier labels in the leftmost column, cards arranged horizontally in each row. Card names appear at the top-center of each card sprite.

Card names must match this canonical list exactly (case-sensitive):
${nameList}

Every card visible in the image must appear in the output. If a name isn't in the canonical list, omit it and note the read text in warnings.`;
}
