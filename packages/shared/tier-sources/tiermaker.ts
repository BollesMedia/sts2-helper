import type { ScrapedCard, ScrapedTierList, TierListSourceAdapter } from "./types";

const TIER_ROW_RE = /<div\s+class="tier-row"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;
const LABEL_RE = /<span\s+class="label"[^>]*>([\s\S]*?)<\/span>/;
const CHARACTER_RE =
  /<div\s+class="character"[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<img[^>]*\bsrc="([^"]+)"/g;

const SEVEN_LETTER_MAP: Record<string, number> = {
  S: 6,
  A: 5.17,
  B: 4.33,
  C: 3.5,
  D: 2.67,
  E: 1.83,
  F: 1,
};

export const tiermakerAdapter: TierListSourceAdapter = {
  id: "tiermaker",
  label: "tiermaker.com",

  canHandle(url) {
    try {
      const { hostname } = new URL(url);
      return hostname === "tiermaker.com" || hostname.endsWith(".tiermaker.com");
    } catch {
      return false;
    }
  },

  parse(html) {
    const warnings: string[] = [];
    const cards: ScrapedCard[] = [];
    const tierRows = html.match(TIER_ROW_RE) ?? [];

    if (tierRows.length === 0) {
      warnings.push(
        "No .tier-row blocks found. Paste the full outerHTML of #tier-wrap.",
      );
    }

    const rawLabels = new Set<string>();

    for (const row of tierRows) {
      const labelMatch = row.match(LABEL_RE);
      if (!labelMatch) continue;
      const tier = labelMatch[1].replace(/<[^>]+>/g, "").trim();
      if (!tier) continue;
      rawLabels.add(tier.toUpperCase());

      CHARACTER_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CHARACTER_RE.exec(row)) !== null) {
        cards.push({
          tier,
          externalId: m[1],
          imageUrl: decodeHtmlEntities(m[2]),
        });
      }
    }

    // Default to letter_6 with per-source override so 7-letter tiermaker lists
    // (S/A/B/C/D/E/F) map cleanly onto the 1-6 normalized scale.
    const hasSevenLetter =
      rawLabels.has("E") && rawLabels.has("F") && rawLabels.has("S");
    const scaleConfig = hasSevenLetter ? { map: SEVEN_LETTER_MAP } : undefined;

    return {
      adapterId: "tiermaker",
      scaleType: "letter_6",
      scaleConfig,
      detectedCharacter: null,
      cards,
      warnings,
    };
  },
};

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}
