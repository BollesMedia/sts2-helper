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
 * 3. Meaningful fork. Multiple `next_options` that differ in type or in
 *    downstream subgraph fingerprint. Off-path status is factored into
 *    the eval prompt but is NOT itself a trigger — re-planning at a
 *    single-option row wastes tokens because the next move is forced;
 *    the next fork is where a fresh recommendation actually matters.
 */
export function shouldEvaluateMap(input: ShouldEvaluateMapInput): boolean {
  if (input.optionCount <= 0) return false;

  if (!input.hasPrevContext) return true;

  if (input.isStartOfAct) {
    if (!input.ancientHealResolved) return false;
    return true;
  }

  // All remaining cases — including "player is off the recommended path" —
  // require a meaningful fork. Forced rows produce forced plans; deferring
  // to the next fork gives the eval a decision to actually reason about.
  return hasMeaningfulFork(input);
}
