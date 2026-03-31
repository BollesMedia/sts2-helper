import type { MapNode } from "../../types/game-state";

interface PathCoord {
  col: number;
  row: number;
}

/**
 * Score a node type for path tracing. Relic-first philosophy:
 * maximize relic acquisition while keeping HP high.
 */
function scoreNode(type: string, hpPercent: number, gold: number): number {
  switch (type) {
    case "Elite": return hpPercent > 0.5 ? 15 : -5;
    case "Treasure": return 12;
    case "Unknown": return 4;
    case "RestSite": return hpPercent < 0.7 ? 10 : 3;
    case "Shop": return gold >= 150 ? 8 : gold >= 75 ? 3 : 0;
    case "Monster": return 2;
    case "Boss": return 0;
    default: return 0;
  }
}

/**
 * Trace the best path from a starting node to the boss via DFS.
 * At each branch, picks the child whose subtree has the highest
 * aggregate score. Full traversal — no depth limit.
 *
 * Returns the path as an array of {col, row} from start to boss (inclusive).
 */
export function traceRecommendedPath(
  startCol: number,
  startRow: number,
  nodes: MapNode[],
  bossPos: { col: number; row: number },
  hpPercent: number,
  gold: number
): PathCoord[] {
  const nodeMap = new Map<string, MapNode>();
  for (const n of nodes) {
    nodeMap.set(`${n.col},${n.row}`, n);
  }

  const path: PathCoord[] = [];
  const visited = new Set<string>();

  function dfs(col: number, row: number): number {
    const key = `${col},${row}`;
    if (visited.has(key)) return -Infinity;
    visited.add(key);

    const node = nodeMap.get(key);
    if (!node) {
      // Missing node — could be boss or broken data
      if (col === bossPos.col && row === bossPos.row) {
        return 0; // Boss found
      }
      console.warn("[PathTracer] Missing node:", key);
      return -Infinity;
    }

    const nodeScore = scoreNode(node.type, hpPercent, gold);

    // Terminal: boss or no children
    if (node.children.length === 0 || (col === bossPos.col && row === bossPos.row)) {
      return nodeScore;
    }

    // Evaluate each child's subtree
    let bestChild: [number, number] | null = null;
    let bestSubtreeScore = -Infinity;

    for (const [childCol, childRow] of node.children) {
      const childKey = `${childCol},${childRow}`;
      if (visited.has(childKey)) continue;

      const subtreeScore = dfsScore(childCol, childRow, nodeMap, bossPos, hpPercent, gold, new Set(visited));
      if (subtreeScore > bestSubtreeScore) {
        bestSubtreeScore = subtreeScore;
        bestChild = [childCol, childRow];
      }
    }

    return nodeScore + (bestChild ? bestSubtreeScore : 0);
  }

  // Build the actual path by following best choices
  function buildPath(col: number, row: number) {
    const key = `${col},${row}`;
    const node = nodeMap.get(key);
    path.push({ col, row });

    if (!node || node.children.length === 0) return;
    if (col === bossPos.col && row === bossPos.row) return;

    // Pick best child
    let bestChild: [number, number] | null = null;
    let bestScore = -Infinity;
    const seen = new Set(path.map((p) => `${p.col},${p.row}`));

    for (const [childCol, childRow] of node.children) {
      const childKey = `${childCol},${childRow}`;
      if (seen.has(childKey)) continue;

      const score = dfsScore(childCol, childRow, nodeMap, bossPos, hpPercent, gold, new Set(seen));
      if (score > bestScore) {
        bestScore = score;
        bestChild = [childCol, childRow];
      }
    }

    if (bestChild) {
      buildPath(bestChild[0], bestChild[1]);
    }
  }

  buildPath(startCol, startRow);
  return path;
}

/**
 * Score a subtree from a given node without modifying state.
 * Used to compare branches at decision points.
 */
function dfsScore(
  col: number,
  row: number,
  nodeMap: Map<string, MapNode>,
  bossPos: { col: number; row: number },
  hpPercent: number,
  gold: number,
  visited: Set<string>
): number {
  const key = `${col},${row}`;
  if (visited.has(key)) return 0;
  visited.add(key);

  const node = nodeMap.get(key);
  if (!node) {
    if (col === bossPos.col && row === bossPos.row) return 0;
    return 0;
  }

  let score = scoreNode(node.type, hpPercent, gold);

  if (node.children.length === 0 || (col === bossPos.col && row === bossPos.row)) {
    return score;
  }

  // Take best child's subtree score
  let bestChildScore = 0;
  for (const [childCol, childRow] of node.children) {
    const childScore = dfsScore(childCol, childRow, nodeMap, bossPos, hpPercent, gold, new Set(visited));
    if (childScore > bestChildScore) {
      bestChildScore = childScore;
    }
  }

  return score + bestChildScore;
}
