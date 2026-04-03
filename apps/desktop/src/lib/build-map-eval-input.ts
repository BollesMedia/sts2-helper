import type { ShouldEvaluateMapInput } from "./should-evaluate-map";
import { hasSignificantContextChange } from "./has-significant-context-change";

export interface MapEvalInputSources {
  /** Number of next path options */
  optionCount: number;
  /** Current map position */
  currentPosition: { col: number; row: number } | null;
  /** Current act */
  act: number;
  /** Current HP percent (0-1) */
  currentHpPercent: number;
  /** Current deck size */
  currentDeckSize: number;
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
    currentHpPercent,
    currentDeckSize,
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

  const significantChange = hasPrevContext
    ? hasSignificantContextChange({
        prevHpPercent: prevContext.hpPercent,
        currentHpPercent,
        prevDeckSize: prevContext.deckSize,
        currentDeckSize,
      })
    : false;

  return {
    optionCount,
    hasPrevContext,
    actChanged,
    currentPosition,
    isOnRecommendedPath,
    hasSignificantContextChange: significantChange,
  };
}
