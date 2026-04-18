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
    const projectedHpEnteringPreBossRest = Math.max(
      0,
      runState.hp.current - runState.riskCapacity.expectedDamagePerFight * totalFights,
    );

    // Rests roughly restore ~30% max HP — translate to "fight equivalents".
    const restEquivalents = restsTaken * 2;
    const effectiveBudget =
      runState.riskCapacity.fightsBeforeDanger + restEquivalents;

    let fightBudgetStatus: FightBudgetStatus;
    if (totalFights <= effectiveBudget) fightBudgetStatus = "within_budget";
    else if (totalFights <= effectiveBudget * 1.3) fightBudgetStatus = "tight";
    else fightBudgetStatus = "exceeds_budget";

    const projectedRatio =
      projectedHpEnteringPreBossRest / Math.max(1, runState.hp.max);
    let hpProjectionVerdict: HpProjectionVerdict;
    if (projectedRatio >= 0.5) hpProjectionVerdict = "safe";
    else if (projectedRatio >= 0.3) hpProjectionVerdict = "risky";
    else hpProjectionVerdict = "critical";

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
