import type { EnrichedPath } from "./enrich-paths";
import type { RunState } from "./run-state";

export const MAP_SCORE_WEIGHTS = {
  elitesTaken: 10,
  elitesInAct1Bonus: 2,
  restBeforeElite: 8,
  restAfterElite: 5,
  treasuresTaken: 6,
  unknownsActs1And2: 2,
  unknownsAct3: 1,
  projectedHpAtBossFight: 4,
  distanceToAct3EliteOpportunities: 3,
  hpDipBelow30PctPenalty: -5,
  hpDipBelow15PctPenalty: -12,
  backToBackShopPairUnderGold: -3,
  hardPoolChainLength: -2,
} as const;

export const MIN_SHOP_PRICE_FLOOR = 50;
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

function applyHardFilter(
  paths: EnrichedPath[],
  runState: RunState,
  options: ScorePathsOptions,
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

    // Rule 2 — elite abdication.
    if (p.aggregates.elitesTaken === 0) {
      if (runState.act === 1 && anySurvivingEliteAlt(2)) rs.push("elite_abdication");
      else if (runState.act === 2 && anySurvivingEliteAlt(1)) rs.push("elite_abdication");
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

    void options; // reserved for future constraints

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

  const reasons = applyHardFilter(paths, runState, options, walks);
  const everyPathDisqualified = reasons.size === paths.length;

  return paths.map((p) => {
    const r = reasons.get(p.id) ?? [];
    return {
      ...p,
      score: 0,
      scoreBreakdown: {},
      disqualified: everyPathDisqualified ? true : r.length > 0,
      disqualifyReasons: r,
    };
  });
}
