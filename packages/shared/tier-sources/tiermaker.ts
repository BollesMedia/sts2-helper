import { parse as parseHtml } from "node-html-parser";
import type { ScrapedCard, ScrapedTierList, TierListSourceAdapter } from "./types";

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

    const root = parseHtml(html);
    const tierRows = root.querySelectorAll(".tier-row");

    if (tierRows.length === 0) {
      warnings.push(
        "No .tier-row blocks found. Paste the full outerHTML of #tier-wrap.",
      );
    }

    const rawLabels = new Set<string>();

    for (const row of tierRows) {
      const labelEl = row.querySelector(".label-holder .label");
      const tier = labelEl?.text.trim();
      if (!tier) continue;
      rawLabels.add(tier.toUpperCase());

      // Tiermaker renders each tile as `.character` with a child `<img>`.
      // Read from the img's src — background-image is a presentational
      // duplicate that's harder to extract portably.
      const tiles = row.querySelectorAll(".tier .character");
      for (const tile of tiles) {
        const img = tile.querySelector("img");
        const src = img?.getAttribute("src");
        if (!src) continue;
        const externalId = tile.getAttribute("id") ?? undefined;
        cards.push({ tier, externalId, imageUrl: src });
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
