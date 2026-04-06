import type { MapNode } from "@sts2/shared/types/game-state";
import type { NodePreferences } from "../../lib/eval-inputs/map";
import {
  HP_COST_ESTIMATES,
  ASCENSION_SCALING,
  REST_HEALING,
  PATH_CONSTRAINTS,
  DEFAULT_NODE_PREFERENCES,
} from "@sts2/shared/evaluation/path-constraints";

interface PathCoord {
  col: number;
  row: number;
}

export interface ConstraintTracerInput {
  startCol: number;
  startRow: number;
  nodes: readonly MapNode[];
  bossPos: { col: number; row: number };
  nodePreferences: NodePreferences | null;
  hpPercent: number;
  gold: number;
  act: number;
  ascension: number;
  maxHp: number;
  currentRemovalCost: number;
}

/** Map STS2 node type strings to preference keys */
function prefKey(nodeType: string): keyof NodePreferences | null {
  switch (nodeType) {
    case "Monster": return "monster";
    case "Elite": return "elite";
    case "Shop": return "shop";
    case "RestSite": return "rest";
    case "Treasure": return "treasure";
    case "Unknown": return "event";
    default: return null;
  }
}

/** Get the HP cost for a node type as a fraction of max HP */
function hpCost(nodeType: string, act: number, ascension: number): number {
  const actKey = `act${act}` as keyof typeof HP_COST_ESTIMATES.monster;
  let cost = 0;

  if (nodeType === "Monster") {
    cost = HP_COST_ESTIMATES.monster[actKey] ?? HP_COST_ESTIMATES.monster.act1;
  } else if (nodeType === "Elite") {
    cost = HP_COST_ESTIMATES.elite[actKey] ?? HP_COST_ESTIMATES.elite.act1;
  } else {
    return 0;
  }

  // Apply ascension scaling (cumulative — A9 includes A8 penalty)
  for (const [level, scale] of Object.entries(ASCENSION_SCALING)) {
    if (ascension >= Number(level)) {
      cost *= scale;
    }
  }

  return cost;
}

/** Check if a node is hard-gated (should never be routed through) */
function isHardGated(
  nodeType: string,
  simulatedHp: number,
  gold: number,
  removalCost: number,
): boolean {
  if (nodeType === "Elite" && simulatedHp < PATH_CONSTRAINTS.eliteHardMinHp) {
    return true;
  }
  if (nodeType === "Shop" && gold < PATH_CONSTRAINTS.shopMinGoldFn(removalCost)) {
    return true;
  }
  return false;
}

/** Compute soft penalty multiplier (0–1, lower = worse) */
function softPenalty(
  nodeType: string,
  simulatedHp: number,
  consecutiveMonsters: number,
  prevNodeType: string | null,
  hasRestNearby: boolean,
): number {
  let penalty = 1.0;

  if (nodeType === "Elite" && simulatedHp < PATH_CONSTRAINTS.eliteMinHp) {
    penalty *= 0.4;
  }

  if (nodeType === "Monster" && consecutiveMonsters >= PATH_CONSTRAINTS.consecutiveMonsterPenalty) {
    penalty *= 0.5;
  }

  if (nodeType === "Shop" && prevNodeType === "Shop") {
    penalty *= 0.3;
  }

  // Elite without a rest site within 2 nodes: only penalize when the
  // player isn't already healthy enough to absorb the fight comfortably.
  // The prior unconditional penalty compounded with the HP<70% penalty
  // and crushed elite paths even at 90% HP, making the eval overly
  // elite-averse (observed in dev event log 2026-04-06 act 1 runs).
  if (nodeType === "Elite" && !hasRestNearby && simulatedHp < PATH_CONSTRAINTS.eliteNoRestHpExempt) {
    penalty *= 0.6;
  }

  return penalty;
}

/** Check if there's a rest site within N nodes in the subtree */
function hasRestWithin(
  col: number,
  row: number,
  nodeMap: Map<string, MapNode>,
  depth: number,
): boolean {
  if (depth <= 0) return false;
  const node = nodeMap.get(`${col},${row}`);
  if (!node) return false;
  for (const [cc, cr] of node.children) {
    const child = nodeMap.get(`${cc},${cr}`);
    if (!child) continue;
    if (child.type === "RestSite") return true;
    if (depth > 1 && hasRestWithin(cc, cr, nodeMap, depth - 1)) return true;
  }
  return false;
}

/**
 * Score a subtree rooted at (col, row).
 * Combines LLM preference weights with constraint gates and soft penalties.
 */
function dfsScore(
  col: number,
  row: number,
  nodeMap: Map<string, MapNode>,
  bossPos: { col: number; row: number },
  prefs: NodePreferences,
  simulatedHp: number,
  gold: number,
  act: number,
  ascension: number,
  removalCost: number,
  visited: Set<string>,
  consecutiveMonsters: number,
  prevType: string | null,
  depth: number,
): number {
  const key = `${col},${row}`;
  if (visited.has(key)) return 0;
  visited.add(key);

  const node = nodeMap.get(key);
  if (!node) {
    if (col === bossPos.col && row === bossPos.row) return 0;
    return 0;
  }

  // Base score from LLM preferences
  const pk = prefKey(node.type);
  let score = pk ? prefs[pk] : 0;

  // Hard gate — massive negative score (but don't return 0 if it's the only path)
  if (isHardGated(node.type, simulatedHp, gold, removalCost)) {
    score = -10;
  }

  // Survival floor check
  const costFraction = hpCost(node.type, act, ascension);
  const hpAfter = simulatedHp - costFraction;
  if (hpAfter < PATH_CONSTRAINTS.survivalFloor && costFraction > 0) {
    score = -10;
  }

  // Soft penalties
  const restNearby = hasRestWithin(col, row, nodeMap, PATH_CONSTRAINTS.eliteRequiresRestWithin);
  const consMonsters = (node.type === "Monster" || node.type === "Elite")
    ? consecutiveMonsters + 1
    : 0;
  score *= softPenalty(node.type, simulatedHp, consMonsters, prevType, restNearby);

  // Update simulated HP for subtree scoring
  let nextHp = simulatedHp - costFraction;
  if (node.type === "RestSite") {
    nextHp = Math.min(1.0, nextHp + REST_HEALING);
  }
  nextHp = Math.max(0, nextHp);

  // Terminal conditions
  if (node.children.length === 0 || (col === bossPos.col && row === bossPos.row)) {
    return score;
  }

  // Recurse into children — pick best subtree
  let bestChildScore = -Infinity;
  for (const [childCol, childRow] of node.children) {
    const childScore = dfsScore(
      childCol, childRow, nodeMap, bossPos, prefs,
      nextHp, gold, act, ascension, removalCost,
      new Set(visited), consMonsters, node.type, depth + 1,
    );
    if (childScore > bestChildScore) {
      bestChildScore = childScore;
    }
  }

  return bestChildScore > -Infinity ? score + bestChildScore : score;
}

/**
 * Constraint-aware path tracer.
 *
 * Uses LLM node-type preference weights as base scores, tracks simulated HP
 * along the path, and enforces hard gates (survival floor, elite HP minimum)
 * and soft penalties (consecutive monsters, back-to-back shops).
 *
 * Pure function — no side effects, fully testable.
 */
export function traceConstraintAwarePath(input: ConstraintTracerInput): PathCoord[] {
  const {
    startCol,
    startRow,
    nodes,
    bossPos,
    nodePreferences,
    hpPercent,
    gold,
    act,
    ascension,
    currentRemovalCost,
  } = input;

  const prefs = nodePreferences ?? DEFAULT_NODE_PREFERENCES;

  const nodeMap = new Map<string, MapNode>();
  for (const n of nodes) {
    nodeMap.set(`${n.col},${n.row}`, n);
  }

  const path: PathCoord[] = [];

  function buildPath(
    col: number,
    row: number,
    simHp: number,
    consecutiveMonsters: number,
    prevType: string | null,
  ) {
    const key = `${col},${row}`;
    const node = nodeMap.get(key);
    path.push({ col, row });

    if (!node || node.children.length === 0) return;
    if (col === bossPos.col && row === bossPos.row) return;

    const seen = new Set(path.map((p) => `${p.col},${p.row}`));
    let bestChild: [number, number] | null = null;
    let bestScore = -Infinity;

    for (const [childCol, childRow] of node.children) {
      const childKey = `${childCol},${childRow}`;
      if (seen.has(childKey)) continue;

      const score = dfsScore(
        childCol, childRow, nodeMap, bossPos, prefs,
        simHp, gold, act, ascension, currentRemovalCost,
        new Set(seen), consecutiveMonsters, node.type, 0,
      );
      if (score > bestScore) {
        bestScore = score;
        bestChild = [childCol, childRow];
      }
    }

    if (bestChild) {
      const childNode = nodeMap.get(`${bestChild[0]},${bestChild[1]}`);
      const childType = childNode?.type ?? "Unknown";

      let nextHp = simHp - hpCost(childType, act, ascension);
      if (childType === "RestSite") {
        nextHp = Math.min(1.0, nextHp + REST_HEALING);
      }
      nextHp = Math.max(0, nextHp);

      const nextConsecutive = (childType === "Monster" || childType === "Elite")
        ? consecutiveMonsters + 1
        : 0;

      buildPath(bestChild[0], bestChild[1], nextHp, nextConsecutive, node.type);
    }
  }

  buildPath(startCol, startRow, hpPercent, 0, null);
  return path;
}
