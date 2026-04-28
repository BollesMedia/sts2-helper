import type { MapState, MapNode, MapNextOption } from "@sts2/shared/types/game-state";
import type { EvaluationContext } from "@sts2/shared/evaluation/types";
import type { MapNodeType } from "@sts2/shared/evaluation/map-coach-schema";
import { buildCompactContext } from "@sts2/shared/evaluation/prompt-builder";
import {
  computeRunState,
  type RunState,
  type RunStateInputs,
} from "@sts2/shared/evaluation/map/run-state";
import {
  enrichPaths,
  type CandidatePath,
  type EnrichedPath,
} from "@sts2/shared/evaluation/map/enrich-paths";
import { formatFactsBlock } from "@sts2/shared/evaluation/map/format-facts-block";

/**
 * Loose structural shapes for the scorer request payload. These used to live
 * in `repair-macro-path.ts` alongside the LLM-drift repair pipeline; post
 * phase 4 the scorer only consumes `enrichedPaths` + `runState` +
 * `cardRemovalCost`, so the types are kept here purely to shape the round-trip
 * to `/api/evaluate` for future server-side sanity checks.
 */
interface ComplianceMapNode {
  col: number;
  row: number;
  type: string;
  children: [col: number, row: number][];
}

interface ComplianceNextOption {
  col: number;
  row: number;
  type: string;
}

/**
 * Inputs for the server-side scorer + narrator pipeline, projected from
 * desktop map state. The scorer only consumes `enrichedPaths` + `runState` +
 * `cardRemovalCost`; the remaining fields are carried for completeness (e.g.
 * future server-side sanity checks).
 */
export interface MapComplianceInputs {
  nodes: ComplianceMapNode[];
  nextOptions: ComplianceNextOption[];
  boss: { col: number; row: number };
  currentPosition: { col: number; row: number } | null;
  enrichedPaths: EnrichedPath[];
  runState: RunState;
  cardRemovalCost: number;
}

export interface NodePreferences {
  monster: number;
  elite: number;
  shop: number;
  rest: number;
  treasure: number;
  event: number;
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
  compliance?: {
    repaired: boolean;
    reranked: boolean;
    rerankReason: string | null;
    repairReasons: { kind: string; detail?: string }[];
    /** Phase-5 telemetry — full scorer ranking for calibration / debugging. */
    scoredPaths?: {
      id: string;
      score: number;
      scoreBreakdown: Record<string, number>;
      disqualified: boolean;
      disqualifyReasons: string[];
    }[];
  };
}

/**
 * Compute dedup key from map next options.
 */
export function computeMapEvalKey(options: MapNextOption[]): string {
  return options.map((o) => `${o.col},${o.row}`).sort().join("|");
}

export { computeMapContentKey } from "@sts2/shared/evaluation/map-content-key";

/**
 * Map a raw STS2 node `type` string to the lowercase token the scorer +
 * map-coach schema use (see `nodeTypeEnum` in
 * `packages/shared/evaluation/map-coach-schema.ts`).
 *
 * The `default` branch silently falls through to `"unknown"` rather than
 * throwing. This logic originated in the now-deleted `repair-macro-path.ts`
 * LLM-drift repair pipeline (referenced in the file header above) and the
 * silent fallback is intentional:
 *
 *   - Game-data drift: STS2 may introduce new node `type` strings (or rename
 *     existing ones, e.g. `Rest` ↔ `RestSite`) before this mapping is updated.
 *     A throw here would break the entire scorer pipeline for any user on a
 *     newer build; the `"unknown"` token lets path enumeration continue and
 *     the scorer treats unmapped nodes as event-equivalent (bucketed with
 *     `event` in `score-paths.ts:countUnknowns` and rendered as "Event" in
 *     `derive-branches.ts:nodeLabel`) — they're counted toward path-risk
 *     but not filtered out.
 *   - Repair-time tolerance: when this fed `repair-macro-path.ts`, the repair
 *     pass needed to accept partially-known maps without aborting — the
 *     `"unknown"` value is a recognised schema member (see `nodeTypeEnum`)
 *     specifically so it round-trips cleanly through validation.
 *
 * If you need visibility into unmapped types, add an entry to
 * `REPAIR_REASON_KINDS` in `packages/shared/evaluation/map/compliance-report.ts`
 * and surface it via the compliance block rather than throwing here.
 */
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

/**
 * DFS-enumerate every path from `start` to a leaf (boss or max-depth). STS2
 * maps are bounded DAGs — from floor 1 the tree is ~30–80 unique paths, but
 * from the bottom of Act 3 with ~17 floors remaining it can swell to
 * 500–1500. `maxPaths` is a ceiling against pathological graphs; hitting it
 * means the tail of the DFS is truncated (leftmost-biased), which can
 * starve elite-rich paths on the right of the map. We log on cap-hit so
 * the dev event stream shows when the candidate pool was incomplete.
 */
function enumerateAllPaths(
  start: MapNode,
  all: MapNode[],
  maxDepth = 20,
  maxPaths = 2000,
): CandidatePath["nodes"][] {
  const byKey = new Map(all.map((n) => [`${n.col},${n.row}`, n]));
  const results: CandidatePath["nodes"][] = [];

  function walk(node: MapNode, path: CandidatePath["nodes"]): boolean {
    const next = [
      ...path,
      {
        floor: node.row,
        type: mapNodeTypeToToken(node.type),
        nodeId: `${node.col},${node.row}`,
      },
    ];
    if (results.length >= maxPaths) return false;
    if (node.children.length === 0 || next.length >= maxDepth) {
      results.push(next);
      return true;
    }
    for (const [c, r] of node.children) {
      const child = byKey.get(`${c},${r}`);
      if (child && !walk(child, next)) return false;
    }
    return true;
  }

  walk(start, []);
  return results;
}

/**
 * Build the map evaluation prompt — run-state facts block + reasoning scaffold.
 *
 * Returns both the prompt string and the computed `RunState` so the caller can
 * forward the snapshot to `/api/evaluate` (for echo into the response) and
 * ultimately to `/api/choice` for persistence in `choices.run_state_snapshot`.
 */
export function buildMapPrompt(params: {
  context: EvaluationContext;
  state: MapState;
  cardRemovalCost: number | null;
}): {
  prompt: string;
  runState: RunState;
  compliance: MapComplianceInputs;
} {
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

  // Enumerate every valid path from each next_option to a boss/leaf. The
  // scorer ranks them all — the winner is the strongest *specific* plan,
  // not just the best leftmost-child walk.
  const byKey = new Map(allNodes.map((n) => [`${n.col},${n.row}`, n]));
  const candidates: CandidatePath[] = [];
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const start = byKey.get(`${opt.col},${opt.row}`);
    if (!start) continue;
    const paths = enumerateAllPaths(start, allNodes);
    for (let j = 0; j < paths.length; j++) {
      candidates.push({
        id: `${i + 1}_${j + 1}`,
        nodes: paths[j],
      });
    }
  }

  const treasureFloorByPath: Record<string, number> = {};
  for (const p of candidates) {
    const t = p.nodes.find((n) => n.type === "treasure");
    if (t) treasureFloorByPath[p.id] = t.floor;
  }

  const enriched = enrichPaths(candidates, runState, treasureFloorByPath);
  const factsBlock = formatFactsBlock(runState, enriched);

  const prompt = `${contextStr}

${factsBlock}`;

  const compliance: MapComplianceInputs = {
    nodes: allNodes.map((n) => ({
      col: n.col,
      row: n.row,
      type: n.type,
      children: n.children,
    })),
    nextOptions: options.map((o) => ({
      col: o.col,
      row: o.row,
      type: o.type,
    })),
    boss: { col: state.map.boss.col, row: state.map.boss.row },
    currentPosition: state.map.current_position
      ? {
          col: state.map.current_position.col,
          row: state.map.current_position.row,
        }
      : null,
    enrichedPaths: enriched,
    runState,
    cardRemovalCost: cardRemovalCost ?? 75,
  };

  return { prompt, runState, compliance };
}
