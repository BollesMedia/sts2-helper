import type { ActPathNode } from "./types";

const paths = new Map<number, ActPathNode[]>();

export function appendNode(act: number, node: ActPathNode): void {
  if (!paths.has(act)) {
    paths.set(act, []);
  }
  const actPath = paths.get(act)!;

  const last = actPath[actPath.length - 1];
  if (last && last.col === node.col && last.row === node.row) {
    return;
  }

  actPath.push(node);
}

export function getActPath(act: number): ActPathNode[] {
  return paths.get(act) ?? [];
}

export function clearAllActPaths(): void {
  paths.clear();
}
