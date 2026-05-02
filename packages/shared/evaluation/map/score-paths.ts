import type { EnrichedPath } from "./enrich-paths";
import type { PathNode } from "./path-patterns";
import type { RunState } from "./run-state";

// Note: no `treasuresTaken` weight. Every path in an act passes through the
// guaranteed treasure row exactly once — treasure count is a constant across
// candidates, so weighting it just pollutes branches/narration without
// affecting ranking.
export const MAP_SCORE_WEIGHTS = {
  elitesTaken: 10,
  elitesInAct1Bonus: 2,
  restBeforeElite: 8,
  restAfterElite: 5,
  unknownsActs1And2: 2,
  unknownsAct3: 1,
  projectedHpAtBossFight: 4,
  distanceToAct3EliteOpportunities: 3,
  hpDipBelow30PctPenalty: -5,
  hpDipBelow15PctPenalty: -12,
  backToBackShopPairUnderGold: -3,
  hardPoolChainLength: -2,
  /**
   * Soft penalty for shops where projected gold falls short of
   * `MIN_SHOP_PRICE_FLOOR`. Per-shop shortfall is `max(0, (FLOOR - gold) /
   * FLOOR)`; the path's penalty is `weight * Σ shortfall` summed across
   * shops. A fully naked shop (gold 0) contributes the full weight, a
   * near-affordable shop contributes proportionally less. Pairs with the
   * binary `naked_shop` disqualification: when no viable non-naked alt
   * exists, the soft penalty still differentiates "less broke" paths from
   * "more broke" ones — e.g. a shop at floor 5 (more accumulated gold)
   * over floor 2.
   */
  shopUnderfunded: -6,
} as const;

/**
 * Minimum projected gold for a shop to count as "useful". Bumped from $50
 * to $100 (#138) — at $50 a shop barely covers one common card, which
 * doesn't justify routing through it on a tight-gold turn. $100 lines up
 * with one card removal at full price ($75) plus a small buffer for an
 * incidental purchase.
 */
export const MIN_SHOP_PRICE_FLOOR = 100;
export const REST_HEAL_PCT = 0.3;

const ELITE_MULTIPLIER = 1.5;
const ESTIMATED_GOLD_PER_FIGHT = 40;

export interface ScoredPath extends EnrichedPath {
  score: number;
  scoreBreakdown: Partial<Record<keyof typeof MAP_SCORE_WEIGHTS, number>>;
  disqualified: boolean;
  disqualifyReasons: string[];
}

export interface ScorePathsOptions {
  /** Card removal cost at the current floor. Used for naked-shop rule. */
  cardRemovalCost: number;
}

interface WalkSnapshot {
  minHp: number;
  dipsBelow30Pct: number;
  dipsBelow15Pct: number;
  projectedHpEnteringPreBossRest: number;
}

function simulatePathHp(path: EnrichedPath, runState: RunState): WalkSnapshot {
  const expectedDmg = runState.riskCapacity.expectedDamagePerFight;
  const restHeal = Math.round(runState.hp.max * REST_HEAL_PCT);
  const preBossRestFloor = runState.bossPreview.preBossRestFloor;
  let hp = runState.hp.current;
  let minHp = hp;
  let dipsBelow30Pct = 0;
  let dipsBelow15Pct = 0;
  const thirtyPct = runState.hp.max * 0.3;
  const fifteenPct = runState.hp.max * 0.15;
  for (const n of path.nodes) {
    if (n.floor === preBossRestFloor) break;
    switch (n.type) {
      case "monster":
        hp -= expectedDmg;
        break;
      case "elite":
        hp -= Math.round(expectedDmg * ELITE_MULTIPLIER);
        break;
      case "rest":
        hp = Math.min(runState.hp.max, hp + restHeal);
        break;
      default:
        break;
    }
    if (hp < minHp) minHp = hp;
    if (hp < thirtyPct) dipsBelow30Pct += 1;
    if (hp < fifteenPct) dipsBelow15Pct += 1;
  }
  return {
    minHp,
    dipsBelow30Pct,
    dipsBelow15Pct,
    projectedHpEnteringPreBossRest: Math.max(0, hp),
  };
}

function estimateGoldAtFloor(
  path: EnrichedPath,
  floor: number,
  startGold: number,
): number {
  let gold = startGold;
  for (const n of path.nodes) {
    if (n.floor >= floor) break;
    if (n.type === "monster" || n.type === "elite") gold += ESTIMATED_GOLD_PER_FIGHT;
  }
  return gold;
}

function findNakedShopFloors(path: EnrichedPath, startGold: number): number[] {
  const nakedFloors: number[] = [];
  for (const n of path.nodes) {
    if (n.type !== "shop") continue;
    const goldAtShop = estimateGoldAtFloor(path, n.floor, startGold);
    if (goldAtShop < MIN_SHOP_PRICE_FLOOR) nakedFloors.push(n.floor);
  }
  return nakedFloors;
}

/**
 * Sum of per-shop shortfalls (0..1) for shops in the path. Each shop where
 * projected gold sits below `MIN_SHOP_PRICE_FLOOR` contributes
 * `(threshold - goldAtShop) / threshold`. A path with no shops, or shops
 * whose projected gold meets the threshold, returns 0.
 */
function shopShortfallTotal(path: EnrichedPath, startGold: number): number {
  let total = 0;
  for (const n of path.nodes) {
    if (n.type !== "shop") continue;
    const goldAtShop = estimateGoldAtFloor(path, n.floor, startGold);
    if (goldAtShop >= MIN_SHOP_PRICE_FLOOR) continue;
    total += (MIN_SHOP_PRICE_FLOOR - goldAtShop) / MIN_SHOP_PRICE_FLOOR;
  }
  return total;
}

// Detectors in path-patterns.ts return first-hit / longest-run for narrator signals.
// Scoring needs totals; counting here is not duplication, it's a different aggregation.
function countRestBeforeElite(nodes: PathNode[]): number {
  let count = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    if (nodes[i].type === "rest" && nodes[i + 1].type === "elite") count += 1;
  }
  return count;
}

function countRestAfterElite(nodes: PathNode[]): number {
  let count = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    if (nodes[i].type === "elite" && nodes[i + 1].type === "rest") count += 1;
  }
  return count;
}

function countUnknowns(nodes: PathNode[]): number {
  return nodes.filter((n) => n.type === "event" || n.type === "unknown").length;
}

function countBackToBackShopPairsUnderGold(
  path: EnrichedPath,
  startGold: number,
  cardRemovalCost: number,
): number {
  let count = 0;
  const nodes = path.nodes;
  for (let i = 0; i < nodes.length - 1; i++) {
    if (nodes[i].type === "shop" && nodes[i + 1].type === "shop") {
      const goldAtShop2 = estimateGoldAtFloor(path, nodes[i + 1].floor, startGold);
      if (goldAtShop2 < cardRemovalCost) count += 1;
    }
  }
  return count;
}

function hardPoolChainLengthTotal(nodes: PathNode[]): number {
  let total = 0;
  let run = 0;
  for (const n of nodes) {
    if (n.type === "monster") {
      run += 1;
    } else {
      total += run;
      run = 0;
    }
  }
  total += run;
  return total;
}

function applyHardFilter(
  paths: EnrichedPath[],
  runState: RunState,
  walks: Map<string, WalkSnapshot>,
): Map<string, string[]> {
  const reasons = new Map<string, string[]>();
  const anySurvivingEliteAlt = (threshold: number) =>
    paths.some(
      (p) =>
        p.aggregates.elitesTaken >= threshold &&
        (walks.get(p.id)?.minHp ?? 0) > 0,
    );

  for (const p of paths) {
    const walk = walks.get(p.id)!;
    const rs: string[] = [];

    // Rule 1 — fatal.
    if (walk.minHp <= 0) rs.push("fatal");

    // Rule 2 — elite abdication. Skipping ALL elites in Acts 1 and 2 when at
    // least one surviving elite alternative exists is almost always wrong —
    // elites drop relics, and early relics compound. The rule doesn't
    // distinguish Act 1 vs 2 thresholds (an earlier design said Act 1 needed
    // a 2-elite alt; practice showed that's too lenient when only 1-elite
    // alts are reachable from mid-path re-evals).
    if (p.aggregates.elitesTaken === 0) {
      if ((runState.act === 1 || runState.act === 2) && anySurvivingEliteAlt(1)) {
        rs.push("elite_abdication");
      }
    }

    // Rule 3 — naked shop.
    if (p.aggregates.shopsTaken > 0) {
      const nakedFloors = findNakedShopFloors(p, runState.gold);
      if (nakedFloors.length > 0) {
        const viableAltExists = paths.some((alt) => {
          if (alt.id === p.id) return false;
          if (alt.aggregates.elitesTaken < p.aggregates.elitesTaken) return false;
          if (alt.aggregates.shopsTaken === 0) return true;
          return findNakedShopFloors(alt, runState.gold).length === 0;
        });
        if (viableAltExists) rs.push("naked_shop");
      }
    }

    if (rs.length > 0) reasons.set(p.id, rs);
  }

  return reasons;
}

export function scorePaths(
  paths: EnrichedPath[],
  runState: RunState,
  options: ScorePathsOptions,
): ScoredPath[] {
  if (paths.length === 0) return [];

  const walks = new Map<string, WalkSnapshot>();
  for (const p of paths) walks.set(p.id, simulatePathHp(p, runState));

  const reasons = applyHardFilter(paths, runState, walks);
  const everyPathDisqualified = reasons.size === paths.length;
  const restHeal = Math.round(runState.hp.max * REST_HEAL_PCT);

  const scored: ScoredPath[] = paths.map((p) => {
    const walk = walks.get(p.id)!;
    const breakdown: Partial<Record<keyof typeof MAP_SCORE_WEIGHTS, number>> = {};

    breakdown.elitesTaken = MAP_SCORE_WEIGHTS.elitesTaken * p.aggregates.elitesTaken;
    breakdown.elitesInAct1Bonus =
      runState.act === 1
        ? MAP_SCORE_WEIGHTS.elitesInAct1Bonus * p.aggregates.elitesTaken
        : 0;
    breakdown.restBeforeElite =
      MAP_SCORE_WEIGHTS.restBeforeElite * countRestBeforeElite(p.nodes);
    breakdown.restAfterElite =
      MAP_SCORE_WEIGHTS.restAfterElite * countRestAfterElite(p.nodes);

    const unknownsTaken = countUnknowns(p.nodes);
    if (runState.act <= 2) {
      breakdown.unknownsActs1And2 = MAP_SCORE_WEIGHTS.unknownsActs1And2 * unknownsTaken;
    } else {
      breakdown.unknownsAct3 = MAP_SCORE_WEIGHTS.unknownsAct3 * unknownsTaken;
    }

    const projectedHpAtBossFight = Math.min(
      runState.hp.max,
      walk.projectedHpEnteringPreBossRest + restHeal,
    );
    breakdown.projectedHpAtBossFight =
      (MAP_SCORE_WEIGHTS.projectedHpAtBossFight * projectedHpAtBossFight) /
      Math.max(1, runState.hp.max);

    breakdown.distanceToAct3EliteOpportunities =
      runState.act === 3 && runState.ascension >= 10
        ? MAP_SCORE_WEIGHTS.distanceToAct3EliteOpportunities * p.aggregates.elitesTaken
        : 0;

    breakdown.hpDipBelow30PctPenalty =
      MAP_SCORE_WEIGHTS.hpDipBelow30PctPenalty * walk.dipsBelow30Pct;
    breakdown.hpDipBelow15PctPenalty =
      MAP_SCORE_WEIGHTS.hpDipBelow15PctPenalty * walk.dipsBelow15Pct;

    breakdown.backToBackShopPairUnderGold =
      MAP_SCORE_WEIGHTS.backToBackShopPairUnderGold *
      countBackToBackShopPairsUnderGold(p, runState.gold, options.cardRemovalCost);

    breakdown.shopUnderfunded =
      MAP_SCORE_WEIGHTS.shopUnderfunded * shopShortfallTotal(p, runState.gold);

    const hardPoolApplies = runState.act >= 2;
    breakdown.hardPoolChainLength = hardPoolApplies
      ? MAP_SCORE_WEIGHTS.hardPoolChainLength * hardPoolChainLengthTotal(p.nodes)
      : 0;

    let score = 0;
    for (const v of Object.values(breakdown)) score += v ?? 0;

    const r = reasons.get(p.id) ?? [];
    return {
      ...p,
      score,
      scoreBreakdown: breakdown,
      disqualified: everyPathDisqualified ? true : r.length > 0,
      disqualifyReasons: r,
    };
  });

  const indexById = new Map(paths.map((p, i) => [p.id, i]));

  scored.sort((a, b) => {
    if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1;

    const gap = b.score - a.score;
    if (Math.abs(gap) > 0.5) return gap;

    const aRBE = countRestBeforeElite(a.nodes);
    const bRBE = countRestBeforeElite(b.nodes);
    if (aRBE !== bRBE) return bRBE - aRBE;

    const aWalk = walks.get(a.id)!;
    const bWalk = walks.get(b.id)!;
    const aPost = Math.min(
      runState.hp.max,
      aWalk.projectedHpEnteringPreBossRest + restHeal,
    );
    const bPost = Math.min(
      runState.hp.max,
      bWalk.projectedHpEnteringPreBossRest + restHeal,
    );
    if (aPost !== bPost) return bPost - aPost;

    if (aWalk.minHp !== bWalk.minHp) return bWalk.minHp - aWalk.minHp;

    return (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0);
  });

  return scored;
}
