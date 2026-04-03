import { useEffect, useRef } from "react";
import { useGetGameStateQuery, gameStateApi } from "../services/gameStateApi";
import { reportError } from "@sts2/shared/lib/error-reporter";
import { STS2MCP_BASE_URL } from "@sts2/shared/lib/constants";
import {
  POLLING_INTERVALS,
  DEFAULT_INTERVAL,
  OFFLINE_INTERVAL,
} from "@sts2/shared/features/connection/polling-config";
import { useAppSelector, useAppDispatch } from "../store/hooks";
import { statusChanged, gameModeDetected } from "../features/connection/connectionSlice";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

/**
 * Game state hook powered by RTK Query.
 *
 * Same return interface as the old SWR-based useGameState so
 * existing consumers (App.tsx) don't need changes.
 */
export function useGameState() {
  // Derive polling interval from last known state_type
  const lastStateType = useAppSelector(
    (state) => gameStateApi.endpoints.getGameState.select()(state).data?.state_type
  );
  const interval = lastStateType
    ? (POLLING_INTERVALS[lastStateType] ?? DEFAULT_INTERVAL)
    : OFFLINE_INTERVAL;

  const { data, error, isLoading } = useGetGameStateQuery(undefined, {
    pollingInterval: interval,
    refetchOnFocus: false,
  });

  const connectionStatus: ConnectionStatus = error
    ? "disconnected"
    : isLoading
      ? "connecting"
      : "connected";

  // Report persistent disconnect (once per session)
  const disconnectReported = useRef(false);
  if (error && !disconnectReported.current) {
    disconnectReported.current = true;
    reportError("connection", "Game API disconnected", {
      errorMessage: String(error),
      url: STS2MCP_BASE_URL,
    });
  }
  if (!error) {
    disconnectReported.current = false;
  }

  // Sync connection status + game mode to Redux slices
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(statusChanged(connectionStatus));
  }, [connectionStatus, dispatch]);

  useEffect(() => {
    const mode = data?.game_mode;
    if (mode) dispatch(gameModeDetected(mode));
  }, [data?.game_mode, dispatch]);

  return {
    gameState: data ?? null,
    connectionStatus,
    error: error ?? null,
    gameMode: (data?.game_mode ?? "singleplayer") as "singleplayer" | "multiplayer",
  };
}
