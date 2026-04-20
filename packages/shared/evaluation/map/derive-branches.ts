import type { PathNode } from "./path-patterns";
import type { ScoredPath } from "./score-paths";

export interface DerivedBranch {
  floor: number;
  decision: string;
  recommended: string;
  alternatives: { option: string; tradeoff: string }[];
  close_call: boolean;
}

export interface DeriveBranchesOptions {
  confidence: number;
  /** Hard cap on branches returned. Defaults to 3. */
  maxBranches?: number;
}

const BRANCH_RATIONALE: Record<string, { rec: string; alt: string }> = {
  elitesTaken: { rec: "Elite — more relics", alt: "Skips the relic" },
  elitesInAct1Bonus: { rec: "Early elite — relics compound", alt: "Foregoes early relic" },
  restBeforeElite: { rec: "Rest first, then elite", alt: "Hits the elite cold" },
  restAfterElite: { rec: "Recover after the elite", alt: "No post-elite buffer" },
  treasuresTaken: { rec: "Take the treasure", alt: "Passes on a free relic" },
  unknownsActs1And2: { rec: "Take the event", alt: "Skips event EV" },
  unknownsAct3: { rec: "Take the event", alt: "Skips event EV" },
  projectedHpAtBossFight: { rec: "Enters the boss with more HP", alt: "Enters the boss lower" },
  distanceToAct3EliteOpportunities: { rec: "More Act 3 elite density", alt: "Lighter Act 3 elite pressure" },
  hpDipBelow30PctPenalty: { rec: "Avoids the mid-path HP dip", alt: "Drops below 30% mid-path" },
  hpDipBelow15PctPenalty: { rec: "Avoids the dangerous HP dip", alt: "Drops below 15% mid-path" },
  backToBackShopPairUnderGold: { rec: "Doesn't waste a back-to-back shop", alt: "Second shop is gold-short" },
  hardPoolChainLength: { rec: "Breaks up hard-pool combat chains", alt: "Long uninterrupted monster chain" },
};

function nodeSig(n: PathNode): string {
  const anyNode = n as PathNode & { col?: number };
  return `${n.floor}:${anyNode.col ?? 0},${n.type}`;
}

function nodeLabel(n: PathNode): string {
  const t = n.type;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function pickTopDelta(winner: ScoredPath, runnerUp: ScoredPath): string {
  let best = "";
  let bestVal = -Infinity;
  for (const [key, wVal] of Object.entries(winner.scoreBreakdown)) {
    const rVal = runnerUp.scoreBreakdown[key as keyof typeof winner.scoreBreakdown] ?? 0;
    const delta = (wVal ?? 0) - rVal;
    if (delta > bestVal) {
      best = key;
      bestVal = delta;
    }
  }
  return best;
}

export function deriveBranches(
  winner: ScoredPath,
  runnerUp: ScoredPath,
  options: DeriveBranchesOptions,
): DerivedBranch[] {
  const maxBranches = options.maxBranches ?? 3;
  const out: DerivedBranch[] = [];
  const len = Math.min(winner.nodes.length, runnerUp.nodes.length);

  let previousDivergence = false;
  for (let i = 0; i < len && out.length < maxBranches; i++) {
    const w = winner.nodes[i];
    const r = runnerUp.nodes[i];
    const diverges = nodeSig(w) !== nodeSig(r);
    if (diverges && !previousDivergence) {
      const topDelta = pickTopDelta(winner, runnerUp);
      const rationale = BRANCH_RATIONALE[topDelta] ?? {
        rec: `${nodeLabel(w)} — scorer preferred`,
        alt: `${nodeLabel(r)} — lower weighted score`,
      };
      out.push({
        floor: w.floor,
        decision: `${nodeLabel(w)} vs ${nodeLabel(r)} at f${w.floor}`,
        recommended: rationale.rec,
        alternatives: [{ option: nodeLabel(r), tradeoff: rationale.alt }],
        close_call: options.confidence < 0.75,
      });
    }
    previousDivergence = diverges;
  }

  return out;
}
