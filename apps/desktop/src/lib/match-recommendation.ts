/**
 * Match an LLM-recommended card name against a list of eligible cards.
 * Handles common hallucination patterns like recommending already-upgraded
 * cards (e.g., "Body Slam+" when only "Body Slam" is eligible).
 *
 * Returns the matched eligible card name, or null if no match found.
 */
export function matchRecommendation(
  recommended: string,
  eligibleNames: string[]
): string | null {
  const lower = recommended.toLowerCase();

  // Exact match
  const exact = eligibleNames.find((n) => n.toLowerCase() === lower);
  if (exact) return exact;

  // Strip "+" suffix and try again (LLM recommended upgraded version)
  if (lower.endsWith("+")) {
    const base = lower.slice(0, -1).trimEnd();
    const match = eligibleNames.find((n) => n.toLowerCase() === base);
    if (match) return match;
  }

  // Try adding "+" (LLM recommended base but only upgraded version is eligible)
  const withPlus = eligibleNames.find(
    (n) => n.toLowerCase() === `${lower}+`
  );
  if (withPlus) return withPlus;

  // Substring match as last resort (e.g., "Body Slam" matches "Body Slam+")
  const substring = eligibleNames.find(
    (n) => n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase())
  );
  if (substring) return substring;

  return null;
}
