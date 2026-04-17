/**
 * Normalize tier labels from heterogeneous community tier list sources
 * to a 1-6 internal scale (S=6, A=5, B=4, C=3, D=2, F=1).
 */

export type ScaleType = "letter_6" | "letter_5" | "numeric_10" | "numeric_5" | "binary";

export interface TierNormalizationSource {
  scale_type: ScaleType;
  scale_config: { map?: Record<string, number> } | null;
}

export interface NormalizationResult {
  normalizedTier: number; // 1-6
  matched: boolean;       // true if we confidently matched the raw tier
}

const LETTER_6_MAP: Record<string, number> = {
  S: 6, A: 5, B: 4, C: 3, D: 2, F: 1,
};

// Letter-5 scales typically omit F; D is the lowest tier
const LETTER_5_MAP: Record<string, number> = {
  S: 6, A: 5, B: 4, C: 3, D: 2,
};

/**
 * Normalize a raw tier label to the 1-6 scale.
 * Returns { normalizedTier, matched } where matched=false signals a fallback.
 */
export function normalizeTier(
  raw: string,
  source: TierNormalizationSource,
): NormalizationResult {
  const cleaned = raw.trim();
  if (!cleaned) return { normalizedTier: 3, matched: false };

  // Per-source overrides take priority
  const overrideMap = source.scale_config?.map;
  if (overrideMap) {
    // Try exact match first
    if (cleaned in overrideMap) {
      return { normalizedTier: clamp(overrideMap[cleaned]), matched: true };
    }
    // Try case-insensitive match
    const lowerKey = cleaned.toLowerCase();
    for (const [key, value] of Object.entries(overrideMap)) {
      if (key.toLowerCase() === lowerKey) {
        return { normalizedTier: clamp(value), matched: true };
      }
    }
  }

  switch (source.scale_type) {
    case "letter_6":
      return normalizeLetter(cleaned, LETTER_6_MAP);
    case "letter_5":
      return normalizeLetter(cleaned, LETTER_5_MAP);
    case "numeric_10":
      return normalizeNumeric(cleaned, 1, 10);
    case "numeric_5":
      return normalizeNumeric(cleaned, 1, 5);
    case "binary":
      return normalizeBinary(cleaned);
    default:
      return { normalizedTier: 3, matched: false };
  }
}

function clamp(n: number): number {
  if (Number.isNaN(n)) return 3;
  if (n < 1) return 1;
  if (n > 6) return 6;
  return n;
}

function normalizeLetter(raw: string, baseMap: Record<string, number>): NormalizationResult {
  // Extract the letter: handle "S-tier", "Tier S", "S+", "A-", "s", etc.
  const match = raw.match(/[SABCDF]/i);
  if (!match) return { normalizedTier: 3, matched: false };
  const letter = match[0].toUpperCase();
  const base = baseMap[letter];
  if (base === undefined) return { normalizedTier: 3, matched: false };

  // Check for modifiers directly attached to the tier letter (e.g. "S+", "A-", "A+")
  // + bumps up by 0.5, - bumps down by 0.5 (clamped to scale)
  // We only apply a modifier when the +/- immediately follows the letter (letter+-suffix only).
  // "S-tier" has a hyphen but it's a separator, not a grade modifier.
  let modifier = 0;
  if (/[SABCDF]\+/i.test(raw)) modifier = 0.5;
  else if (/[SABCDF]-(?!tier)/i.test(raw)) modifier = -0.5;

  return { normalizedTier: clamp(base + modifier), matched: true };
}

function normalizeNumeric(raw: string, min: number, max: number): NormalizationResult {
  // Extract the first number from the string
  const match = raw.match(/-?\d+(\.\d+)?/);
  if (!match) return { normalizedTier: 3, matched: false };
  const n = parseFloat(match[0]);
  if (Number.isNaN(n)) return { normalizedTier: 3, matched: false };
  if (n < min || n > max) return { normalizedTier: 3, matched: false };
  // Linear map [min, max] → [1, 6]
  const normalized = 1 + ((n - min) / (max - min)) * 5;
  return { normalizedTier: clamp(Math.round(normalized * 10) / 10), matched: true };
}

function normalizeBinary(raw: string): NormalizationResult {
  const lower = raw.toLowerCase();
  if (/\b(good|yes|pick|take|strong|auto[- ]?pick)\b/.test(lower)) {
    return { normalizedTier: 5, matched: true };
  }
  if (/\b(bad|no|skip|avoid|weak|trash)\b/.test(lower)) {
    return { normalizedTier: 2, matched: true };
  }
  return { normalizedTier: 3, matched: false };
}
