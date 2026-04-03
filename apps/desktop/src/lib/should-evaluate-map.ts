export interface ShouldEvaluateMapInput {
  /** Number of next path options on the map */
  optionCount: number;
  /** Whether a previous evaluation context exists (lastEvalContext !== null) */
  hasPrevContext: boolean;
  /** Whether the act changed since last evaluation */
  actChanged: boolean;
  /** Current map position, or null if unknown (act start, reconnection) */
  currentPosition: { col: number; row: number } | null;
  /** Whether the current position is in the set of recommended nodes */
  isOnRecommendedPath: boolean;
  /** Whether HP or deck changed significantly since last evaluation */
  hasSignificantContextChange: boolean;
}

/**
 * Pure function that determines whether a map evaluation should be triggered.
 *
 * Returns true if a new LLM evaluation is needed, false if the existing
 * evaluation should be carried forward.
 */
export function shouldEvaluateMap(input: ShouldEvaluateMapInput): boolean {
  const {
    optionCount,
    hasPrevContext,
    actChanged,
    currentPosition,
    isOnRecommendedPath,
    hasSignificantContextChange,
  } = input;

  // Hard gate: no options at all — nothing to evaluate
  if (optionCount <= 0) return false;

  // Soft gate: single path forward with existing eval and on path — no decision needed
  if (optionCount === 1 && hasPrevContext && isOnRecommendedPath) return false;

  // No previous evaluation context — need initial evaluation
  if (!hasPrevContext) return true;

  // Act changed — always re-evaluate for new map layout
  if (actChanged) return true;

  // Current position unknown — evaluate to establish path
  if (!currentPosition) return true;

  // Deviated from recommended path — re-evaluate (even with 1 option)
  if (!isOnRecommendedPath) return true;

  // Significant context change at this fork — re-evaluate
  if (hasSignificantContextChange) return true;

  // On recommended path with stable context — carry forward
  return false;
}
