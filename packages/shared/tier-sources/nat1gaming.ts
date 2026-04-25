import { parse as parseHtml } from "node-html-parser";
import type { ScrapedCard, ScrapedTierList, TierListSourceAdapter } from "./types";

// nat1gaming's "Liver" tier list plugin. Each card is an <a.liver-tier-list-item>
// with an <img alt="Card Name" data-src="...real URL..."> inside. Images load
// lazily — `src` may be a placeholder SVG until the browser hydrates, so we
// prefer data-src when present.
const SEVEN_LETTER_MAP: Record<string, number> = {
  S: 6,
  A: 5.17,
  B: 4.33,
  C: 3.5,
  D: 2.67,
  E: 1.83,
  F: 1,
};

export const nat1gamingAdapter: TierListSourceAdapter = {
  id: "nat1gaming",
  label: "nat1gaming.com",

  canHandle(url) {
    try {
      const { hostname } = new URL(url);
      return hostname === "nat1gaming.com" || hostname.endsWith(".nat1gaming.com");
    } catch {
      return false;
    }
  },

  parse(html) {
    const warnings: string[] = [];
    const cards: ScrapedCard[] = [];
    const root = parseHtml(html);

    const sections = root.querySelectorAll(".liver-tier-list-section");
    if (sections.length === 0) {
      warnings.push(
        "No .liver-tier-list-section blocks found. Paste the outerHTML of .liver-tier-list-container.",
      );
    }

    const rawLabels = new Set<string>();

    for (const section of sections) {
      const labelEl = section.querySelector(".liver-tier-list-label");
      // Label text sits directly on the div; a trailing empty <span> is
      // sometimes present. Using .text picks up both.
      const tier = labelEl?.text.trim();
      if (!tier) continue;
      rawLabels.add(tier.toUpperCase());

      const items = section.querySelectorAll(".liver-tier-list-item");
      for (const item of items) {
        const img = item.querySelector("img");
        if (!img) continue;
        const rawSrc = img.getAttribute("data-src") ?? img.getAttribute("src");
        if (!rawSrc || rawSrc.startsWith("data:")) continue; // skip lazy placeholders
        const alt = img.getAttribute("alt")?.trim() || undefined;
        cards.push({
          tier,
          imageUrl: rawSrc,
          name: alt,
        });
      }
    }

    const hasSevenLetter =
      rawLabels.has("E") && rawLabels.has("F") && rawLabels.has("S");
    const scaleConfig = hasSevenLetter ? { map: SEVEN_LETTER_MAP } : undefined;

    return {
      adapterId: "nat1gaming",
      scaleType: "letter_6",
      scaleConfig,
      detectedCharacter: null,
      cards,
      warnings,
    };
  },
};
