/**
 * Simple in-memory registry of the most recent evaluation result per type.
 * Used by the choice tracker to determine whether the user aligned with advice.
 */

interface LastEvaluation {
  recommendedId: string | null;
  recommendedTier: string | null;
  reasoning: string;
  allRankings: { itemId: string; itemName: string; tier: string; recommendation: string }[];
  evalType: string;
  /**
   * Map-only: full parsed coach output stashed for #78 phase-2 calibration
   * (reasoning / branches / callouts / scoredPaths). Not read at runtime —
   * preserved so a future calibration pass can recover the full payload
   * after the fact. `allRankings` is intrinsically empty for map evals
   * (no per-item ranking), so live telemetry doesn't consult it for map.
   * Other eval types must not set this — their consumers read
   * `allRankings` instead.
   */
  raw?: unknown;
}

const registry = new Map<string, LastEvaluation>();

export function registerLastEvaluation(
  type: string,
  evaluation: LastEvaluation
) {
  registry.set(type, evaluation);
}

export function getLastEvaluation(type: string): LastEvaluation | undefined {
  return registry.get(type);
}

export function clearEvaluationRegistry() {
  registry.clear();
}
