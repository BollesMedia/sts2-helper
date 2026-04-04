import type { MapNode, MapNextOption } from "@sts2/shared/types/game-state";
import { traceRecommendedPath } from "../views/map/map-path-tracer";

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
}): {
  recommendedNodes: string[];
  lastEvalContext: { hpPercent: number; deckSize: number; act: number };
} {
  const {
    options, allNodes, bossPos,
    hpPercent, gold, act, deckSize,
    deckMaturity, relicCount, floor,
  } = params;

  const recommendedNodes = new Set<string>();

  for (const opt of options) {
    recommendedNodes.add(`${opt.col},${opt.row}`);
    const fullPath = traceRecommendedPath(
      opt.col, opt.row,
      allNodes as MapNode[], bossPos,
      hpPercent, gold, act, deckMaturity, relicCount, floor
    );
    for (const p of fullPath) {
      recommendedNodes.add(`${p.col},${p.row}`);
    }
  }

  return {
    recommendedNodes: [...recommendedNodes],
    lastEvalContext: { hpPercent, deckSize, act },
  };
}
