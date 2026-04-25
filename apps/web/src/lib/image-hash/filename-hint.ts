/**
 * Derive a human-readable name hint from an image URL when no adapter-declared
 * name is available. Used as the last-resort fallback so unmatched cards in
 * the admin preview UI still display something the admin can act on, rather
 * than a blank combobox.
 *
 * Rules:
 *   - strip query + extension
 *   - if the stem looks like tiermaker's doubled name (`foofoo`, `foo-foofoo`),
 *     collapse to the half that's duplicated
 *   - replace underscores/hyphens with spaces and title-case
 */
export function filenameHint(imageUrl: string): string {
  try {
    const { pathname } = new URL(imageUrl, "https://placeholder.invalid");
    const file = pathname.split("/").pop() ?? "";
    const stem = file.replace(/\.[a-z]+$/i, "");
    if (!stem) return "";
    const undoubled = undoubleHalves(stem);
    return prettify(undoubled);
  } catch {
    return "";
  }
}

/**
 * If the stem is exactly two copies of the same substring (possibly with a
 * hyphen separator), return one copy. Handles tiermaker's `namename.png` and
 * `welllaidplanswell-laidplans.png` variants. Otherwise returns the input.
 */
function undoubleHalves(stem: string): string {
  const len = stem.length;
  // Even-length exact double: `foofoo` → `foo`
  if (len >= 4 && len % 2 === 0) {
    const half = stem.slice(0, len / 2);
    if (stem.slice(len / 2) === half) return half;
  }
  // Tiermaker's hyphen variant: strip one arbitrary hyphen from either copy
  // and see if the halves match when normalized.
  const normalized = stem.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.length >= 4 && normalized.length % 2 === 0) {
    const half = normalized.slice(0, normalized.length / 2);
    if (normalized.slice(normalized.length / 2) === half) {
      // Return the longer-looking of the two halves so we keep hyphens.
      // Walk the original stem and split at the midpoint of the normalized
      // string — preserves any punctuation that was in the second half.
      let consumed = 0;
      for (let i = 0; i < stem.length; i++) {
        if (/[a-z0-9]/i.test(stem[i])) consumed++;
        if (consumed === normalized.length / 2) return stem.slice(i + 1);
      }
    }
  }
  return stem;
}

function prettify(s: string): string {
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
}
