import type { PathNode } from "./path-patterns";
import type { ScoredPath } from "./score-paths";
import type { RunState } from "./run-state";

export interface ActiveRule {
  kind: string;
  detail?: string;
}

export interface NarratorInput {
  chosenPath: {
    summary: string;
    elites: number;
    restEliteWindows: number;
    shops: number;
    treasures: number;
    projectedHpRangeMin: number;
    projectedHpRangeMax: number;
  };
  activeRules: ActiveRule[];
  runnersUpTradeoffs: Array<{
    vsPosition: number;
    whatThisWins: string;
    whatItCosts: string;
  }>;
  runState: {
    hpPct: number;
    gold: number;
    act: 1 | 2 | 3;
    floor: number;
    ascension: number;
    committedArchetype: string | null;
  };
}

const ACTIVE_RULE_THRESHOLDS: Record<
  string,
  { kind: string; applies: (signedValue: number) => boolean }
> = {
  elitesTaken: { kind: "elitesTaken", applies: (v) => v >= 10 },
  elitesInAct1Bonus: { kind: "elitesInAct1Bonus", applies: (v) => v >= 2 },
  restBeforeElite: { kind: "restBeforeElite", applies: (v) => v >= 8 },
  restAfterElite: { kind: "restAfterElite", applies: (v) => v >= 5 },
  treasuresTaken: { kind: "treasuresTaken", applies: (v) => v >= 6 },
  unknownsActs1And2: { kind: "unknownsActs1And2", applies: (v) => v >= 4 },
  unknownsAct3: { kind: "unknownsAct3", applies: (v) => v >= 2 },
  projectedHpAtBossFight: { kind: "projectedHpAtBossFight", applies: (v) => v >= 2.5 },
  distanceToAct3EliteOpportunities: { kind: "distanceToAct3EliteOpportunities", applies: (v) => v >= 3 },
  hpDipBelow30PctPenalty: { kind: "hpDipBelow30PctPenalty", applies: (v) => v <= -10 },
  hpDipBelow15PctPenalty: { kind: "hpDipBelow15PctPenalty", applies: (v) => v <= -1 },
  backToBackShopPairUnderGold: { kind: "backToBackShopPairUnderGold", applies: (v) => v <= -1 },
  hardPoolChainLength: { kind: "hardPoolChainLength", applies: (v) => v <= -6 },
};

function pathSummary(nodes: PathNode[]): string {
  return nodes.map((n) => n.type).join(" → ");
}

function countRestEliteWindows(nodes: PathNode[]): number {
  let count = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    if (
      (nodes[i].type === "rest" && nodes[i + 1].type === "elite") ||
      (nodes[i].type === "elite" && nodes[i + 1].type === "rest")
    ) {
      count += 1;
    }
  }
  return count;
}

function topPositiveRationale(winner: ScoredPath, other: ScoredPath): string {
  let best = "";
  let bestDelta = -Infinity;
  for (const [k, wVal] of Object.entries(winner.scoreBreakdown)) {
    const delta = (wVal ?? 0) - (other.scoreBreakdown[k as keyof typeof winner.scoreBreakdown] ?? 0);
    if (delta > bestDelta) {
      best = k;
      bestDelta = delta;
    }
  }
  return best;
}

function topNegativeRationale(winner: ScoredPath, other: ScoredPath): string {
  let best = "";
  let bestDelta = Infinity;
  for (const [k, wVal] of Object.entries(winner.scoreBreakdown)) {
    const delta = (wVal ?? 0) - (other.scoreBreakdown[k as keyof typeof winner.scoreBreakdown] ?? 0);
    if (delta < bestDelta) {
      best = k;
      bestDelta = delta;
    }
  }
  return best;
}

export function buildNarratorInput(
  winner: ScoredPath,
  runnersUp: ScoredPath[],
  runState: RunState,
): NarratorInput {
  const activeRules: ActiveRule[] = [];
  for (const [key, val] of Object.entries(winner.scoreBreakdown)) {
    const rule = ACTIVE_RULE_THRESHOLDS[key];
    if (rule && rule.applies(val ?? 0)) {
      activeRules.push({ kind: rule.kind });
    }
  }

  return {
    chosenPath: {
      summary: pathSummary(winner.nodes),
      elites: winner.aggregates.elitesTaken,
      restEliteWindows: countRestEliteWindows(winner.nodes),
      shops: winner.aggregates.shopsTaken,
      treasures: winner.nodes.filter((n) => n.type === "treasure").length,
      projectedHpRangeMin: Math.max(0, winner.aggregates.projectedHpEnteringPreBossRest),
      projectedHpRangeMax: runState.hp.max,
    },
    activeRules,
    runnersUpTradeoffs: runnersUp.slice(0, 2).map((r, i) => ({
      vsPosition: i + 1,
      whatThisWins: topPositiveRationale(winner, r),
      whatItCosts: topNegativeRationale(winner, r),
    })),
    runState: {
      hpPct: runState.hp.ratio,
      gold: runState.gold,
      act: runState.act,
      floor: runState.floor,
      ascension: runState.ascension,
      committedArchetype: runState.deck.archetype,
    },
  };
}
