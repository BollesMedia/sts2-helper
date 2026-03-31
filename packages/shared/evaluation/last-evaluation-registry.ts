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
