import type { MapState, MapNode, MapNextOption } from "@sts2/shared/types/game-state";
import type { MapContext } from "../features/run/runSlice";

export function buildMapContext(mapState: MapState): MapContext {
  const currentRow = mapState.map.current_position?.row ?? 0;
  const bossRow = mapState.map.boss.row;
  const nextNodeTypes = mapState.map.next_options.map((o) => o.type);
  const leadsToTypes = mapState.map.next_options.flatMap(
    (o) => o.leads_to?.map((lt) => lt.type) ?? [],
  );

  // Trace reachable nodes from current position's next options
  // to find rest/shop ahead on the actual path (not other branches)
  const nodeMap = new Map(
    mapState.map.nodes.map((n) => [`${n.col},${n.row}`, n]),
  );
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
    hasEliteAhead: nextNodeTypes.includes("Elite") || leadsToTypes.includes("Elite"),
    hasBossAhead: nextNodeTypes.includes("Boss") || leadsToTypes.includes("Boss"),
    hasRestAhead: reachableTypes.has("RestSite"),
    hasShopAhead: reachableTypes.has("Shop"),
  };
}
