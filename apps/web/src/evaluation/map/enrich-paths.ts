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

export interface EnrichedPath extends CandidatePath {
  patterns: PathPattern[];
  aggregates: {
    elitesTaken: number;
    restsTaken: number;
    shopsTaken: number;
    hardPoolFightsOnPath: number;
    projectedHpEnteringPreBossRest: number;
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
      tf !== undefined ? detectNoRestInLateHalf(p.nodes, tf) : null,
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
    const hardPoolFightsOnPath = Math.max(
      0,
      monstersOnPath - runState.monsterPool.fightsUntilHardPool,
    );
    const fightsOnPath = elitesTaken + monstersOnPath;
    const projectedHpEnteringPreBossRest = Math.max(
      0,
      runState.hp.current - runState.riskCapacity.expectedDamagePerFight * fightsOnPath,
    );

    return {
      ...p,
      patterns,
      aggregates: {
        elitesTaken,
        restsTaken,
        shopsTaken,
        hardPoolFightsOnPath,
        projectedHpEnteringPreBossRest,
      },
    };
  });
}
