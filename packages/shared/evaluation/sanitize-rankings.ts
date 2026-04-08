/**
 * Clean up Claude's ranking arrays so the route handler can rely on them.
 *
 * After #52 removed the JSON Schema `minItems/maxItems` constraint (which
 * Anthropic was rejecting), Claude started drifting — adding placeholder
 * entries past position N and summary entries at position 0 — see #54 for
 * observed drift cases. A schema-level `.refine()` would reject those as
 * hard 502s, and `.transform()` inside the schema blows up
 * `z.toJSONSchema()` ("Transforms cannot be represented in JSON Schema"),
 * so count enforcement lives here instead.
 *
 * Contract:
 * - Filters to entries whose index is an integer in `[1, expectedCount]`.
 *   Drops anything out of range, NaN, non-integer, or missing the key.
 * - Dedupes by index, keeping the FIRST occurrence. Claude has been seen
 *   returning duplicates when it "corrects" itself mid-output; the first
 *   one is usually the intended answer.
 * - Sorts ascending by index so callers can assume positional order even
 *   when Claude returned the entries out of order.
 * - Pure function, no throws. The caller decides what to do if the
 *   sanitized length is still wrong (typically: return 502).
 */
export interface SanitizeRankingsArgs<T> {
  rankings: readonly T[];
  /** Which field on each entry holds the 1-indexed position. */
  indexKey: keyof T;
  /** Expected number of rankings. Indices must fall in `[1, expectedCount]`. */
  expectedCount: number;
}

export function sanitizeRankings<T>({
  rankings,
  indexKey,
  expectedCount,
}: SanitizeRankingsArgs<T>): T[] {
  const seen = new Set<number>();
  const kept: T[] = [];

  for (const entry of rankings) {
    const raw = entry[indexKey];
    if (typeof raw !== "number" || !Number.isInteger(raw)) continue;
    if (raw < 1 || raw > expectedCount) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    kept.push(entry);
  }

  kept.sort((a, b) => {
    // Safe — we just filtered to numeric integer indices above.
    return (a[indexKey] as unknown as number) - (b[indexKey] as unknown as number);
  });

  return kept;
}
