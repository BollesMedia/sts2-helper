import type { MapState, MapNode, MapNextOption } from "@sts2/shared/types/game-state";
import type { MapContext } from "../features/run/runSlice";

export function buildMapContext(mapState: MapState): MapContext {
  const currentRow = mapState.map.current_position?.row ?? 0;
  const bossRow = mapState.map.boss.row;
  const nextNodeTypes = mapState.map.next_options.map((o) => o.type);

  // Trace reachable nodes from current position's next options
  // to find rest/shop ahead on the actual path (not other branches)
  const nodeMap = new Map(
    mapState.map.nodes.map((n) => [`${n.col},${n.row}`, n]),
  );

  // 2-node lookahead using map topology (children), NOT leads_to.
  // leads_to can include ALL reachable nodes on larger maps, causing
  // false positives. children is always one-step adjacency.
  const childTypes = mapState.map.next_options.flatMap((opt) => {
    const node = nodeMap.get(`${opt.col},${opt.row}`);
    if (!node) return [];
    return node.children
      .map(([c, r]) => nodeMap.get(`${c},${r}`)?.type)
      .filter((t): t is string => t != null);
  });
  const reachableTypes = new Set<string>();
  const visited = new Set<string>();

  function traceReachable(col: number, row: number) {
    const key = `${col},${row}`;
    if (visited.has(key)) return;
    visited.add(key);
    const node = nodeMap.get(key);
    if (!node) return;
    reachableTypes.add(node.type);
    for (const [cc, cr] of node.children) {
      traceReachable(cc, cr);
    }
  }

  // Start from each next option and trace forward
  for (const opt of mapState.map.next_options) {
    traceReachable(opt.col, opt.row);
  }

  return {
    floorsToNextBoss: bossRow - currentRow,
    nextNodeTypes,
    hasEliteAhead: nextNodeTypes.includes("Elite") || childTypes.includes("Elite"),
    hasBossAhead: nextNodeTypes.includes("Boss") || childTypes.includes("Boss"),
    hasRestAhead: reachableTypes.has("RestSite"),
    hasShopAhead: reachableTypes.has("Shop"),
  };
}
