/**
 * Substring-based filename matcher used as a fast first pass before pHash.
 * Many community tier-list sites (e.g. tiermaker.com) encode card names in
 * image filenames — when that's reliable the match is deterministic and free.
 */

export interface NamedCandidate {
  id: string;
  name: string;
}

export interface FilenameMatch {
  candidate: NamedCandidate;
  /** The normalized card name that matched inside the filename. */
  matchedNorm: string;
}

const NORM_RE = /[^a-z0-9]/g;

function normalize(s: string): string {
  return s.toLowerCase().replace(NORM_RE, "");
}

function stemOf(imageUrl: string): string {
  const file = imageUrl.split("/").pop() ?? "";
  return file.replace(/\.[a-z]+$/i, "");
}

/**
 * Find the candidate whose normalized name appears as a substring of the
 * image's filename stem. Longest match wins (so "backstab" beats "back"),
 * with ties broken lexicographically on `id` for stability across runs.
 *
 * Guards against weak matches:
 *   - names shorter than 4 characters are ignored — common suffixes like
 *     "dash" would otherwise false-match any filename containing "dash".
 *   - the match must span at least half the stem. This aligns with
 *     tiermaker's doubled-name convention ("adrenalineadrenaline" → 50%)
 *     and rejects unrelated substrings ("strike" inside a 20-char stem
 *     that mostly isn't about Strike).
 */
const MIN_NAME_LENGTH = 4;
const MIN_COVERAGE = 0.45;

export function matchByFilename(
  imageUrl: string,
  candidates: readonly NamedCandidate[],
): FilenameMatch | null {
  const stem = normalize(stemOf(imageUrl));
  if (!stem) return null;

  let best: FilenameMatch | null = null;
  for (const c of candidates) {
    const n = normalize(c.name);
    if (n.length < MIN_NAME_LENGTH) continue;
    if (n.length / stem.length < MIN_COVERAGE) continue;
    if (!stem.includes(n)) continue;
    if (!best) {
      best = { candidate: c, matchedNorm: n };
      continue;
    }
    const bestLen = best.matchedNorm.length;
    if (n.length > bestLen) {
      best = { candidate: c, matchedNorm: n };
    } else if (n.length === bestLen && c.id < best.candidate.id) {
      best = { candidate: c, matchedNorm: n };
    }
  }
  return best;
}
