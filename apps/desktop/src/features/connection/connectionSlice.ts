import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";
export type GameMode = "singleplayer" | "multiplayer";

export interface ModMismatch {
  installed: string;
  required: string;
  gameRunning: boolean;
}

interface ConnectionState {
  status: ConnectionStatus;
  gameMode: GameMode;
  modMismatch: ModMismatch | null;
}

const initialState: ConnectionState = {
  status: "disconnected",
  gameMode: "singleplayer",
  modMismatch: null,
};

export const connectionSlice = createSlice({
  name: "connection",
  initialState,
  reducers: {
    statusChanged(state, action: PayloadAction<ConnectionStatus>) {
      state.status = action.payload;
    },
    gameModeDetected(state, action: PayloadAction<GameMode>) {
      state.gameMode = action.payload;
    },
    modMismatchDetected(state, action: PayloadAction<ModMismatch>) {
      state.modMismatch = action.payload;
    },
    modMismatchCleared(state) {
      state.modMismatch = null;
    },
  },
  selectors: {
    selectConnectionStatus: (state) => state.status,
    selectGameMode: (state) => state.gameMode,
    selectIsConnected: (state) => state.status === "connected",
    selectModMismatch: (state) => state.modMismatch,
  },
});

export const { statusChanged, gameModeDetected, modMismatchDetected, modMismatchCleared } = connectionSlice.actions;
export const { selectConnectionStatus, selectGameMode, selectIsConnected, selectModMismatch } = connectionSlice.selectors;
