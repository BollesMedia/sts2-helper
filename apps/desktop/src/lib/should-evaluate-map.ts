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
  /** Tier 2: HP dropped more than 20% since last eval */
  hpDropExceedsThreshold: boolean;
  /** Tier 2: Gold crossed a meaningful viability boundary */
  goldCrossedThreshold: boolean;
  /** Tier 2: Deck size changed significantly (card added or removed) */
  deckSizeChangedSignificantly: boolean;
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
    hpDropExceedsThreshold,
    goldCrossedThreshold,
    deckSizeChangedSignificantly,
  } = input;

  // Hard gate: no options at all — nothing to evaluate
  if (optionCount <= 0) return false;

  // Soft gate: single path forward with existing eval and on path — no decision needed
  if (optionCount === 1 && hasPrevContext && isOnRecommendedPath) return false;

  // No previous evaluation context — need initial evaluation
  if (!hasPrevContext) return true;

  // Act changed — always re-evaluate for new map layout
  if (actChanged) return true;

  // Current position unknown with no prior context is handled above.
  // With prior context, null position is a transitional state (clicking a
  // node briefly clears position before the game transitions). Don't re-eval.

  // Deviated from recommended path — re-evaluate (even with 1 option).
  // If position is null, we can't check deviation — treat as on-path.
  if (currentPosition && !isOnRecommendedPath) return true;

  // Tier 2: Material context changes — only when OFF the recommended path.
  // When on-path, the LLM already planned for expected combat costs along
  // this route. Tier 2 only matters when the player deviated AND context
  // shifted (the deviation check above already returns true for off-path,
  // but the Tier 1 local re-trace in mapListeners may handle it without
  // an API call — these flags tell shouldEvaluateMap to prefer a full
  // re-eval over a local re-trace when context has materially changed).
  // Note: these are unreachable when isOnRecommendedPath is false (line above
  // already returned true), so they effectively only gate Tier 1 → Tier 2
  // escalation in the listener. Kept here for clarity of the decision tree.

  // On recommended path with stable context — carry forward
  return false;
}
