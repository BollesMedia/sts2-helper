import type { ScrapedCard, ScrapedTierList, TierListSourceAdapter } from "./types";

/**
 * sts2companion.com ships each tier list as a Next.js RSC (React Server
 * Components) flight-stream payload embedded in `self.__next_f.push([1, "…"])`
 * script tags. The payload is escaped JSON-like data; once unescaped, each
 * tier appears as `{"tier":"S","cards":[{...}, ...]}` with card objects that
 * carry our canonical DB fields (id, name, image_url, slug, color).
 *
 * That makes this the highest-fidelity source supported — no filename-hint
 * heuristics or pHash fallback needed; the card `id` flows directly into
 * the scrape route's name-lookup (via `name`) and can be audited via
 * `externalId`.
 *
 * Parsing:
 *   1. Regex out every `self.__next_f.push([1, "…"])` inner string.
 *   2. JSON-unescape each (they're double-escaped JS string literals).
 *   3. Scan the concatenated result for `"tier":"X","cards":[...]`, using
 *      a string-aware bracket counter to capture the balanced array.
 *   4. JSON.parse each cards array and emit ScrapedCards.
 */

const CODEX_ASSET_BASE = "https://spire-codex.com";

const KNOWN_CHARACTERS = new Set([
  "ironclad",
  "silent",
  "defect",
  "regent",
  "necrobinder",
]);

interface CompanionCard {
  id: string;
  name: string;
  image_url?: string;
  slug?: string;
  color?: string;
}

export const sts2companionAdapter: TierListSourceAdapter = {
  id: "sts2companion",
  label: "sts2companion.com",

  canHandle(url) {
    try {
      const { hostname } = new URL(url);
      return (
        hostname === "sts2companion.com" ||
        hostname.endsWith(".sts2companion.com")
      );
    } catch {
      return false;
    }
  },

  parse(html, url) {
    const warnings: string[] = [];
    const cards: ScrapedCard[] = [];

    const detectedCharacter = detectCharacterFromUrl(url);
    const content = decodeRscFlightStream(html);

    if (!content) {
      warnings.push(
        "No RSC flight-stream chunks found. Paste the raw page HTML (view-source), not the rendered DOM.",
      );
      return {
        adapterId: "sts2companion",
        scaleType: "letter_6",
        detectedCharacter,
        cards,
        warnings,
      };
    }

    const groups = extractTierGroups(content);
    if (groups.length === 0) {
      warnings.push(
        "No tier data found in flight-stream. Site markup may have changed.",
      );
    }

    for (const { tier, cardsJson } of groups) {
      let arr: CompanionCard[];
      try {
        arr = JSON.parse(cardsJson);
      } catch (err) {
        warnings.push(
          `Failed to parse "${tier}" card list: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      for (const c of arr) {
        if (!c || typeof c !== "object" || typeof c.id !== "string") continue;
        cards.push({
          tier,
          imageUrl: absolutizeImageUrl(c.image_url ?? ""),
          name: c.name,
          externalId: c.id,
        });
      }
    }

    return {
      adapterId: "sts2companion",
      scaleType: "letter_6",
      detectedCharacter,
      cards,
      warnings,
    };
  },
};

function detectCharacterFromUrl(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/\/tier-lists\/([a-z]+)/i);
    if (!match) return null;
    const lower = match[1].toLowerCase();
    return KNOWN_CHARACTERS.has(lower) ? lower : null;
  } catch {
    return null;
  }
}

function absolutizeImageUrl(raw: string): string {
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `${CODEX_ASSET_BASE}${raw}`;
  return `${CODEX_ASSET_BASE}/${raw}`;
}

/**
 * Pull every `self.__next_f.push([1, "..."])` chunk out of the raw HTML and
 * concatenate their unescaped contents. The inner strings are JS string
 * literals (double-escaped), so `JSON.parse('"' + inner + '"')` turns them
 * back into the original RSC payload.
 */
function decodeRscFlightStream(html: string): string {
  // Non-greedy across the push arg — stops at the closing `"])`.
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      out.push(JSON.parse(`"${m[1]}"`));
    } catch {
      // A malformed chunk shouldn't break the whole parse — skip it.
    }
  }
  return out.join("");
}

/**
 * Find every `"tier":"X","cards":[...]` occurrence in the decoded content and
 * return the tier label + the matching balanced `[...]` substring. Uses a
 * string-aware scanner so commas/brackets inside card strings don't confuse
 * the bracket counter.
 */
function extractTierGroups(content: string): Array<{
  tier: string;
  cardsJson: string;
}> {
  const groups: Array<{ tier: string; cardsJson: string }> = [];
  const re = /"tier":"([^"]+)","cards":\[/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const tier = m[1];
    const startIdx = re.lastIndex - 1; // `[` position
    let depth = 0;
    let i = startIdx;
    let inStr = false;
    let esc = false;
    for (; i < content.length; i++) {
      const c = content[i];
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (c === "\\") {
          esc = true;
          continue;
        }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === "[") {
        depth++;
      } else if (c === "]") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth === 0) {
      groups.push({ tier, cardsJson: content.slice(startIdx, i + 1) });
      re.lastIndex = i + 1;
    }
  }
  return groups;
}
