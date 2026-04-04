/**
 * Resolve which card is the top pick from evaluation rankings.
 * Single source of truth — used by both the "Pick This" badge
 * and the summary text. Prevents disagreement between badge and text.
 *
 * Priority: highest tier → strongest recommendation → first in list
 */

interface RankedItem {
  itemId: string;
  itemName: string;
  tier: string;
  recommendation?: string;
  reasoning?: string;
}

interface TopPickResult {
  /** The top-ranked item */
  item: RankedItem;
  /** Summary text: "Pick [name] — [reasoning]" */
  summary: string;
}

const TIER_ORDER = ["S", "A", "B", "C", "D", "F"];
const REC_ORDER = ["strong_pick", "good_pick", "situational", "skip"];

/**
 * Find the top pick from rankings by tier, then recommendation strength.
 * Returns null if skip is recommended or no rankings exist.
 */
export function resolveTopPick(
  rankings: RankedItem[],
  skipRecommended: boolean
): TopPickResult | null {
  if (skipRecommended || rankings.length === 0) return null;

  const best = rankings.reduce((a, b) => {
    const aTier = TIER_ORDER.indexOf(a.tier);
    const bTier = TIER_ORDER.indexOf(b.tier);
    if (aTier !== bTier) return aTier < bTier ? a : b;

    const aRec = REC_ORDER.indexOf(a.recommendation ?? "situational");
    const bRec = REC_ORDER.indexOf(b.recommendation ?? "situational");
    if (aRec !== bRec) return aRec < bRec ? a : b;

    return a; // stable — first wins on full tie
  });

  // Skip-tier cards shouldn't be "top pick"
  if (best.recommendation === "skip") return null;

  const summary = best.reasoning
    ? `Pick ${best.itemName} — ${best.reasoning}`
    : `Pick ${best.itemName}`;

  return { item: best, summary };
}
