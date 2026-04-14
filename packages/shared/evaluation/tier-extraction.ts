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
 * Takes the authoritative list of STS2 card names so the model can match reliably.
 */
export function buildTierExtractionSystemPrompt(cardNames: string[]): string {
  const nameList = cardNames.slice().sort().join(", ");
  return `You are extracting a Slay the Spire 2 tier list from an image.

## Image layout

The image is a horizontal-row tier list, cascading vertically:

    S  | [card] [card] [card] [card] [card] ...
    A  | [card] [card] [card] ...
    B  | [card] [card] ...
    C  | [card] ...
    D  | [card] [card] ...

Each row is one tier. The tier label (S, A, B, C, D, F, 1–10, etc.) is at the LEFT edge of the row. Cards belonging to that tier extend horizontally to the RIGHT of the label, arranged left-to-right.

A card's tier is determined by which ROW it sits in. Horizontal position within a row carries no meaning — a card on the left of the S row is equally S-tier to one on the right.

## Process

1. Identify the tier labels (the leftmost column) and their vertical bands.
2. For each tier row, scan left-to-right and identify every card visible in that horizontal band.
3. A card belongs to a row if its vertical center is within that row's band. If a card straddles two bands, note it in warnings and assign to the row containing most of its area.
4. Do NOT assign cards from outside the tier-list grid (e.g., labels, icons, thumbnails in sidebars, or cards shown in legends/examples).

## Card identification

Match each card against this authoritative list of STS2 cards. Use BOTH the card name text and the card art to match:

${nameList}

Return the EXACT canonical name from the list above. Case-sensitive. Do not abbreviate or paraphrase.

## Output rules

1. If the image is NOT an STS2 tier list, return { "error": "not_a_tier_list" } and empty tiers array.
2. detected_scale: infer from the tier labels present. S/A/B/C/D/F → "letter_6". S/A/B/C/D (no F) → "letter_5". 1–10 → "numeric_10". 1–5 → "numeric_5". good/bad or pick/skip → "binary".
3. detected_character: if the image targets one character (e.g., "Ironclad Tier List" in the header), return that character name lowercase. If no character specified or cross-character, return null.
4. Every card must appear in the authoritative list above. Do NOT invent names.
5. confidence: 0.9+ = clearly recognize both art and name. 0.7–0.9 = reasonably confident from context. Below 0.7 = uncertain — prefer to omit rather than guess.
6. warnings: list any cards you couldn't identify (describe their position), unusual tier scales, cards that straddle rows, duplicate cards, or anything the admin should review.

Be thorough: scan every row completely before moving on. A missing card is worse than no output — if the image is clear and you skip cards, you've done the task poorly.

Omitting an uncertain card is better than fabricating a match.`;
}
