/**
 * Pure pattern detectors on a linear candidate path.
 * Each detector returns a single PathPattern or null.
 *
 * Path shape: node types in visit order from the candidate's root to the
 * act boss, each tagged with the floor (row) it occupies.
 */

export type NodeType = "monster" | "elite" | "rest" | "shop" | "treasure" | "event" | "unknown" | "boss";

export interface PathNode {
  floor: number;
  type: NodeType;
  /**
   * Canonical `"col,row"` identifier for the node, when available. Emitted
   * into the facts block so the LLM can copy it verbatim into
   * `macro_path.floors[].node_id`. Optional because detectors only need
   * `floor` + `type`, and some call sites (tests, older fixtures) predate it.
   */
  nodeId?: string;
}

export type PathPattern =
  | { kind: "rest_before_elite"; restFloor: number; eliteFloor: number }
  | { kind: "rest_after_elite"; eliteFloor: number; restFloor: number }
  | { kind: "elite_cluster"; floors: number[] }
  | { kind: "back_to_back_shops"; floors: number[] }
  | { kind: "treasure_before_rest"; treasureFloor: number; restFloor: number }
  | { kind: "monster_chain_for_rewards"; floors: number[]; length: 3 | 4 }
  | { kind: "no_rest_in_late_half"; elitesLate: number }
  | { kind: "heal_vs_smith_at_preboss"; recommendation: "heal" | "smith" | "close_call" }
  | { kind: "rest_spent_too_early"; restFloor: number; hpRatioAtRest: number };

// Note: `rest_before_elite` covers the "smith coordination" case topologically;
// the spec's earlier `smith_before_elite` pattern was dropped during planning
// because it reduced to the same detection as `rest_before_elite`. The
// heal-vs-smith distinction is carried by the pre-boss `heal_vs_smith_at_preboss`
// pattern, which pulls its recommendation from RunState.

export function detectRestBeforeElite(path: PathNode[]): PathPattern | null {
  for (let i = 0; i < path.length - 1; i++) {
    if (path[i].type === "rest" && path[i + 1].type === "elite") {
      return { kind: "rest_before_elite", restFloor: path[i].floor, eliteFloor: path[i + 1].floor };
    }
  }
  return null;
}

export function detectRestAfterElite(path: PathNode[]): PathPattern | null {
  for (let i = 0; i < path.length - 1; i++) {
    if (path[i].type === "elite" && path[i + 1].type === "rest") {
      return { kind: "rest_after_elite", eliteFloor: path[i].floor, restFloor: path[i + 1].floor };
    }
  }
  return null;
}

export function detectEliteCluster(path: PathNode[]): PathPattern | null {
  const eliteFloors = path.filter((n) => n.type === "elite").map((n) => n.floor);
  if (eliteFloors.length < 2) return null;
  const clustered = new Set<number>();
  for (let i = 0; i < eliteFloors.length - 1; i++) {
    if (eliteFloors[i + 1] - eliteFloors[i] <= 3) {
      clustered.add(eliteFloors[i]);
      clustered.add(eliteFloors[i + 1]);
    }
  }
  if (clustered.size === 0) return null;
  return { kind: "elite_cluster", floors: [...clustered].sort((a, b) => a - b) };
}

export function detectBackToBackShops(path: PathNode[]): PathPattern | null {
  const floors: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    if (path[i].type === "shop" && path[i + 1].type === "shop") {
      floors.push(path[i].floor, path[i + 1].floor);
    }
  }
  return floors.length > 0 ? { kind: "back_to_back_shops", floors: [...new Set(floors)] } : null;
}

export function detectTreasureBeforeRest(path: PathNode[]): PathPattern | null {
  for (let i = 0; i < path.length - 1; i++) {
    if (path[i].type === "treasure" && path[i + 1].type === "rest") {
      return {
        kind: "treasure_before_rest",
        treasureFloor: path[i].floor,
        restFloor: path[i + 1].floor,
      };
    }
  }
  return null;
}

export function detectMonsterChain(path: PathNode[]): PathPattern | null {
  let run: number[] = [];
  let best: number[] = [];
  for (const n of path) {
    if (n.type === "monster") {
      run.push(n.floor);
      if (run.length > best.length) best = [...run];
    } else {
      run = [];
    }
  }
  if (best.length >= 3) {
    const length: 3 | 4 = best.length >= 4 ? 4 : 3;
    return {
      kind: "monster_chain_for_rewards",
      floors: best,
      length,
    };
  }
  return null;
}

/**
 * Detects elites in the late half (after the act's treasure node) that lack
 * a rest between them and the pre-boss rest. `treasureFloor` must be passed
 * (structural invariant: always present at halfway). If no late elites, null.
 *
 * `preBossRestFloor` bounds the mid-half-rest check — the terminal node is
 * typically `boss`, so using `path[path.length - 1].floor` would let the
 * pre-boss rest itself satisfy the "mid-half rest" condition.
 */
export function detectNoRestInLateHalf(
  path: PathNode[],
  treasureFloor: number,
  preBossRestFloor: number,
): PathPattern | null {
  const lateHalf = path.filter((n) => n.floor > treasureFloor);
  const lateElites = lateHalf.filter((n) => n.type === "elite");
  if (lateElites.length === 0) return null;
  const hasMidHalfRest = lateHalf.some(
    (n) =>
      n.type === "rest" &&
      n.floor > lateElites[0].floor &&
      n.floor < preBossRestFloor,
  );
  if (hasMidHalfRest) return null;
  return { kind: "no_rest_in_late_half", elitesLate: lateElites.length };
}

/**
 * Tags the guaranteed pre-boss rest with the heal/smith/close_call call.
 * `preBossRecommendation` is computed in run-state.
 */
export function detectHealVsSmithAtPreboss(
  preBossRecommendation: "heal" | "smith" | "close_call",
): PathPattern {
  return { kind: "heal_vs_smith_at_preboss", recommendation: preBossRecommendation };
}

/**
 * Flags a non-pre-boss rest taken at high HP — the player is "wasting" it
 * on heal when a smith would compound better.
 */
export function detectRestSpentTooEarly(
  path: PathNode[],
  currentHpRatio: number,
  preBossRestFloor: number,
): PathPattern | null {
  const nonPreBossRest = path.find((n) => n.type === "rest" && n.floor !== preBossRestFloor);
  if (!nonPreBossRest) return null;
  if (currentHpRatio < 0.8) return null;
  return {
    kind: "rest_spent_too_early",
    restFloor: nonPreBossRest.floor,
    hpRatioAtRest: currentHpRatio,
  };
}
