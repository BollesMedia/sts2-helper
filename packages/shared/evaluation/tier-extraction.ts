import { z } from "zod";

/**
 * Claude Sonnet extracts tier list data from uploaded images.
 * Returns structured JSON matching this schema, or an error marker.
 *
 * ⚠️ Avoid zod constraints that emit JSON Schema features rejected by
 * Anthropic's structured-output endpoint — see the notes in eval-schemas.ts.
 * In particular: no z.number().int(), no z.array().min/max/length().
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
            confidence: z.number().min(0).max(1),
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
 * Takes the authoritative list of STS2 card names so the model can match reliably.
 */
export function buildTierExtractionSystemPrompt(cardNames: string[]): string {
  const nameList = cardNames.slice().sort().join(", ");
  return `You are extracting a Slay the Spire 2 tier list from an image.

The user will provide an image showing STS2 cards organized in tiers (S/A/B/C/D/F, 1-10, good/bad, etc.).

For each tier section visible in the image, identify the cards in that tier.
Match card names against this authoritative list of STS2 cards:
${nameList}

Output structured JSON per the schema. Follow these rules:

1. If the image is NOT an STS2 tier list, return { "error": "not_a_tier_list" } and empty tiers array.
2. detected_scale: infer from the tier labels present. If labels are S/A/B/C/D/F → "letter_6". If S/A/B/C/D (no F) → "letter_5". If numeric 1-10 → "numeric_10". If 1-5 → "numeric_5". If only "good"/"bad" or "pick"/"skip" → "binary".
3. detected_character: if the image targets one character (e.g. "Ironclad Tier List"), return that character name lowercase. If no character specified or cross-character, return null.
4. For each card, return the exact canonical name from the authoritative list. Do NOT invent card names.
5. confidence: 0.9+ when you clearly recognize the card art and name. 0.7-0.9 when reasonably confident. Below 0.7 means uncertain — prefer to omit the card rather than guess.
6. warnings: include notes about ambiguous sections, cards you couldn't identify, unusual tier scales, or anything the admin should review.

Be thorough but accurate. Omitting a card is better than guessing wrong.`;
}
