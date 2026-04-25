import { parse as parseHtml } from "node-html-parser";
import type { ScrapedCard, ScrapedTierList, TierListSourceAdapter } from "./types";

// slaythetierlist.com exposes a fully structured tier list:
//   - .class-panel[id="panel-<character>"] wraps one character's tiers
//   - each .tier-row carries data-tier="S|A|B|C|D|F"
//   - each .card carries data-cls + data-slug + an <img alt title src>
// This is the cleanest of the supported sources — character is explicit,
// image URLs are direct (no lazy-load placeholders), and alt text is the
// canonical capitalized name.

const KNOWN_CHARACTERS = new Set([
  "ironclad",
  "silent",
  "defect",
  "regent",
  "necrobinder",
]);

export const slaythetierlistAdapter: TierListSourceAdapter = {
  id: "slaythetierlist",
  label: "slaythetierlist.com",

  canHandle(url) {
    try {
      const { hostname } = new URL(url);
      return (
        hostname === "slaythetierlist.com" ||
        hostname.endsWith(".slaythetierlist.com")
      );
    } catch {
      return false;
    }
  },

  parse(html) {
    const warnings: string[] = [];
    const cards: ScrapedCard[] = [];
    const root = parseHtml(html);

    // Prefer the active panel when multiple are pasted; otherwise take the
    // first .class-panel we see. The panel id (`panel-silent`) surrenders
    // the character explicitly.
    const panel =
      root.querySelector(".class-panel.active") ??
      root.querySelector(".class-panel") ??
      root;

    let detectedCharacter: string | null = null;
    const panelId = panel === root ? null : panel.getAttribute?.("id") ?? null;
    if (panelId?.startsWith("panel-")) {
      const candidate = panelId.slice("panel-".length).toLowerCase();
      if (KNOWN_CHARACTERS.has(candidate)) detectedCharacter = candidate;
    }

    const rows = panel.querySelectorAll(".tier-row");
    if (rows.length === 0) {
      warnings.push(
        "No .tier-row blocks found. Paste the outerHTML of #panel-<character>.",
      );
    }

    for (const row of rows) {
      const tier =
        row.getAttribute("data-tier")?.trim() ||
        row.querySelector(".tier-letter")?.text.trim() ||
        "";
      if (!tier) continue;

      const tiles = row.querySelectorAll(".card");
      for (const tile of tiles) {
        const img = tile.querySelector("img");
        if (!img) continue;
        const src = img.getAttribute("src");
        if (!src) continue;
        const alt = img.getAttribute("alt")?.trim() || undefined;
        const slug = tile.getAttribute("data-slug") ?? undefined;
        cards.push({
          tier,
          imageUrl: src,
          name: alt,
          externalId: slug,
        });
      }
    }

    return {
      adapterId: "slaythetierlist",
      scaleType: "letter_6",
      detectedCharacter,
      cards,
      warnings,
    };
  },
};
