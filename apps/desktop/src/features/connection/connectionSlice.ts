import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";
export type GameMode = "singleplayer" | "multiplayer";

interface ConnectionState {
  status: ConnectionStatus;
  gameMode: GameMode;
}

const initialState: ConnectionState = {
  status: "disconnected",
  gameMode: "singleplayer",
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
  },
  selectors: {
    selectConnectionStatus: (state) => state.status,
    selectGameMode: (state) => state.gameMode,
    selectIsConnected: (state) => state.status === "connected",
  },
});

export const { statusChanged, gameModeDetected } = connectionSlice.actions;
export const { selectConnectionStatus, selectGameMode, selectIsConnected } = connectionSlice.selectors;
