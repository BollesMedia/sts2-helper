export interface ShouldEvaluateMapInput {
  optionCount: number;
  hasPrevContext: boolean;
  isStartOfAct: boolean;
  ancientHealResolved: boolean;
  currentPosition: { col: number; row: number } | null;
  isOnRecommendedPath: boolean;
  nextOptions: { col: number; row: number; type: string }[];
  nextOptionSubgraphFingerprints: string[];
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
 * Three triggers:
 * 1. Start of act (post-ancient). First map-state of a new act; Acts 2/3
 *    wait one tick if the ancient heal hasn't resolved yet.
 * 2. Player off-path. Current node isn't on the recommended path.
 * 3. Meaningful fork. Multiple `next_options` that differ in type or in
 *    downstream subgraph fingerprint.
 *
 * Plus an implicit "initial eval" case: no prior context → trigger.
 */
export function shouldEvaluateMap(input: ShouldEvaluateMapInput): boolean {
  if (input.optionCount <= 0) return false;

  if (!input.hasPrevContext) return true;

  if (input.isStartOfAct) {
    if (!input.ancientHealResolved) return false;
    return true;
  }

  if (input.currentPosition && !input.isOnRecommendedPath) return true;

  if (hasMeaningfulFork(input)) return true;

  return false;
}
