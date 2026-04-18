import type { MapState, MapNode, MapNextOption, MultiplayerFields } from "@sts2/shared/types/game-state";
import type { MapCoachEvaluation } from "../../lib/eval-inputs/map";
import type { MapEvalState, RunData } from "../../features/run/runSlice";
import type { EvalEntry } from "../../features/evaluation/evaluationSlice";
import { createEmptyEvals } from "../test-utils";

/**
 * Small 4-row test map (same topology as constraint-aware-tracer tests):
 *
 *   Row 3: [1,3 Boss]
 *            ↑     ↑
 *   Row 2: [0,2 Rest] [2,2 Monster]
 *            ↑           ↑
 *   Row 1: [0,1 Elite]  [2,1 Shop]
 *            ↑           ↑
 *   Row 0: ------[1,0 Monster]------
 */
export const TEST_NODES: MapNode[] = [
  { col: 1, row: 0, type: "Monster", children: [[0, 1], [2, 1]] },
  { col: 0, row: 1, type: "Elite", children: [[0, 2]] },
  { col: 2, row: 1, type: "Shop", children: [[2, 2]] },
  { col: 0, row: 2, type: "RestSite", children: [[1, 3]] },
  { col: 2, row: 2, type: "Monster", children: [[1, 3]] },
  { col: 1, row: 3, type: "Boss", children: [] },
];

export const TEST_BOSS = { col: 1, row: 3 };

// --- Map State Factory ---

export function createMapState(
  overrides: Partial<MapState["map"]> & { player?: MapState["player"] } = {},
): MapState & MultiplayerFields {
  const { player, ...mapOverrides } = overrides;
  return {
    state_type: "map",
    player: player ?? {
      character: "The Ironclad",
      hp: 80,
      max_hp: 80,
      gold: 100,
    },
    map: {
      current_position: { col: 1, row: 0, type: "Monster" },
      visited: [{ col: 1, row: 0, type: "Monster" }],
      next_options: [
        { index: 0, col: 0, row: 1, type: "Elite", leads_to: [{ col: 0, row: 2, type: "RestSite" }] },
        { index: 1, col: 2, row: 1, type: "Shop", leads_to: [{ col: 2, row: 2, type: "Monster" }] },
      ],
      nodes: TEST_NODES,
      boss: TEST_BOSS,
      ...mapOverrides,
    },
    run: { act: 1, floor: 1, ascension: 0 },
  };
}

// --- Evaluation Factory ---

/** Create a MapCoachEvaluation matching the default map state (2 options at row 0) */
export function createMapEvaluation(
  overrides: Partial<MapCoachEvaluation> = {},
): MapCoachEvaluation {
  return {
    reasoning: {
      riskCapacity: "Healthy buffer, can push for elites.",
      actGoal: "Reach boss with 70%+ HP and one more relic.",
    },
    headline: "Take the elite path for the relic.",
    confidence: 0.85,
    macroPath: {
      floors: [
        { floor: 1, nodeType: "elite", nodeId: "0,1" },
        { floor: 2, nodeType: "rest", nodeId: "0,2" },
        { floor: 3, nodeType: "unknown", nodeId: "1,3" },
      ],
      summary: "Elite → Rest → Boss.",
    },
    keyBranches: [
      {
        floor: 1,
        decision: "Elite vs Shop",
        recommended: "Elite",
        alternatives: [{ option: "Shop", tradeoff: "No relic, costs gold" }],
        closeCall: false,
      },
    ],
    teachingCallouts: [],
    ...overrides,
  };
}

/**
 * Expose the recommendedPath fixture separately — it used to live on the
 * evaluation, but the new shape doesn't carry it. Tests that need the default
 * 4-node recommended path can spread this into `createPreloadedState`.
 */
export const DEFAULT_RECOMMENDED_PATH: { col: number; row: number }[] = [
  { col: 1, row: 0 },
  { col: 0, row: 1 },
  { col: 0, row: 2 },
  { col: 1, row: 3 },
];

// --- Redux Preloaded State Factory ---

const EMPTY_MAP_EVAL: MapEvalState = {
  recommendedPath: [],
  recommendedNodes: [],
  bestPathNodes: [],
  lastEvalContext: null,
  nodePreferences: null,
};

export function createPreloadedState(overrides: {
  mapEval?: Partial<MapEvalState>;
  mapEvalEntry?: Partial<EvalEntry>;
  runOverrides?: Partial<RunData>;
} = {}) {
  const mapEval: MapEvalState = { ...EMPTY_MAP_EVAL, ...overrides.mapEval };

  return {
    run: {
      activeRunId: "test-run",
      runs: {
        "test-run": {
          character: "The Ironclad",
          ascension: 0,
          act: 1,
          floor: 1,
          gameMode: "singleplayer" as const,
          deck: [],
          player: null,
          mapEval,
          mapContext: null,
          ...overrides.runOverrides,
        },
      },
      pendingOutcome: null,
      lastCompletedRun: null,
    },
    evaluation: {
      evals: {
        ...createEmptyEvals(),
        map: {
          evalKey: "",
          result: null,
          isLoading: false,
          error: null,
          ...overrides.mapEvalEntry,
        },
      },
    },
  };
}
