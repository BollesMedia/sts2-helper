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
 * Triggers, in order:
 * 1. Initial eval. No prior context exists → always evaluate so we have
 *    a recommendation to compare against on subsequent polls.
 * 2. Start of act. First map-state of a new act; Acts 2/3 wait one tick
 *    if the ancient heal hasn't resolved yet.
 * 3. Off-path deviation. The player is no longer on the recommended path —
 *    re-plan immediately so the recommendation reflects the actual position,
 *    even at forced rows. Predictability beats token savings here.
 * 4. Meaningful fork. Multiple `next_options` that differ in type or in
 *    downstream subgraph fingerprint.
 */
export function shouldEvaluateMap(input: ShouldEvaluateMapInput): boolean {
  if (input.optionCount <= 0) return false;

  if (!input.hasPrevContext) return true;

  if (input.isStartOfAct) {
    if (!input.ancientHealResolved) return false;
    return true;
  }

  if (!input.isOnRecommendedPath) return true;

  return hasMeaningfulFork(input);
}
