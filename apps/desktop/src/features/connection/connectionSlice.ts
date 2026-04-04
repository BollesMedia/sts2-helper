import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";
export type GameMode = "singleplayer" | "multiplayer";
export type UserRole = "user" | "admin";

export interface ModMismatch {
  installed: string;
  required: string;
  gameRunning: boolean;
}

interface ConnectionState {
  status: ConnectionStatus;
  gameMode: GameMode;
  modMismatch: ModMismatch | null;
  userRole: UserRole;
}

const initialState: ConnectionState = {
  status: "disconnected",
  gameMode: "singleplayer",
  modMismatch: null,
  userRole: "user",
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
    userRoleSet(state, action: PayloadAction<UserRole>) {
      state.userRole = action.payload;
    },
  },
  selectors: {
    selectConnectionStatus: (state) => state.status,
    selectGameMode: (state) => state.gameMode,
    selectIsConnected: (state) => state.status === "connected",
    selectModMismatch: (state) => state.modMismatch,
    selectUserRole: (state) => state.userRole,
    selectIsAdmin: (state) => state.userRole === "admin",
  },
});

export const { statusChanged, gameModeDetected, modMismatchDetected, modMismatchCleared, userRoleSet } = connectionSlice.actions;
export const { selectConnectionStatus, selectGameMode, selectIsConnected, selectModMismatch, selectUserRole, selectIsAdmin } = connectionSlice.selectors;
