import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { CombatCard } from "@sts2/shared/types/game-state";

// --- Run-scoped types ---

export interface TrackedPlayer {
  character: string;
  hp: number;
  maxHp: number;
  gold: number;
  maxEnergy: number;
  relics: { id: string; name: string; description: string }[];
  potions: { name: string; description: string }[];
  cardRemovalCost: number | null;
}

export interface MapEvalState {
  recommendedPath: { col: number; row: number }[];
  recommendedNodes: string[]; // serializable — derive Set in selector
  lastEvalContext: {
    hpPercent: number;
    deckSize: number;
    act: number;
  } | null;
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
}

interface RunState {
  activeRunId: string | null;
  runs: Record<string, RunData>;
  pendingOutcome: {
    runId: string;
    inferred: boolean | null;
    finalFloor: number;
  } | null;
}

const initialState: RunState = {
  activeRunId: null,
  runs: {},
  pendingOutcome: null,
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
      }>
    ) {
      const { runId, character, ascension, gameMode } = action.payload;
      state.activeRunId = runId;
      state.pendingOutcome = null;
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
          lastEvalContext: null,
        },
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
  },
  selectors: {
    selectActiveRunId: (state) => state.activeRunId,
    selectActiveRun: (state) =>
      state.activeRunId ? state.runs[state.activeRunId] ?? null : null,
    selectPendingOutcome: (state) => state.pendingOutcome,
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
} = runSlice.actions;

export const {
  selectActiveRunId,
  selectActiveRun,
  selectPendingOutcome,
} = runSlice.selectors;
