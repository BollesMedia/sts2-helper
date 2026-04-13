import type { ShouldEvaluateMapInput } from "./should-evaluate-map";

export interface MapEvalInputSources {
  /** Number of next path options */
  optionCount: number;
  /**
   * Whether every `next_options` entry is a forced Ancient event node.
   * Caller computes via `options.every((o) => o.type === "Ancient")`.
   * See `ShouldEvaluateMapInput.allOptionsAreAncient` for the rationale.
   */
  allOptionsAreAncient: boolean;
  /** Current map position */
  currentPosition: { col: number; row: number } | null;
  /** Current act */
  act: number;
  /** Previous eval context from Redux (null if no prior eval) */
  prevContext: {
    hpPercent: number;
    deckSize: number;
    act: number;
    gold: number;
    ascension: number;
  } | null;
  /** Set of recommended node keys ("col,row") from Redux */
  recommendedNodes: Set<string>;
  /** Current HP as a fraction (0–1) */
  currentHpPercent: number;
  /** Current gold */
  currentGold: number;
  /** Current deck size */
  currentDeckSize: number;
}

/**
 * Pure function that builds the input for shouldEvaluateMap
 * from raw data sources. All impure reads happen before calling this.
 */
export function buildMapEvalInput(sources: MapEvalInputSources): ShouldEvaluateMapInput {
  const {
    optionCount,
    allOptionsAreAncient,
    currentPosition,
    act,
    prevContext,
    recommendedNodes,
    currentHpPercent,
    currentGold,
    currentDeckSize,
  } = sources;

  const hasPrevContext = prevContext !== null;

  const isOnRecommendedPath = hasPrevContext && currentPosition
    ? recommendedNodes.has(`${currentPosition.col},${currentPosition.row}`)
    : false;

  const actChanged = hasPrevContext
    ? prevContext.act !== act
    : false;

  const hpDropExceedsThreshold = hasPrevContext
    ? (prevContext.hpPercent - currentHpPercent) > 0.20
    : false;

  const goldCrossedThreshold = hasPrevContext
    ? (prevContext.gold >= 150 && currentGold < 150) || (prevContext.gold < 150 && currentGold >= 150)
    : false;

  const deckSizeChangedSignificantly = hasPrevContext
    ? Math.abs(prevContext.deckSize - currentDeckSize) >= 2
    : false;

  return {
    optionCount,
    hasPrevContext,
    actChanged,
    currentPosition,
    isOnRecommendedPath,
    allOptionsAreAncient,
    hpDropExceedsThreshold,
    goldCrossedThreshold,
    deckSizeChangedSignificantly,
    shopInPathBecameWorthless: false, // Computed in mapListeners where node data is available
  };
}
