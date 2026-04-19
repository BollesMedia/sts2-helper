import type { MapCoachOutputRaw } from "../map-coach-schema";
import type { EnrichedPath } from "./enrich-paths";
import type { RerankResult } from "./compliance-report";

export interface RerankInputs {
  output: MapCoachOutputRaw;
  candidates: EnrichedPath[];
}

const HP_ORDER = { safe: 0, risky: 1, critical: 2 } as const;
const BUDGET_ORDER = {
  within_budget: 0,
  tight: 1,
  exceeds_budget: 2,
} as const;

/** True iff x is strictly better on BOTH axes. */
function dominates(x: EnrichedPath, y: EnrichedPath): boolean {
  const hpStrictlyBetter =
    HP_ORDER[x.aggregates.hpProjectionVerdict] <
    HP_ORDER[y.aggregates.hpProjectionVerdict];
  const budgetStrictlyBetter =
    BUDGET_ORDER[x.aggregates.fightBudgetStatus] <
    BUDGET_ORDER[y.aggregates.fightBudgetStatus];
  return hpStrictlyBetter && budgetStrictlyBetter;
}

function findLlmPick(
  output: MapCoachOutputRaw,
  candidates: EnrichedPath[],
): EnrichedPath | null {
  const firstNodeId = output.macro_path.floors[0]?.node_id;
  if (!firstNodeId) return null;
  return candidates.find((c) => c.nodes[0]?.nodeId === firstNodeId) ?? null;
}

function shortSummary(path: EnrichedPath): string {
  const parts = path.nodes.slice(0, 4).map((n) => n.type);
  return parts.join(" → ");
}

function applySwap(
  output: MapCoachOutputRaw,
  llmPick: EnrichedPath,
  winner: EnrichedPath,
): MapCoachOutputRaw {
  const winnerFloors = winner.nodes.map((n) => ({
    floor: n.floor,
    node_type: n.type,
    node_id: n.nodeId ?? "",
  }));
  const winnerFloorSet = new Set(winnerFloors.map((f) => f.floor));

  // Filter key_branches to entries whose floor is still on the new path.
  const preservedBranches = output.key_branches.filter((b) =>
    winnerFloorSet.has(b.floor),
  );

  // Prepend synthetic swap branch at the first floor of the new path.
  const syntheticBranch = {
    floor: winnerFloors[0]?.floor ?? 0,
    decision:
      "Coach initially picked a path that exceeded fight budget or HP risk.",
    recommended: `Swap to path ${winner.id} — strictly safer.`,
    alternatives: [
      {
        option: `LLM's original pick (${shortSummary(llmPick)})`,
        tradeoff: `HP ${llmPick.aggregates.hpProjectionVerdict}, budget ${llmPick.aggregates.fightBudgetStatus}.`,
      },
    ],
    close_call: false,
  };

  // Filter teaching_callouts to those that still reference a floor on the
  // new path.
  const preservedCallouts = output.teaching_callouts.filter((c) =>
    c.floors.some((f) => winnerFloorSet.has(f)),
  );

  return {
    ...output,
    macro_path: {
      floors: winnerFloors,
      summary: `Swapped: ${shortSummary(winner)}`,
    },
    headline: `Safer alternative: ${shortSummary(winner)}`,
    confidence: Math.max(0, output.confidence - 0.15),
    key_branches: [syntheticBranch, ...preservedBranches],
    teaching_callouts: preservedCallouts,
  };
}

export function rerankIfDominated(inputs: RerankInputs): RerankResult {
  const { output, candidates } = inputs;
  const llmPick = findLlmPick(output, candidates);
  if (!llmPick) {
    return { output, reranked: false, rerank_reason: null };
  }

  const dominators = candidates.filter(
    (c) => c.id !== llmPick.id && dominates(c, llmPick),
  );
  if (dominators.length === 0) {
    return { output, reranked: false, rerank_reason: null };
  }

  // Tiebreak: lowest HP risk → best fight budget → candidates order as a
  // stable fallback.
  const candidateOrder = new Map(candidates.map((c, i) => [c.id, i]));
  const winner = [...dominators].sort((a, b) => {
    const hpDiff =
      HP_ORDER[a.aggregates.hpProjectionVerdict] -
      HP_ORDER[b.aggregates.hpProjectionVerdict];
    if (hpDiff !== 0) return hpDiff;
    const budgetDiff =
      BUDGET_ORDER[a.aggregates.fightBudgetStatus] -
      BUDGET_ORDER[b.aggregates.fightBudgetStatus];
    if (budgetDiff !== 0) return budgetDiff;
    return (candidateOrder.get(a.id) ?? 0) - (candidateOrder.get(b.id) ?? 0);
  })[0];

  return {
    output: applySwap(output, llmPick, winner),
    reranked: true,
    rerank_reason: `dominated_by_path_${winner.id}`,
  };
}
