import type { MapNode } from "../../types/game-state";

interface PathCoord {
  col: number;
  row: number;
}

interface PathContext {
  hpPercent: number;
  gold: number;
  act: number;
  deckMaturity: number;
  relicCount: number;
  floor: number;
}

// ============================================
// Node scoring — context-aware
// ============================================

const BASE_ELITE = 10;

const ACT_MODIFIER: Record<number, number> = { 1: 0.5, 2: 1.0, 3: 0.55 };

function hpModifier(hp: number): number {
  if (hp < 0.30) return 0;
  if (hp < 0.45) return 0.15;
  if (hp < 0.55) return 0.40;
  if (hp < 0.70) return 0.75;
  if (hp < 0.85) return 1.0;
  return 1.2;
}

function maturityModifier(m: number): number {
  if (m < 0.3) return 0.5;
  if (m < 0.6) return 0.8;
  return 1.0;
}

function relicDiminish(count: number): number {
  if (count <= 1) return 1.1;
  if (count <= 3) return 1.0;
  if (count <= 5) return 0.9;
  return 0.8;
}

/** Additive bonus when behind on relics — prevents safe-path death spiral */
function trajectoryBonus(floor: number, relicCount: number): number {
  const expected = Math.floor(floor / 16);
  const deficit = Math.max(0, expected - relicCount);
  return Math.min(deficit * 1.5, 4.0);
}

function scoreElite(ctx: PathContext): number {
  const act = ACT_MODIFIER[ctx.act] ?? 1.0;
  const hp = hpModifier(ctx.hpPercent);
  const mat = maturityModifier(ctx.deckMaturity);
  const relic = relicDiminish(ctx.relicCount);
  const traj = trajectoryBonus(ctx.floor, ctx.relicCount);

  return BASE_ELITE * act * hp * mat * relic + traj;
}

function scoreRestSite(ctx: PathContext): number {
  // You do one or the other — take the best option
  const healValue = ctx.hpPercent < 0.50 ? 12
    : ctx.hpPercent < 0.70 ? 8
    : ctx.hpPercent < 0.85 ? 4
    : 2;

  const upgradeValue = ctx.deckMaturity < 0.3 ? 9
    : ctx.deckMaturity < 0.5 ? 6
    : ctx.deckMaturity < 0.7 ? 3
    : 1;

  return Math.max(healValue, upgradeValue);
}

function scoreTreasure(treasuresSeen: number): number {
  if (treasuresSeen === 0) return 12;
  if (treasuresSeen === 1) return 10;
  return 8;
}

function scoreShop(gold: number): number {
  if (gold >= 150) return 8;
  if (gold >= 75) return 3;
  return 0;
}

function scoreNode(
  type: string,
  ctx: PathContext,
  treasuresSeen: number
): number {
  switch (type) {
    case "Elite": return scoreElite(ctx);
    case "Treasure": return scoreTreasure(treasuresSeen);
    case "RestSite": return scoreRestSite(ctx);
    case "Unknown": return 4;
    case "Shop": return scoreShop(ctx.gold);
    case "Monster": return 2;
    case "Boss": return 0;
    default: return 0;
  }
}

// ============================================
// Path tracing via DFS
// ============================================

/**
 * Trace the best path from a starting node to the boss via DFS.
 * At each branch, picks the child whose subtree has the highest
 * aggregate score. Full traversal — no depth limit.
 */
export function traceRecommendedPath(
  startCol: number,
  startRow: number,
  nodes: MapNode[],
  bossPos: { col: number; row: number },
  hpPercent: number,
  gold: number,
  act = 1,
  deckMaturity = 0,
  relicCount = 0,
  floor = 1
): PathCoord[] {
  const ctx: PathContext = { hpPercent, gold, act, deckMaturity, relicCount, floor };

  const nodeMap = new Map<string, MapNode>();
  for (const n of nodes) {
    nodeMap.set(`${n.col},${n.row}`, n);
  }

  const path: PathCoord[] = [];

  function buildPath(col: number, row: number) {
    const key = `${col},${row}`;
    const node = nodeMap.get(key);
    path.push({ col, row });

    if (!node || node.children.length === 0) return;
    if (col === bossPos.col && row === bossPos.row) return;

    let bestChild: [number, number] | null = null;
    let bestScore = -Infinity;
    const seen = new Set(path.map((p) => `${p.col},${p.row}`));

    for (const [childCol, childRow] of node.children) {
      const childKey = `${childCol},${childRow}`;
      if (seen.has(childKey)) continue;

      const score = dfsScore(childCol, childRow, nodeMap, bossPos, ctx, new Set(seen), 0);
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
 * Score a subtree from a given node. Used to compare branches.
 */
function dfsScore(
  col: number,
  row: number,
  nodeMap: Map<string, MapNode>,
  bossPos: { col: number; row: number },
  ctx: PathContext,
  visited: Set<string>,
  treasuresSeen: number,
  parentType?: string
): number {
  const key = `${col},${row}`;
  if (visited.has(key)) return 0;
  visited.add(key);

  const node = nodeMap.get(key);
  if (!node) {
    if (col === bossPos.col && row === bossPos.row) return 0;
    return 0;
  }

  const currentTreasures = node.type === "Treasure" ? treasuresSeen + 1 : treasuresSeen;
  let score = scoreNode(node.type, ctx, treasuresSeen);

  // Path order bonuses between parent and current node
  if (parentType) {
    if (parentType === "RestSite" && node.type === "Elite") score += 2.0;
    if (parentType === "Shop" && node.type === "Elite") score += 1.0;
    if (parentType === "Elite" && node.type === "RestSite") score += 0.5;
    if (parentType === "Elite" && node.type === "Elite") score -= 3.0;
  }

  if (node.children.length === 0 || (col === bossPos.col && row === bossPos.row)) {
    return score;
  }

  let bestChildScore = -Infinity;
  for (const [childCol, childRow] of node.children) {
    const childScore = dfsScore(
      childCol, childRow, nodeMap, bossPos, ctx,
      new Set(visited), currentTreasures, node.type
    );
    if (childScore > bestChildScore) {
      bestChildScore = childScore;
    }
  }

  return score + bestChildScore;
}
