/**
 * Card upgrade data cache.
 * Fetches upgrade info from Supabase cards table for specific cards.
 * Results persist in memory for the session.
 */

import { createClient } from "@sts2/shared/supabase/client";

interface UpgradeInfo {
  /** Human-readable upgrade delta, e.g. "damage +5" */
  delta: string;
  /** Full upgraded card description (if available) */
  upgradedDescription: string | null;
}

const cache = new Map<string, UpgradeInfo | null>();

/**
 * Fetch upgrade data for a list of card names from Supabase.
 * Only fetches cards not already in cache.
 */
export async function fetchUpgradeData(cardNames: string[]): Promise<void> {
  const missing = cardNames.filter((n) => !cache.has(n.replace(/\+$/, "").toLowerCase()));
  if (missing.length === 0) return;

  try {
    const supabase = createClient();
    // Strip "+" suffix for lookup
    const baseNames = [...new Set(missing.map((n) => n.replace(/\+$/, "")))];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- upgrade columns may not be in generated types yet
    const { data } = await (supabase as any)
      .from("cards")
      .select("name, upgrade, upgrade_description")
      .in("name", baseNames);

    if (data) {
      for (const card of data as Array<{ name: string; upgrade: Record<string, string | number> | null; upgrade_description: string | null }>) {
        const key = card.name.toLowerCase();
        if (!card.upgrade && !card.upgrade_description) {
          cache.set(key, null);
          continue;
        }

        cache.set(key, {
          delta: card.upgrade ? formatUpgradeDelta(card.upgrade) : "improved",
          upgradedDescription: card.upgrade_description
            ? stripMarkup(card.upgrade_description)
            : null,
        });
      }
    }

    // Mark any still-missing cards as null
    for (const name of baseNames) {
      if (!cache.has(name.toLowerCase())) {
        cache.set(name.toLowerCase(), null);
      }
    }
  } catch {
    // Non-critical — upgrade info is optional enrichment
  }
}

/**
 * Get upgrade info for a card by name.
 * Call fetchUpgradeData first to populate the cache.
 */
export function getUpgradeInfo(cardName: string): UpgradeInfo | null {
  const baseName = cardName.replace(/\+$/, "").toLowerCase();
  return cache.get(baseName) ?? null;
}

function stripMarkup(text: string): string {
  return text
    .replace(/\[gold\]/g, "").replace(/\[\/gold\]/g, "")
    .replace(/\[blue\]/g, "").replace(/\[\/blue\]/g, "")
    .replace(/\[energy:\d+\]/g, (m) => m.replace(/\[energy:/, "").replace("]", " energy"))
    .replace(/\[.*?\]/g, "")
    .replace(/\n/g, " ")
    .trim();
}

/**
 * Format upgrade delta object into human-readable string.
 * e.g. {"damage": "+5"} → "damage +5"
 */
function formatUpgradeDelta(upgrade: Record<string, string | number>): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(upgrade)) {
    const v = String(value);

    if (key === "add_innate") { parts.push("gains Innate"); continue; }
    if (key === "add_retain") { parts.push("gains Retain"); continue; }
    if (key === "remove_ethereal") { parts.push("loses Ethereal"); continue; }
    if (key === "remove_exhaust") { parts.push("loses Exhaust"); continue; }
    if (key === "description_changed") { parts.push("effect changed"); continue; }
    if (key === "cost" && v === "0") { parts.push("cost → 0"); continue; }

    const label = key
      .replace(/power$/, "")
      .replace(/perturn$/, "/turn")
      .replace(/nextturn$/, " next turn")
      .replace(/([A-Z])/g, " $1")
      .trim()
      .toLowerCase();

    parts.push(`${label} ${v}`);
  }

  return parts.join(", ");
}
