import type { ActPathNode, ActPathRecord, DeviationNode } from "./types";

export function buildActPathRecord(
  act: number,
  recommendedPath: ActPathNode[],
  actualPath: ActPathNode[]
): ActPathRecord {
  const deviationNodes: DeviationNode[] = [];
  const compareLength = Math.min(recommendedPath.length, actualPath.length);

  for (let i = 0; i < compareLength; i++) {
    const rec = recommendedPath[i];
    const act_node = actualPath[i];
    if (rec.col !== act_node.col || rec.row !== act_node.row) {
      deviationNodes.push({
        col: act_node.col,
        row: act_node.row,
        recommended: rec.nodeType,
        actual: act_node.nodeType,
      });
    }
  }

  return {
    act,
    recommendedPath,
    actualPath,
    deviationCount: deviationNodes.length,
    deviationNodes,
  };
}
