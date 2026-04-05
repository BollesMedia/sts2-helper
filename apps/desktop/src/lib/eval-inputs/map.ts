import type { MapState, MapNode, MapNextOption } from "@sts2/shared/types/game-state";
import type { EvaluationContext } from "@sts2/shared/evaluation/types";
import type { TierLetter } from "@sts2/shared/evaluation/tier-utils";
import { buildCompactContext } from "@sts2/shared/evaluation/prompt-builder";
import { NODE_TYPE_ICONS } from "../../views/map/map-scoring";

export interface NodePreferences {
  monster: number;
  elite: number;
  shop: number;
  rest: number;
  treasure: number;
  event: number;
}

export interface MapPathEvaluation {
  rankings: {
    optionIndex: number;
    nodeType: string;
    tier: TierLetter;
    confidence: number;
    recommendation: string;
    reasoning: string;
  }[];
  overallAdvice: string | null;
  recommendedPath: { col: number; row: number }[];
  nodePreferences: NodePreferences | null;
}

/**
 * Compute dedup key from map next options.
 */
export function computeMapEvalKey(options: MapNextOption[]): string {
  return options.map((o) => `${o.col},${o.row}`).sort().join("|");
}

export { computeMapContentKey } from "@sts2/shared/evaluation/map-content-key";

/**
 * Build the map evaluation prompt with tree visualization.
 */
export function buildMapPrompt(params: {
  context: EvaluationContext;
  state: MapState;
  cardRemovalCost: number | null;
}): string {
  const { context, state, cardRemovalCost } = params;
  const contextStr = buildCompactContext(context);
  const options = state.map.next_options;
  const allNodes = state.map.nodes;
  const currentRow = state.map.current_position?.row ?? 0;
  const mapPlayer = state.player ?? state.map?.player;

  // Build node lookup
  const nodeMap = new Map<string, MapNode>();
  for (const n of allNodes) {
    nodeMap.set(`${n.col},${n.row}`, n);
  }

  function buildTree(col: number, row: number, depth: number, maxDepth: number, indent: string): string[] {
    const node = nodeMap.get(`${col},${row}`);
    if (!node) return [];
    const icon = NODE_TYPE_ICONS[node.type] ?? "•";
    const lines: string[] = [`${indent}${icon} ${node.type}`];
    if (depth >= maxDepth || node.children.length === 0) return lines;
    const childNodes = node.children.map(([cc, cr]) => nodeMap.get(`${cc},${cr}`)).filter(Boolean);
    if (childNodes.length === 1) {
      lines.push(...buildTree(childNodes[0]!.col, childNodes[0]!.row, depth + 1, maxDepth, indent));
    } else {
      for (const child of childNodes) {
        if (!child) continue;
        lines.push(`${indent}  ├─`);
        lines.push(...buildTree(child.col, child.row, depth + 1, maxDepth, indent + "  │ "));
      }
    }
    return lines;
  }

  const optionsStr = options.map((opt, i) => {
    const tree = buildTree(opt.col, opt.row, 0, 6, "   ");
    return `Option ${i + 1}:\n${tree.join("\n")}`;
  }).join("\n\n");

  const futureNodes = allNodes.filter((n) => n.row > currentRow);
  const typeCounts: Record<string, number> = {};
  for (const n of futureNodes) {
    typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
  }
  const mapOverview = Object.entries(typeCounts).map(([t, c]) => `${t}: ${c}`).join(", ");

  return `${contextStr}

HP: ${mapPlayer?.hp ?? 0}/${mapPlayer?.max_hp ?? 0} (${Math.round(((mapPlayer?.hp ?? 0) / Math.max(1, mapPlayer?.max_hp ?? 1)) * 100)}%) | Gold: ${mapPlayer?.gold ?? 0}g | Removal cost: ${cardRemovalCost ?? "?"}g
Map: ${mapOverview} | Boss in ${state.map.boss.row - currentRow} floors

Paths (each line = node in order, ├─ = branch point):
${optionsStr}

Return EXACTLY ${options.length} rankings — ONE per path option (${options.map((o, i) => `${i + 1}=${o.type}`).join(", ")}). Evaluate the WHOLE path, not individual nodes.`;
}
