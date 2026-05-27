export interface ShouldEvaluateMapInput {
  optionCount: number;
  hasPrevContext: boolean;
  isStartOfAct: boolean;
  ancientHealResolved: boolean;
  currentPosition: { col: number; row: number } | null;
  isOnRecommendedPath: boolean;
  nextOptions: { col: number; row: number; type: string }[];
  nextOptionSubgraphFingerprints: string[];
  /** True when currentPosition matches the position recorded at the last eval. */
  currentPosUnchanged: boolean;
  /** Rows advanced since the last eval, or null if no prior eval position is known. */
  floorsSinceLastEvalPosition: number | null;
}

function hasMeaningfulFork(input: ShouldEvaluateMapInput): boolean {
  if (input.optionCount <= 1) return false;
  const types = new Set(input.nextOptions.map((o) => o.type));
  if (types.size > 1) return true;
  const fingerprints = new Set(input.nextOptionSubgraphFingerprints);
  return fingerprints.size > 1;
}

/**
 * Decide whether a fresh map evaluation should fire.
 *
 * Triggers, in order:
 * 1. Initial eval. No prior context exists → always evaluate so we have
 *    a recommendation to compare against on subsequent polls.
 * 2. Start of act. First map-state of a new act; Acts 2/3 wait one tick
 *    if the ancient heal hasn't resolved yet.
 * 3. Off-path deviation. The player is no longer on the recommended path —
 *    re-plan immediately so the recommendation reflects the actual position,
 *    even at forced rows. Predictability beats token savings here.
 * 4. On-path suppression. Skip re-eval when the player is on-path AND
 *    either (a) hasn't moved since the last eval, or (b) just advanced
 *    one floor along the recommended path. The initial eval already
 *    analyzed this fork — no new information to add.
 * 5. Meaningful fork (backstop). Multiple `next_options` that differ in
 *    type or in downstream subgraph fingerprint, when several on-path
 *    floors have elapsed without a fresh analysis.
 */
export function shouldEvaluateMap(input: ShouldEvaluateMapInput): boolean {
  if (input.optionCount <= 0) return false;

  if (!input.hasPrevContext) return true;

  if (input.isStartOfAct) {
    if (!input.ancientHealResolved) return false;
    return true;
  }

  if (!input.isOnRecommendedPath) return true;

  // On-path: the initial eval already analyzed the full downstream tree
  // from the last-eval position. Suppress re-eval until the player has
  // advanced far enough that a fresh analysis adds information.
  if (input.currentPosUnchanged) return false;
  if (input.floorsSinceLastEvalPosition === 1) return false;

  return hasMeaningfulFork(input);
}
