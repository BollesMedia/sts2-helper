export interface FingerprintNode {
  col: number;
  row: number;
  type: string;
  children: { col: number; row: number }[];
}

/**
 * Deterministic fingerprint of the subgraph reachable from `start`,
 * bounded by `maxRow` inclusive. Two subgraphs with the same
 * floor-by-floor type histogram produce the same fingerprint — useful
 * for skipping no-op forks (two same-type options whose downstreams are
 * structurally identical).
 */
export function computeSubgraphFingerprint(
  nodes: FingerprintNode[],
  start: { col: number; row: number },
  maxRow: number,
): string {
  const byCoord = new Map<string, FingerprintNode>();
  for (const n of nodes) byCoord.set(`${n.col},${n.row}`, n);

  const histogram = new Map<number, Map<string, number>>();
  const visited = new Set<string>();
  const queue: { col: number; row: number }[] = [start];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const key = `${cur.col},${cur.row}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const node = byCoord.get(key);
    if (!node) continue;
    if (node.row > maxRow) continue;

    const rowHist = histogram.get(node.row) ?? new Map<string, number>();
    rowHist.set(node.type, (rowHist.get(node.type) ?? 0) + 1);
    histogram.set(node.row, rowHist);

    for (const child of node.children) queue.push(child);
  }

  const rows = Array.from(histogram.keys()).sort((a, b) => a - b);
  const parts = rows.map((r) => {
    const types = histogram.get(r)!;
    const sorted = Array.from(types.entries()).sort(([a], [b]) => a.localeCompare(b));
    return `${r}:${sorted.map(([t, c]) => `${t}${c}`).join(",")}`;
  });
  return parts.join("|");
}
