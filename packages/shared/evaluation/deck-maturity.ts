/** Narrow input type — only the fields computeDeckMaturity actually reads. */
export interface DeckMaturityInput {
  archetypes: { confidence: number }[];
  deckSize: number;
  deckCards: { name: string }[];
  hasScaling: boolean;
  scalingSources: string[];
  upgradeCount?: number;
}

const STARTER_DECK_SIZE = 10;
const BASICS_CEILING = 0.6; // Above 60% basics, basicsRemaining score = 0
const IDEAL_DECK_SIZE = 18; // Reasonable deck size for a refined build

/**
 * Compute a 0–1 deck maturity score.
 * Higher = more elite-ready. Weighted composite:
 *   Archetype coherence  0.30
 *   Scaling presence      0.25
 *   Basics remaining      0.20
 *   Upgrade ratio         0.15
 *   Deck size             0.10
 */
export function computeDeckMaturity(ctx: DeckMaturityInput): number {
  const { archetypes, deckSize, deckCards, hasScaling, scalingSources } = ctx;

  // 1. Archetype coherence (0–1): primary archetype confidence / 100
  const coherence = archetypes.length > 0
    ? Math.min(1, archetypes[0].confidence / 100)
    : 0;

  // 2. Scaling presence (0–1): binary base + bonus for multiple sources
  const scalingScore = !hasScaling
    ? 0
    : Math.min(1, 0.5 + scalingSources.length * 0.25);

  // 3. Basics remaining (0–1): inverse of Strike/Defend ratio
  const basicsCount = deckCards.filter((c) => {
    const name = c.name.toLowerCase();
    return name.includes("strike") || name.includes("defend");
  }).length;
  const basicsRatio = deckSize > 0 ? basicsCount / deckSize : 1;
  const basicsRemaining = Math.max(0, 1 - Math.min(1, basicsRatio / BASICS_CEILING));

  // 4. Upgrade ratio (0–1): upgraded cards / total
  const upgradeCount = ctx.upgradeCount ?? 0;
  const upgradeRatio = deckSize > 0 ? Math.min(1, upgradeCount / deckSize) : 0;

  // 5. Deck size score (0–1): penalize bloated decks, reward trim
  //    Starter = 0, ideal = 1, bloated (30+) trends toward 0.3
  const deckSizeScore = deckSize <= STARTER_DECK_SIZE
    ? 0
    : deckSize <= IDEAL_DECK_SIZE
      ? (deckSize - STARTER_DECK_SIZE) / (IDEAL_DECK_SIZE - STARTER_DECK_SIZE)
      : Math.max(0.3, 1 - (deckSize - IDEAL_DECK_SIZE) * 0.03);

  // Weighted sum
  const raw =
    coherence * 0.30 +
    scalingScore * 0.25 +
    basicsRemaining * 0.20 +
    upgradeRatio * 0.15 +
    deckSizeScore * 0.10;

  // Correlation guard: small deck + high upgrade ratio double-counts refinement
  const correlationPenalty =
    deckSizeScore > 0.7 && upgradeRatio > 0.7 ? 0.05 : 0;

  return Math.min(1, Math.max(0, raw - correlationPenalty));
}
