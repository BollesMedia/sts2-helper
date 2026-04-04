/**
 * Incremental card upgrade data cache.
 * Fetches upgrade info from Spire Codex API only for cards
 * not already cached. Results persist in memory for the session.
 */

interface UpgradeInfo {
  /** Human-readable upgrade delta, e.g. "damage +5" */
  delta: string;
  /** Full upgraded card description (if available) */
  upgradedDescription: string | null;
}

const cache = new Map<string, UpgradeInfo | null>();

/**
 * Fetch upgrade data for a list of card names.
 * Only fetches cards not already in cache.
 * Returns the full cache for lookups.
 */
export async function fetchUpgradeData(cardNames: string[]): Promise<void> {
  const missing = cardNames.filter((n) => !cache.has(n.toLowerCase()));
  if (missing.length === 0) return;

  try {
    // Codex API doesn't support filtering by name, so we fetch all cards
    // once and cache them. Subsequent calls are instant.
    if (cache.size === 0) {
      const res = await fetch("https://spire-codex.com/api/cards");
      const cards: Array<{
        name: string;
        upgrade?: Record<string, string | number>;
        upgrade_description?: string;
      }> = await res.json();

      for (const card of cards) {
        const key = card.name.toLowerCase();
        if (!card.upgrade && !card.upgrade_description) {
          cache.set(key, null);
          continue;
        }

        const delta = card.upgrade
          ? formatUpgradeDelta(card.upgrade)
          : null;

        const desc = card.upgrade_description
          ? stripMarkup(card.upgrade_description)
          : null;

        cache.set(key, {
          delta: delta ?? "improved",
          upgradedDescription: desc,
        });
      }
    }

    // Mark any still-missing cards as null (not in Codex)
    for (const name of missing) {
      if (!cache.has(name.toLowerCase())) {
        cache.set(name.toLowerCase(), null);
      }
    }
  } catch {
    // Non-critical — upgrade info is optional
  }
}

/**
 * Get upgrade info for a card by name.
 * Returns null if card has no upgrade data or hasn't been fetched.
 */
export function getUpgradeInfo(cardName: string): UpgradeInfo | null {
  const baseName = cardName.replace(/\+$/, "").toLowerCase();
  return cache.get(baseName) ?? null;
}

/** Strip Codex markup tags from description text */
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
 * Format the upgrade delta object into a human-readable string.
 * e.g. {"damage": "+5"} → "damage +5"
 *      {"add_innate": 1} → "gains Innate"
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
