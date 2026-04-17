import { describe, it, expect } from "vitest";
import { normalizeTier } from "./tier-normalize";
import type { TierNormalizationSource } from "./tier-normalize";

function src(scale_type: TierNormalizationSource["scale_type"], map?: Record<string, number>): TierNormalizationSource {
  return { scale_type, scale_config: map ? { map } : null };
}

describe("normalizeTier – letter_6 scale", () => {
  const source = src("letter_6");

  it.each([
    ["S", 6],
    ["A", 5],
    ["B", 4],
    ["C", 3],
    ["D", 2],
    ["F", 1],
  ])('"%s" → %d, matched: true', (raw, expected) => {
    const result = normalizeTier(raw, source);
    expect(result.normalizedTier).toBe(expected);
    expect(result.matched).toBe(true);
  });

  it("is case-insensitive: 's' → 6", () => {
    const result = normalizeTier("s", source);
    expect(result.normalizedTier).toBe(6);
    expect(result.matched).toBe(true);
  });

  it('"S-tier" → 6', () => {
    const result = normalizeTier("S-tier", source);
    expect(result.normalizedTier).toBe(6);
    expect(result.matched).toBe(true);
  });

  it('"Tier A" → 5', () => {
    const result = normalizeTier("Tier A", source);
    expect(result.normalizedTier).toBe(5);
    expect(result.matched).toBe(true);
  });

  it('"b" → 4', () => {
    const result = normalizeTier("b", source);
    expect(result.normalizedTier).toBe(4);
    expect(result.matched).toBe(true);
  });

  it('"S+" clamps to 6 (cannot exceed max)', () => {
    const result = normalizeTier("S+", source);
    expect(result.normalizedTier).toBe(6);
    expect(result.matched).toBe(true);
  });

  it('"A+" → 5.5', () => {
    const result = normalizeTier("A+", source);
    expect(result.normalizedTier).toBe(5.5);
    expect(result.matched).toBe(true);
  });

  it('"A-" → 4.5', () => {
    const result = normalizeTier("A-", source);
    expect(result.normalizedTier).toBe(4.5);
    expect(result.matched).toBe(true);
  });

  it('"Z" → 3, matched: false (unknown letter)', () => {
    const result = normalizeTier("Z", source);
    expect(result.normalizedTier).toBe(3);
    expect(result.matched).toBe(false);
  });

  it('"" → 3, matched: false (empty string)', () => {
    const result = normalizeTier("", source);
    expect(result.normalizedTier).toBe(3);
    expect(result.matched).toBe(false);
  });
});

describe("normalizeTier – letter_5 scale", () => {
  const source = src("letter_5");

  it('"D" → 2, matched: true (D is lowest in letter_5)', () => {
    const result = normalizeTier("D", source);
    expect(result.normalizedTier).toBe(2);
    expect(result.matched).toBe(true);
  });

  it('"F" → 3, matched: false (F not in letter_5 map)', () => {
    // F matches the letter regex but is not in the letter_5 map → base undefined → fallback
    const result = normalizeTier("F", source);
    expect(result.normalizedTier).toBe(3);
    expect(result.matched).toBe(false);
  });

  it('"S" → 6, matched: true', () => {
    const result = normalizeTier("S", source);
    expect(result.normalizedTier).toBe(6);
    expect(result.matched).toBe(true);
  });
});

describe("normalizeTier – numeric_10 scale", () => {
  const source = src("numeric_10");

  it('"1" → 1', () => {
    const result = normalizeTier("1", source);
    expect(result.normalizedTier).toBe(1);
    expect(result.matched).toBe(true);
  });

  it('"10" → 6', () => {
    const result = normalizeTier("10", source);
    expect(result.normalizedTier).toBe(6);
    expect(result.matched).toBe(true);
  });

  it('"5.5" → 3.5', () => {
    const result = normalizeTier("5.5", source);
    expect(result.normalizedTier).toBe(3.5);
    expect(result.matched).toBe(true);
  });

  it('"Tier 7" → 4.3 (1 + (7-1)/9 * 5, rounded to 1dp)', () => {
    const result = normalizeTier("Tier 7", source);
    expect(result.normalizedTier).toBe(4.3);
    expect(result.matched).toBe(true);
  });

  it('"11" → 3, matched: false (out of range)', () => {
    const result = normalizeTier("11", source);
    expect(result.normalizedTier).toBe(3);
    expect(result.matched).toBe(false);
  });

  it('"0" → 3, matched: false (out of range)', () => {
    const result = normalizeTier("0", source);
    expect(result.normalizedTier).toBe(3);
    expect(result.matched).toBe(false);
  });
});

describe("normalizeTier – numeric_5 scale", () => {
  const source = src("numeric_5");

  it('"1" → 1', () => {
    const result = normalizeTier("1", source);
    expect(result.normalizedTier).toBe(1);
    expect(result.matched).toBe(true);
  });

  it('"5" → 6', () => {
    const result = normalizeTier("5", source);
    expect(result.normalizedTier).toBe(6);
    expect(result.matched).toBe(true);
  });

  it('"3" → 3.5', () => {
    const result = normalizeTier("3", source);
    expect(result.normalizedTier).toBe(3.5);
    expect(result.matched).toBe(true);
  });
});

describe("normalizeTier – binary scale", () => {
  const source = src("binary");

  it.each(["good", "pick", "yes", "take", "strong"])('"%s" → 5, matched: true', (raw) => {
    const result = normalizeTier(raw, source);
    expect(result.normalizedTier).toBe(5);
    expect(result.matched).toBe(true);
  });

  it.each(["bad", "no", "skip", "avoid", "weak", "trash"])('"%s" → 2, matched: true', (raw) => {
    const result = normalizeTier(raw, source);
    expect(result.normalizedTier).toBe(2);
    expect(result.matched).toBe(true);
  });

  it('"maybe" → 3, matched: false', () => {
    const result = normalizeTier("maybe", source);
    expect(result.normalizedTier).toBe(3);
    expect(result.matched).toBe(false);
  });
});

describe("normalizeTier – per-source overrides via scale_config.map", () => {
  it("exact map match takes priority over scale_type logic", () => {
    const source = src("letter_6", { "S+": 6, "S": 5, "A": 4 });
    const result = normalizeTier("S+", source);
    expect(result.normalizedTier).toBe(6);
    expect(result.matched).toBe(true);
  });

  it("case-insensitive override: 's+' matches 'S+' in map", () => {
    const source = src("letter_6", { "S+": 6, "S": 5, "A": 4 });
    const result = normalizeTier("s+", source);
    expect(result.normalizedTier).toBe(6);
    expect(result.matched).toBe(true);
  });

  it("unknown tier falls through to base scale_type when not in override map", () => {
    // Map only covers S+/S/A; "B" should fall through to letter_6 base logic
    const source = src("letter_6", { "S+": 6, "S": 5, "A": 4 });
    const result = normalizeTier("B", source);
    expect(result.normalizedTier).toBe(4); // letter_6 default for B
    expect(result.matched).toBe(true);
  });

  it("override map values are clamped to 1-6", () => {
    const source = src("letter_6", { overpower: 10 });
    const result = normalizeTier("overpower", source);
    expect(result.normalizedTier).toBe(6);
    expect(result.matched).toBe(true);
  });
});

describe("normalizeTier – edge cases", () => {
  it("empty raw string → 3, matched: false", () => {
    const result = normalizeTier("", src("letter_6"));
    expect(result.normalizedTier).toBe(3);
    expect(result.matched).toBe(false);
  });

  it('whitespace-only "  S  " is trimmed → 6, matched: true', () => {
    const result = normalizeTier("  S  ", src("letter_6"));
    expect(result.normalizedTier).toBe(6);
    expect(result.matched).toBe(true);
  });
});
