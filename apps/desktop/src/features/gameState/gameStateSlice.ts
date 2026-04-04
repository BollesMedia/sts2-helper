import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { GameState } from "@sts2/shared/types/game-state";
import { computeGameStateContentKey } from "@sts2/shared/evaluation/game-state-content-key";
import { computeMapContentKey } from "@sts2/shared/evaluation/map-content-key";

// ---- Types ----

export interface GameStateEntry {
  data: GameState;
  contentKey: string;
  receivedAt: number;
}

interface GameStateSliceState {
  current: GameState | null;
  previous: GameState | null;
  contentKey: string | null;
  /** Persists across non-map states — useful in Redux DevTools for debugging map eval triggers */
  lastMapContentKey: string | null;
  /** Dev-only ring buffer, max 30 entries */
  history: GameStateEntry[];
}

const initialState: GameStateSliceState = {
  current: null,
  previous: null,
  contentKey: null,
  lastMapContentKey: null,
  history: [],
};

const MAX_HISTORY = 30;

// ---- Slice ----

export const gameStateSlice = createSlice({
  name: "gameState",
  initialState,
  reducers: {
    gameStateReceived(state, action: PayloadAction<GameState>) {
      const contentKey = computeGameStateContentKey(action.payload);

      // Content-based dedup — no-op if key hasn't changed
      if (contentKey === state.contentKey) return;

      // Shift current → previous
      state.previous = state.current;
      state.current = action.payload;
      state.contentKey = contentKey;

      // Track map content key when in map state
      if (action.payload.state_type === "map") {
        const mapState = action.payload as Extract<GameState, { state_type: "map" }>;
        state.lastMapContentKey = computeMapContentKey(
          mapState.state_type,
          mapState.map?.current_position ?? null,
          mapState.map.next_options
        );
      }

      // Append to history in dev / test mode
      if (import.meta.env.DEV || import.meta.env.MODE === "test") {
        state.history.push({ data: action.payload, contentKey, receivedAt: Date.now() });
        if (state.history.length > MAX_HISTORY) {
          state.history.shift();
        }
      }
    },
  },
  selectors: {
    selectCurrentGameState: (state) => state.current,
    selectPreviousGameState: (state) => state.previous,
    selectGameStateType: (state) => state.current?.state_type ?? null,
    selectGameStateContentKey: (state) => state.contentKey,
    selectLastMapContentKey: (state) => state.lastMapContentKey,
    selectGameStateHistory: (state) => state.history,
  },
});

export const { gameStateReceived } = gameStateSlice.actions;

export const {
  selectCurrentGameState,
  selectPreviousGameState,
  selectGameStateType,
  selectGameStateContentKey,
  selectLastMapContentKey,
  selectGameStateHistory,
} = gameStateSlice.selectors;
