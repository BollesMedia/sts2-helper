import type { ShouldEvaluateMapInput } from "./should-evaluate-map";

export interface MapEvalInputSources {
  /** Number of next path options */
  optionCount: number;
  /** Current map position */
  currentPosition: { col: number; row: number } | null;
  /** Current act */
  act: number;
  /** Previous eval context from Redux (null if no prior eval) */
  prevContext: {
    hpPercent: number;
    deckSize: number;
    act: number;
  } | null;
  /** Set of recommended node keys ("col,row") from Redux */
  recommendedNodes: Set<string>;
}

/**
 * Pure function that builds the input for shouldEvaluateMap
 * from raw data sources. All impure reads happen before calling this.
 */
export function buildMapEvalInput(sources: MapEvalInputSources): ShouldEvaluateMapInput {
  const {
    optionCount,
    currentPosition,
    act,
    prevContext,
    recommendedNodes,
  } = sources;

  const hasPrevContext = prevContext !== null;

  const isOnRecommendedPath = hasPrevContext && currentPosition
    ? recommendedNodes.has(`${currentPosition.col},${currentPosition.row}`)
    : false;

  const actChanged = hasPrevContext
    ? prevContext.act !== act
    : false;

  return {
    optionCount,
    hasPrevContext,
    actChanged,
    currentPosition,
    isOnRecommendedPath,
  };
}
