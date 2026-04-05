import type { MapNode, MapNextOption } from "@sts2/shared/types/game-state";
import type { NodePreferences } from "./eval-inputs/map";
import { traceConstraintAwarePath } from "../views/map/constraint-aware-tracer";

/**
 * Compute the preliminary mapEvalUpdated payload BEFORE the API call.
 *
 * This sets `lastEvalContext` and `recommendedNodes` immediately so that
 * subsequent game polls see `hasPrevContext=true` and don't re-trigger
 * the evaluation during the API window.
 */
export function buildPreEvalPayload(params: {
  options: readonly MapNextOption[];
  allNodes: readonly MapNode[];
  bossPos: { col: number; row: number };
  hpPercent: number;
  gold: number;
  act: number;
  deckSize: number;
  deckMaturity: number;
  relicCount: number;
  floor: number;
  ascension: number;
  maxHp: number;
  currentRemovalCost: number;
  nodePreferences: NodePreferences | null;
}): {
  recommendedNodes: string[];
  lastEvalContext: { hpPercent: number; deckSize: number; act: number; gold: number; ascension: number };
} {
  const {
    options, allNodes, bossPos,
    hpPercent, gold, act, deckSize,
    ascension, maxHp, currentRemovalCost,
    nodePreferences,
  } = params;

  const recommendedNodes = new Set<string>();

  for (const opt of options) {
    recommendedNodes.add(`${opt.col},${opt.row}`);
    const fullPath = traceConstraintAwarePath({
      startCol: opt.col,
      startRow: opt.row,
      nodes: allNodes,
      bossPos,
      nodePreferences,
      hpPercent,
      gold,
      act,
      ascension,
      maxHp,
      currentRemovalCost,
    });
    for (const p of fullPath) {
      recommendedNodes.add(`${p.col},${p.row}`);
    }
  }

  return {
    recommendedNodes: [...recommendedNodes],
    lastEvalContext: { hpPercent, deckSize, act, gold, ascension },
  };
}
