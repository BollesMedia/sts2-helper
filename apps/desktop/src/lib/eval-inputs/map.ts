import type { MapState, MapNode, MapNextOption } from "@sts2/shared/types/game-state";
import type { EvaluationContext } from "@sts2/shared/evaluation/types";
import type { TierLetter } from "@sts2/shared/evaluation/tier-utils";
import type { MapNodeType } from "@sts2/shared/evaluation/map-coach-schema";
import {
  buildCompactContext,
  MAP_PATHING_SCAFFOLD,
} from "@sts2/shared/evaluation/prompt-builder";
import {
  computeRunState,
  type RunStateInputs,
} from "@sts2/shared/evaluation/map/run-state";
import {
  enrichPaths,
  type CandidatePath,
} from "@sts2/shared/evaluation/map/enrich-paths";
import { formatFactsBlock } from "@sts2/shared/evaluation/map/format-facts-block";

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

export interface MapCoachEvaluation {
  reasoning: { riskCapacity: string; actGoal: string };
  headline: string;
  confidence: number;
  macroPath: {
    floors: { floor: number; nodeType: MapNodeType; nodeId: string }[];
    summary: string;
  };
  keyBranches: {
    floor: number;
    decision: string;
    recommended: string;
    alternatives: { option: string; tradeoff: string }[];
    closeCall: boolean;
  }[];
  teachingCallouts: { pattern: string; floors: number[]; explanation: string }[];
}

/**
 * Compute dedup key from map next options.
 */
export function computeMapEvalKey(options: MapNextOption[]): string {
  return options.map((o) => `${o.col},${o.row}`).sort().join("|");
}

export { computeMapContentKey } from "@sts2/shared/evaluation/map-content-key";

function mapNodeTypeToToken(type: string): CandidatePath["nodes"][number]["type"] {
  switch (type) {
    case "Monster":
      return "monster";
    case "Elite":
      return "elite";
    case "Rest":
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

function walkPathNodes(
  start: MapNode,
  all: MapNode[],
  maxDepth = 20,
): CandidatePath["nodes"] {
  const byKey = new Map(all.map((n) => [`${n.col},${n.row}`, n]));
  const out: CandidatePath["nodes"] = [];
  let cur: MapNode | undefined = start;
  for (let d = 0; d < maxDepth && cur; d++) {
    out.push({ floor: cur.row, type: mapNodeTypeToToken(cur.type) });
    if (cur.children.length === 0) break;
    cur = byKey.get(`${cur.children[0][0]},${cur.children[0][1]}`);
  }
  return out;
}

/**
 * Build the map evaluation prompt — run-state facts block + reasoning scaffold.
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

  const futureNodes = allNodes.filter((n) => n.row > currentRow);

  const act = (Math.min(3, Math.max(1, context.act || 1)) as 1 | 2 | 3);

  const runStateInputs: RunStateInputs = {
    player: {
      hp: mapPlayer?.hp ?? 0,
      max_hp: mapPlayer?.max_hp ?? 0,
      gold: mapPlayer?.gold ?? 0,
    },
    act,
    floor: currentRow,
    ascension: context.ascension ?? 0,
    deck: {
      cards: context.deckCards.map((c) => {
        const upgraded = /\+$/.test(c.name);
        const baseName = c.name.replace(/\+$/, "");
        const id = baseName.toLowerCase();
        return { id, name: baseName, upgraded };
      }),
    },
    relics: context.relics.map((r) => ({
      id: r.name.toLowerCase().replace(/\s+/g, "_"),
      name: r.name,
    })),
    map: {
      boss: { row: state.map.boss.row },
      current_position: state.map.current_position ?? null,
      visited: state.map.visited.map((v) => ({
        col: v.col,
        row: v.row,
        type: allNodes.find((n) => n.col === v.col && n.row === v.row)?.type ?? "Unknown",
      })),
      future: futureNodes.map((n) => ({ col: n.col, row: n.row, type: n.type })),
    },
    shopFloorsAhead: futureNodes.filter((n) => n.type === "Shop").map((n) => n.row),
    cardRemovalCost,
  };

  const runState = computeRunState(runStateInputs);

  // One candidate path per next_option, walking the primary-child branch.
  const byKey = new Map(allNodes.map((n) => [`${n.col},${n.row}`, n]));
  const candidates: CandidatePath[] = options.map((opt, i) => {
    const start = byKey.get(`${opt.col},${opt.row}`);
    return {
      id: String(i + 1),
      nodes: start ? walkPathNodes(start, allNodes) : [],
    };
  });

  const treasureFloorByPath: Record<string, number> = {};
  for (const p of candidates) {
    const t = p.nodes.find((n) => n.type === "treasure");
    if (t) treasureFloorByPath[p.id] = t.floor;
  }

  const enriched = enrichPaths(candidates, runState, treasureFloorByPath);
  const factsBlock = formatFactsBlock(runState, enriched);

  return `${contextStr}

${factsBlock}

${MAP_PATHING_SCAFFOLD}`;
}
