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
 * image's filename stem. When multiple names match, the longest wins —
 * "backstab" beats "back", "calculatedgamble" beats "gamble". Names shorter
 * than 3 characters are ignored to avoid false positives on common suffixes.
 */
export function matchByFilename(
  imageUrl: string,
  candidates: readonly NamedCandidate[],
): FilenameMatch | null {
  const stem = normalize(stemOf(imageUrl));
  if (!stem) return null;

  let best: FilenameMatch | null = null;
  let bestLen = 0;
  for (const c of candidates) {
    const n = normalize(c.name);
    if (n.length < 3 || n.length <= bestLen) continue;
    if (stem.includes(n)) {
      best = { candidate: c, matchedNorm: n };
      bestLen = n.length;
    }
  }
  return best;
}
