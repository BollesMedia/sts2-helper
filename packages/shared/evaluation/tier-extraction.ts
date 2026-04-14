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
 * Intentionally minimal. Matching to canonical card names happens client-side —
 * the model's job is to read whatever text is on each card and return it.
 */
export function buildTierExtractionSystemPrompt(): string {
  return `This is a Slay the Spire 2 card tier list. Extract every card into the JSON schema.

Layout: tier labels in the leftmost column, cards arranged horizontally in each row. Card names appear at the top-center of each card sprite — read the name text directly from there.

Every card visible in the image must appear in the output. Return the name exactly as printed on the card, including any "+" for upgraded variants. Do not omit cards whose names look unfamiliar — extract them as-is.`;
}
