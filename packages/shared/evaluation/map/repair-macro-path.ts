import type { MapCoachOutputRaw } from "../map-coach-schema";
import type { RepairReason, RepairResult } from "./compliance-report";

/**
 * Structural auto-repair for the map coach's macro_path. Runs seven validators
 * in order; any that fires contributes a typed RepairReason and triggers
 * best-effort re-stitching using a smart child walk that biases toward stated
 * next floors on branching forks. Pure function — no IO.
 *
 * Callers project their game-state nodes into RepairMapNode (col/row/type +
 * [col,row] children) rather than importing game-state types directly.
 */

export interface RepairMapNode {
  col: number;
  row: number;
  type: string;
  children: [col: number, row: number][];
}

export interface RepairNextOption {
  col: number;
  row: number;
  type: string;
}

export interface RepairInputs {
  output: MapCoachOutputRaw;
  nodes: RepairMapNode[];
  nextOptions: RepairNextOption[];
  boss: { col: number; row: number };
  currentPosition: { col: number; row: number } | null;
}

function nodeKey(col: number, row: number): string {
  return `${col},${row}`;
}

function buildNodeMap(nodes: RepairMapNode[]): Map<string, RepairMapNode> {
  const map = new Map<string, RepairMapNode>();
  for (const n of nodes) map.set(nodeKey(n.col, n.row), n);
  return map;
}

/**
 * Precompute reachable node set per node (BFS over children). Used by
 * smartWalk to steer forks toward a target node id.
 */
function buildReachable(nodes: RepairMapNode[]): Map<string, Set<string>> {
  const nodeMap = buildNodeMap(nodes);
  const reachable = new Map<string, Set<string>>();
  function visit(nodeId: string): Set<string> {
    const cached = reachable.get(nodeId);
    if (cached) return cached;
    const acc = new Set<string>([nodeId]);
    reachable.set(nodeId, acc);
    const node = nodeMap.get(nodeId);
    if (node) {
      for (const [cc, cr] of node.children) {
        const childKey = nodeKey(cc, cr);
        for (const r of visit(childKey)) acc.add(r);
      }
    }
    return acc;
  }
  for (const n of nodes) visit(nodeKey(n.col, n.row));
  return reachable;
}

function nodeTypeToken(type: string): string {
  switch (type) {
    case "Monster":
      return "monster";
    case "Elite":
      return "elite";
    case "RestSite":
      return "rest";
    case "Shop":
      return "shop";
    case "Treasure":
      return "treasure";
    case "Event":
      return "event";
    case "Boss":
      return "boss";
    default:
      return "unknown";
  }
}

function floorsContiguous(
  floors: MapCoachOutputRaw["macro_path"]["floors"],
  nodeMap: Map<string, RepairMapNode>,
): boolean {
  for (let i = 0; i < floors.length - 1; i++) {
    const cur = nodeMap.get(floors[i].node_id);
    if (!cur) return false;
    const next = floors[i + 1];
    const childMatch = cur.children.some(
      ([cc, cr]) => nodeKey(cc, cr) === next.node_id,
    );
    if (!childMatch) return false;
  }
  return true;
}

/**
 * Walk from startKey toward bossKey, steering children toward a target when
 * provided. Returns the visited chain including startKey. Stops early (deadEnd)
 * on a leaf that isn't the boss or on a cycle.
 */
function smartWalk(
  startKey: string,
  bossKey: string,
  nodeMap: Map<string, RepairMapNode>,
  reachable: Map<string, Set<string>>,
  steerToKey?: string,
): { visited: RepairMapNode[]; deadEnd: boolean } {
  const visited: RepairMapNode[] = [];
  let cursorKey: string | undefined = startKey;
  const guard = new Set<string>();
  while (cursorKey && !guard.has(cursorKey)) {
    guard.add(cursorKey);
    const node = nodeMap.get(cursorKey);
    if (!node) return { visited, deadEnd: true };
    visited.push(node);
    if (cursorKey === bossKey) return { visited, deadEnd: false };
    if (node.children.length === 0) return { visited, deadEnd: true };

    let nextKey: string | undefined;
    if (steerToKey) {
      for (const [cc, cr] of node.children) {
        const childKey = nodeKey(cc, cr);
        if (reachable.get(childKey)?.has(steerToKey)) {
          nextKey = childKey;
          break;
        }
      }
    }
    if (!nextKey) {
      const [cc, cr] = node.children[0];
      nextKey = nodeKey(cc, cr);
    }
    cursorKey = nextKey;
  }
  return { visited, deadEnd: true };
}

function visitedToFloors(
  visited: RepairMapNode[],
): MapCoachOutputRaw["macro_path"]["floors"] {
  return visited.map((n) => ({
    floor: n.row,
    node_type: nodeTypeToken(n.type) as MapCoachOutputRaw["macro_path"]["floors"][number]["node_type"],
    node_id: nodeKey(n.col, n.row),
  }));
}

function synthesizeFromNextOption(
  inputs: RepairInputs,
  reasons: RepairReason[],
): MapCoachOutputRaw["macro_path"]["floors"] {
  const bossKey = nodeKey(inputs.boss.col, inputs.boss.row);
  const nodeMap = buildNodeMap(inputs.nodes);
  const reachable = buildReachable(inputs.nodes);

  const chosen = inputs.nextOptions[0];
  if (!chosen) return [];
  const startKey = nodeKey(chosen.col, chosen.row);

  const { visited, deadEnd } = smartWalk(startKey, bossKey, nodeMap, reachable);
  if (deadEnd && visited[visited.length - 1]?.type !== "Boss") {
    reasons.push({ kind: "walk_dead_end" });
  }
  return visitedToFloors(visited);
}

export function repairMacroPath(inputs: RepairInputs): RepairResult {
  const { output, nodes, boss, currentPosition, nextOptions } = inputs;
  const nodeMap = buildNodeMap(nodes);
  const reachable = buildReachable(nodes);
  const floors = output.macro_path.floors;
  const bossKey = nodeKey(boss.col, boss.row);
  const reasons: RepairReason[] = [];

  // Case 1: empty macro_path.
  if (floors.length === 0) {
    reasons.push({ kind: "empty_macro_path" });
    const repairedFloors = synthesizeFromNextOption(inputs, reasons);
    return {
      output: {
        ...output,
        macro_path: { ...output.macro_path, floors: repairedFloors },
      },
      repaired: true,
      repair_reasons: reasons,
    };
  }

  // Case 2: first floor equals current_position — drop it.
  let working = floors;
  if (
    currentPosition &&
    working[0].node_id === nodeKey(currentPosition.col, currentPosition.row)
  ) {
    reasons.push({ kind: "starts_at_current_position" });
    working = working.slice(1);
    if (working.length === 0) {
      const repairedFloors = synthesizeFromNextOption(inputs, reasons);
      return {
        output: {
          ...output,
          macro_path: { ...output.macro_path, floors: repairedFloors },
        },
        repaired: true,
        repair_reasons: reasons,
      };
    }
  }

  // Case 3: drop unknown node_ids, recording each.
  const knownFloors: typeof working = [];
  for (const f of working) {
    if (nodeMap.has(f.node_id)) {
      knownFloors.push(f);
    } else {
      reasons.push({ kind: "unknown_node_id", detail: f.node_id });
    }
  }
  working = knownFloors;
  if (working.length === 0) {
    const repairedFloors = synthesizeFromNextOption(inputs, reasons);
    return {
      output: {
        ...output,
        macro_path: { ...output.macro_path, floors: repairedFloors },
      },
      repaired: reasons.length > 0 || repairedFloors.length !== floors.length,
      repair_reasons: reasons,
    };
  }

  // Case 4: first floor must match a next_option.
  const firstOnNextOption = nextOptions.some(
    (o) => nodeKey(o.col, o.row) === working[0].node_id,
  );
  if (!firstOnNextOption) {
    reasons.push({ kind: "first_floor_mismatch", detail: working[0].node_id });
    const matchIdx = working.findIndex((f) =>
      nextOptions.some((o) => nodeKey(o.col, o.row) === f.node_id),
    );
    if (matchIdx > 0) {
      working = working.slice(matchIdx);
    } else {
      const repairedFloors = synthesizeFromNextOption(inputs, reasons);
      return {
        output: {
          ...output,
          macro_path: { ...output.macro_path, floors: repairedFloors },
        },
        repaired: true,
        repair_reasons: reasons,
      };
    }
  }

  // Case 5: contiguity. Walk `working`; on first break, stitch via smart walk.
  const stitched: RepairMapNode[] = [];
  for (let i = 0; i < working.length; i++) {
    const curNode = nodeMap.get(working[i].node_id);
    if (!curNode) break;
    if (stitched.length === 0) {
      stitched.push(curNode);
      continue;
    }
    const prev = stitched[stitched.length - 1];
    const isChild = prev.children.some(
      ([cc, cr]) => nodeKey(cc, cr) === working[i].node_id,
    );
    if (isChild) {
      stitched.push(curNode);
    } else {
      reasons.push({
        kind: "contiguity_gap",
        detail: `before_${working[i].node_id}`,
      });
      const walk = smartWalk(
        nodeKey(prev.col, prev.row),
        bossKey,
        nodeMap,
        reachable,
        working[i].node_id,
      );
      for (const step of walk.visited.slice(1)) {
        stitched.push(step);
        if (nodeKey(step.col, step.row) === working[i].node_id) break;
      }
      const landed = stitched[stitched.length - 1];
      if (nodeKey(landed.col, landed.row) !== working[i].node_id) {
        break;
      }
    }
  }

  // Case 6: ensure final floor is boss.
  const last = stitched[stitched.length - 1];
  if (!last || nodeKey(last.col, last.row) !== bossKey) {
    reasons.push({ kind: "missing_boss" });
    if (last) {
      const walk = smartWalk(
        nodeKey(last.col, last.row),
        bossKey,
        nodeMap,
        reachable,
      );
      if (
        walk.deadEnd &&
        walk.visited[walk.visited.length - 1]?.type !== "Boss"
      ) {
        reasons.push({ kind: "walk_dead_end" });
      }
      for (const step of walk.visited.slice(1)) stitched.push(step);
    }
  }

  if (reasons.length === 0) {
    return { output, repaired: false, repair_reasons: [] };
  }

  return {
    output: {
      ...output,
      macro_path: {
        ...output.macro_path,
        floors: visitedToFloors(stitched),
      },
    },
    repaired: true,
    repair_reasons: reasons,
  };
}
