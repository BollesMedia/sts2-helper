import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { CombatCard } from "@sts2/shared/types/game-state";

export type RunIdSource = "save_file" | "client_fallback" | null;

// --- Run-scoped types ---

export interface TrackedPlayer {
  character: string;
  hp: number;
  maxHp: number;
  gold: number;
  maxEnergy: number;
  relics: { id: string; name: string; description: string }[];
  potions: { name: string; description: string }[];
  potionSlotCap: number | null;
  cardRemovalCost: number | null;
}

export interface MapEvalState {
  recommendedPath: { col: number; row: number }[];
  recommendedNodes: string[]; // serializable — all options' paths (UI highlighting)
  bestPathNodes: string[]; // serializable — best option's path only (deviation detection)
  lastEvalContext: {
    hpPercent: number;
    deckSize: number;
    act: number;
    gold: number;
    ascension: number;
  } | null;
  nodePreferences: {
    monster: number;
    elite: number;
    shop: number;
    rest: number;
    treasure: number;
    event: number;
  } | null;
}

export interface MapContext {
  floorsToNextBoss: number;
  nextNodeTypes: string[];
  hasEliteAhead: boolean;
  hasBossAhead: boolean;
  hasRestAhead: boolean;
  hasShopAhead: boolean;
}

export interface RunData {
  character: string;
  ascension: number;
  act: number;
  floor: number;
  gameMode: "singleplayer" | "multiplayer";
  deck: CombatCard[];
  player: TrackedPlayer | null;
  mapEval: MapEvalState;
  mapContext: MapContext | null;
  runIdSource: RunIdSource;
}

interface CompletedRun {
  runId: string;
  victory: boolean | null;
  finalFloor: number;
  character: string;
}

interface RunState {
  activeRunId: string | null;
  runs: Record<string, RunData>;
  pendingOutcome: {
    runId: string;
    inferred: boolean | null;
    finalFloor: number;
  } | null;
  /** Last completed run — shown on menu for optional notes. Display-only. */
  lastCompletedRun: CompletedRun | null;
}

const initialState: RunState = {
  activeRunId: null,
  runs: {},
  pendingOutcome: null,
  lastCompletedRun: null,
};

export const runSlice = createSlice({
  name: "run",
  initialState,
  reducers: {
    runStarted(
      state,
      action: PayloadAction<{
        runId: string;
        character: string;
        ascension: number;
        gameMode: "singleplayer" | "multiplayer";
        runIdSource: RunIdSource;
      }>
    ) {
      const { runId, character, ascension, gameMode, runIdSource } = action.payload;
      state.activeRunId = runId;
      state.pendingOutcome = null;
      state.lastCompletedRun = null;
      state.runs[runId] = {
        character,
        ascension,
        act: 1,
        floor: 1,
        gameMode,
        deck: [],
        player: null,
        mapEval: {
          recommendedPath: [],
          recommendedNodes: [],
          bestPathNodes: [],
          lastEvalContext: null,
          nodePreferences: null,
        },
        mapContext: null,
        runIdSource,
      };
    },

    runEnded(
      state,
      action: PayloadAction<{ runId: string; inferred: boolean | null; finalFloor?: number }>
    ) {
      const run = state.runs[action.payload.runId];
      state.pendingOutcome = {
        runId: action.payload.runId,
        inferred: action.payload.inferred,
        finalFloor: action.payload.finalFloor ?? run?.floor ?? 0,
      };
      state.activeRunId = null;
    },

    outcomeConfirmed(
      state,
      action: PayloadAction<{ runId: string; victory: boolean }>
    ) {
      const floor = state.pendingOutcome?.finalFloor ?? state.runs[action.payload.runId]?.floor ?? 0;
      state.lastCompletedRun = {
        runId: action.payload.runId,
        victory: action.payload.victory,
        finalFloor: floor,
        character: state.runs[action.payload.runId]?.character ?? "Unknown",
      };
      state.pendingOutcome = null;
    },

    saveAndQuitDismissed(state) {
      if (state.pendingOutcome) {
        // Restore the run — player just saved & quit, run is still active
        state.activeRunId = state.pendingOutcome.runId;
        state.pendingOutcome = null;
      }
    },

    floorUpdated(
      state,
      action: PayloadAction<{ act: number; floor: number }>
    ) {
      const run = state.activeRunId ? state.runs[state.activeRunId] : null;
      if (run) {
        run.act = action.payload.act;
        run.floor = action.payload.floor;
      }
    },

    playerUpdated(state, action: PayloadAction<TrackedPlayer>) {
      const run = state.activeRunId ? state.runs[state.activeRunId] : null;
      if (run) {
        run.player = action.payload;
      }
    },

    deckUpdated(state, action: PayloadAction<CombatCard[]>) {
      const run = state.activeRunId ? state.runs[state.activeRunId] : null;
      if (run) {
        run.deck = action.payload;
      }
    },

    mapEvalUpdated(
      state,
      action: PayloadAction<Partial<MapEvalState>>
    ) {
      const run = state.activeRunId ? state.runs[state.activeRunId] : null;
      if (run) {
        Object.assign(run.mapEval, action.payload);
      }
    },

    mapContextUpdated(state, action: PayloadAction<MapContext>) {
      const run = state.activeRunId ? state.runs[state.activeRunId] : null;
      if (run) {
        run.mapContext = action.payload;
      }
    },
  },
  selectors: {
    selectActiveRunId: (state) => state.activeRunId,
    selectActiveRun: (state) =>
      state.activeRunId ? state.runs[state.activeRunId] ?? null : null,
    selectPendingOutcome: (state) => state.pendingOutcome,
    selectLastCompletedRun: (state) => state.lastCompletedRun,
  },
});

export const {
  runStarted,
  runEnded,
  outcomeConfirmed,
  saveAndQuitDismissed,
  floorUpdated,
  playerUpdated,
  deckUpdated,
  mapEvalUpdated,
  mapContextUpdated,
} = runSlice.actions;

export const {
  selectActiveRunId,
  selectActiveRun,
  selectPendingOutcome,
  selectLastCompletedRun,
} = runSlice.selectors;
