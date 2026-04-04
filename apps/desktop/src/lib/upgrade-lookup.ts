/**
 * Card upgrade data loaded from Spire Codex API.
 * Each card has an `upgrade` delta object and optional `upgrade_description`.
 * Used by the card upgrade evaluation to tell the LLM exactly what each
 * upgrade changes.
 */

interface UpgradeInfo {
  /** Human-readable upgrade delta, e.g. "damage +5" or "Draw +1 card" */
  delta: string;
  /** Full upgraded card description (if available) */
  upgradedDescription: string | null;
}

const cache = new Map<string, UpgradeInfo>();
let loaded = false;
let loading = false;

/**
 * Load card upgrade data from the Spire Codex API.
 * Call once at startup — subsequent lookups are instant.
 */
export function initUpgradeLookup(): void {
  if (loaded || loading) return;
  loading = true;

  fetch("https://spire-codex.com/api/cards")
    .then((res) => res.json())
    .then((cards: Array<{
      name: string;
      upgrade?: Record<string, string | number>;
      upgrade_description?: string;
    }>) => {
      for (const card of cards) {
        if (!card.upgrade && !card.upgrade_description) continue;

        const delta = card.upgrade
          ? formatUpgradeDelta(card.upgrade)
          : null;

        // Strip markup from upgrade description
        const desc = card.upgrade_description
          ? card.upgrade_description
              .replace(/\[gold\]/g, "").replace(/\[\/gold\]/g, "")
              .replace(/\[blue\]/g, "").replace(/\[\/blue\]/g, "")
              .replace(/\[energy:\d+\]/g, (m) => m.replace(/\[energy:/, "").replace("]", " energy"))
              .replace(/\[.*?\]/g, "")
              .replace(/\n/g, " ")
              .trim()
          : null;

        cache.set(card.name.toLowerCase(), {
          delta: delta ?? "improved",
          upgradedDescription: desc,
        });
      }
      loaded = true;
      loading = false;
    })
    .catch(() => {
      loading = false;
    });
}

/**
 * Format the upgrade delta object into a human-readable string.
 * e.g. {"damage": "+5"} → "damage +5"
 *      {"add_innate": 1} → "gains Innate"
 *      {"cost": 0} → "cost → 0"
 */
function formatUpgradeDelta(upgrade: Record<string, string | number>): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(upgrade)) {
    const v = String(value);

    // Special cases
    if (key === "add_innate") { parts.push("gains Innate"); continue; }
    if (key === "add_retain") { parts.push("gains Retain"); continue; }
    if (key === "remove_ethereal") { parts.push("loses Ethereal"); continue; }
    if (key === "remove_exhaust") { parts.push("loses Exhaust"); continue; }
    if (key === "description_changed") { parts.push("effect changed"); continue; }
    if (key === "cost" && v === "0") { parts.push("cost → 0"); continue; }

    // Common stat keys
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

/**
 * Get upgrade info for a card by name.
 * Returns null if not loaded or card has no upgrade data.
 */
export function getUpgradeInfo(cardName: string): UpgradeInfo | null {
  // Strip "+" suffix for lookup
  const baseName = cardName.replace(/\+$/, "").toLowerCase();
  return cache.get(baseName) ?? null;
}
