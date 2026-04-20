import type { RunState } from "./run-state";
import type { PathNode, PathPattern } from "./path-patterns";
import {
  detectRestBeforeElite,
  detectRestAfterElite,
  detectEliteCluster,
  detectBackToBackShops,
  detectTreasureBeforeRest,
  detectMonsterChain,
  detectNoRestInLateHalf,
  detectHealVsSmithAtPreboss,
  detectRestSpentTooEarly,
} from "./path-patterns";
// (smith_before_elite was dropped — duplicate topology of rest_before_elite.)

export interface CandidatePath {
  id: string; // e.g., option index or "A", "B"
  nodes: PathNode[];
}

export type FightBudgetStatus = "within_budget" | "tight" | "exceeds_budget";
export type HpProjectionVerdict = "safe" | "risky" | "critical";

export interface EnrichedPath extends CandidatePath {
  patterns: PathPattern[];
  aggregates: {
    elitesTaken: number;
    monstersTaken: number;
    restsTaken: number;
    shopsTaken: number;
    hardPoolFightsOnPath: number;
    totalFights: number;
    projectedHpEnteringPreBossRest: number;
    fightBudgetStatus: FightBudgetStatus;
    hpProjectionVerdict: HpProjectionVerdict;
  };
}

export function enrichPaths(
  paths: CandidatePath[],
  runState: RunState,
  treasureFloorByPath: Record<string, number>,
): EnrichedPath[] {
  return paths.map((p) => {
    const patterns: PathPattern[] = [];
    const tf = treasureFloorByPath[p.id];

    const detectors = [
      detectRestBeforeElite(p.nodes),
      detectRestAfterElite(p.nodes),
      detectEliteCluster(p.nodes),
      detectBackToBackShops(p.nodes),
      detectTreasureBeforeRest(p.nodes),
      detectMonsterChain(p.nodes),
      tf !== undefined
        ? detectNoRestInLateHalf(p.nodes, tf, runState.bossPreview.preBossRestFloor)
        : null,
      detectRestSpentTooEarly(p.nodes, runState.hp.ratio, runState.bossPreview.preBossRestFloor),
    ];
    for (const d of detectors) if (d) patterns.push(d);
    patterns.push(detectHealVsSmithAtPreboss(runState.bossPreview.preBossRestRecommendation));

    const elitesTaken = p.nodes.filter((n) => n.type === "elite").length;
    const restsTaken = p.nodes.filter((n) => n.type === "rest").length;
    const shopsTaken = p.nodes.filter((n) => n.type === "shop").length;
    const monstersOnPath = p.nodes.filter((n) => n.type === "monster").length;
    // Hard-pool fights = monsters on path beyond the remaining easy-pool slots.
    // Order within the path isn't modeled here; good enough for a prompt signal.
    // Scope: regular monster encounters only — elite encounters draw from a
    // separate fixed pool by act variant and are unaffected by easy/hard-pool scaling.
    const hardPoolFightsOnPath = Math.max(
      0,
      monstersOnPath - runState.monsterPool.fightsUntilHardPool,
    );
    const totalFights = elitesTaken + monstersOnPath;

    // Walk the path node-by-node simulating HP so in-path rest heals and
    // elite damage spikes are accounted for. This is what makes the
    // REST→ELITE pattern visibly survivable: the rest heals BEFORE the
    // elite swing, and the elite is fought at full(er) HP. The old calc
    // (current_hp - totalFights × expectedDmg) ignored rest recovery and
    // flagged rest→elite paths as CRITICAL even when they were actually
    // the safest option.
    const preBossRestFloor = runState.bossPreview.preBossRestFloor;
    const restHeal = Math.round(runState.hp.max * 0.3);
    // Elites hit roughly 1.5× a regular fight's expected damage. Approximate.
    const eliteMultiplier = 1.5;
    const expectedDmg = runState.riskCapacity.expectedDamagePerFight;

    let hpSim = runState.hp.current;
    let minHpAlongPath = hpSim;
    for (const node of p.nodes) {
      // Stop at the guaranteed pre-boss rest — "projected HP entering
      // pre-boss rest" is the HP BEFORE that node, not after.
      if (node.floor === preBossRestFloor) break;
      switch (node.type) {
        case "monster":
          hpSim -= expectedDmg;
          break;
        case "elite":
          hpSim -= Math.round(expectedDmg * eliteMultiplier);
          break;
        case "rest":
          hpSim = Math.min(runState.hp.max, hpSim + restHeal);
          break;
        default:
          // shop / treasure / event / unknown / boss — no direct HP change in the sim
          break;
      }
      if (hpSim < minHpAlongPath) minHpAlongPath = hpSim;
    }
    const projectedHpEnteringPreBossRest = Math.max(0, hpSim);

    // Rests roughly restore ~30% max HP — translate to "fight equivalents"
    // for the fight-budget calc (still useful as a coarse signal).
    const restEquivalents = restsTaken * 2;
    const effectiveBudget =
      runState.riskCapacity.fightsBeforeDanger + restEquivalents;

    let fightBudgetStatus: FightBudgetStatus;
    if (totalFights <= effectiveBudget) fightBudgetStatus = "within_budget";
    else if (totalFights <= effectiveBudget * 1.3) fightBudgetStatus = "tight";
    else fightBudgetStatus = "exceeds_budget";

    // HP verdict now uses BOTH the pre-boss projection and the minimum HP
    // seen along the path. A path that dips to 0 mid-route is CRITICAL
    // regardless of final HP. Thresholds preserve the original bands
    // (safe ≥ 50%, risky 20–50%, critical < 20%) with an added death-floor
    // check via minHpAlongPath so a path that simulates a 0-HP dip between
    // rest nodes still registers as CRITICAL.
    const projectedRatio =
      projectedHpEnteringPreBossRest / Math.max(1, runState.hp.max);
    const minRatio = minHpAlongPath / Math.max(1, runState.hp.max);
    let hpProjectionVerdict: HpProjectionVerdict;
    if (minHpAlongPath <= 0 || projectedRatio < 0.2) {
      hpProjectionVerdict = "critical";
    } else if (projectedRatio < 0.5 || minRatio < 0.2) {
      hpProjectionVerdict = "risky";
    } else {
      hpProjectionVerdict = "safe";
    }

    return {
      ...p,
      patterns,
      aggregates: {
        elitesTaken,
        monstersTaken: monstersOnPath,
        restsTaken,
        shopsTaken,
        hardPoolFightsOnPath,
        totalFights,
        projectedHpEnteringPreBossRest,
        fightBudgetStatus,
        hpProjectionVerdict,
      },
    };
  });
}
