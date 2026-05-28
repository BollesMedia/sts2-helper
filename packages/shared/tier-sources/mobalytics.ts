import { parse as parseHtml, HTMLElement, NodeType } from "node-html-parser";
import type { ScrapedCard, ScrapedTierList, TierListSourceAdapter } from "./types";

// Mobalytics serves each tier list via React/Meta-style obfuscated CSS
// classes (x18d9i69, x78zum5, etc.) that change between releases. What's
// stable:
//   - tier-label divs carry an inline `--x-backgroundColor` CSS var and
//     their text content is a single letter (S|A|B|C|D|F).
//   - card images live at https://cdn.mobalytics.gg/... with the card slug
//     in the filename (adrenaline, well-laid-plans, the-hunt, etc.).
// Strategy: walk the DOM in document order. When we hit a tier label, set
// the "current tier". Every subsequent mobalytics-hosted img is bucketed
// under that tier until the next label is encountered.

const TIER_LETTER_RE = /^[SABCDEF]$/;
const CDN_HOST_RE = /^https:\/\/cdn\.mobalytics\.gg\//;

const CHARACTER_HEADER_RE =
  /^(ironclad|silent|regent|necrobinder|defect)\s+tier\s*list$/i;

function walkForCards(
  node: HTMLElement | ReturnType<typeof parseHtml>,
  onCard: (card: ScrapedCard) => void,
): void {
  let currentTier: string | null = null;

  function walk(n: HTMLElement | ReturnType<typeof parseHtml>): void {
    if (n.nodeType === NodeType.ELEMENT_NODE) {
      const el = n as HTMLElement;
      const style = el.getAttribute("style") ?? "";

      // Tier label: single-letter text + the branded CSS var.
      if (style.includes("--x-backgroundColor")) {
        const text = el.text.trim();
        if (TIER_LETTER_RE.test(text)) {
          currentTier = text;
          return; // label has no card descendants
        }
      }

      // Card image.
      if (el.tagName === "IMG") {
        const src = el.getAttribute("src");
        if (src && CDN_HOST_RE.test(src)) {
          if (currentTier) {
            onCard({
              tier: currentTier,
              imageUrl: src,
              name: nameFromUrl(src),
            });
          }
        }
        return;
      }
    }
    for (const child of n.childNodes) {
      walk(child as HTMLElement);
    }
  }

  walk(node);
}

function findCharacterSections(root: HTMLElement): Array<{
  character: string;
  rootEl: HTMLElement;
}> {
  const sections: Array<{ character: string; rootEl: HTMLElement }> = [];
  const headers = root.querySelectorAll("h2");
  for (const h of headers) {
    const text = h.text.trim();
    const m = text.match(CHARACTER_HEADER_RE);
    if (!m) continue;
    // Walk up to the nearest <section> ancestor.
    let cur: HTMLElement | null = h as HTMLElement;
    while (cur && cur.tagName !== "SECTION") {
      cur = cur.parentNode as HTMLElement | null;
    }
    if (cur) {
      sections.push({ character: m[1].toLowerCase(), rootEl: cur });
    }
  }
  return sections;
}

export const mobalyticsAdapter: TierListSourceAdapter = {
  id: "mobalytics",
  label: "mobalytics.gg",

  canHandle(url) {
    try {
      const { hostname } = new URL(url);
      return hostname === "mobalytics.gg" || hostname.endsWith(".mobalytics.gg");
    } catch {
      return false;
    }
  },

  parse(html) {
    const root = parseHtml(html);
    const characterSections = findCharacterSections(root as unknown as HTMLElement);

    if (characterSections.length > 0) {
      const sections = characterSections.map(({ character, rootEl }) => {
        const cards: ScrapedCard[] = [];
        walkForCards(rootEl, (card) => cards.push(card));
        return {
          detectedCharacter: character,
          scaleType: "letter_6" as const,
          cards,
          warnings: cards.length === 0
            ? [`No cards found in ${character} section`]
            : [],
        };
      });
      return { adapterId: "mobalytics", sections, warnings: [] };
    }

    // Fallback: whole-DOM walk → single section with detectedCharacter: null.
    const cards: ScrapedCard[] = [];
    walkForCards(root, (card) => cards.push(card));
    const warnings: string[] = [];
    if (cards.length === 0) {
      warnings.push(
        "No mobalytics CDN images found. Paste the outerHTML of the tier container.",
      );
    }
    return {
      adapterId: "mobalytics",
      sections: [
        { detectedCharacter: null, scaleType: "letter_6", cards, warnings },
      ],
      warnings: [],
    };
  },
};

/**
 * Mobalytics image URLs end in `/<card-slug>.webp`. Turn the slug into a
 * prettified name hint so the scrape route's alt-text matcher and the admin
 * preview UI both have something readable to work with.
 */
function nameFromUrl(url: string): string | undefined {
  try {
    const { pathname } = new URL(url);
    const file = pathname.split("/").pop() ?? "";
    const stem = file.replace(/\.[a-z]+$/i, "");
    if (!stem) return undefined;
    return stem
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
  } catch {
    return undefined;
  }
}
