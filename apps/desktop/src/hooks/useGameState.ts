import { useRef } from "react";
import { useGetGameStateQuery, gameStateApi } from "../services/gameStateApi";
import { reportError } from "@sts2/shared/lib/error-reporter";
import { STS2MCP_BASE_URL } from "@sts2/shared/lib/constants";
import {
  POLLING_INTERVALS,
  DEFAULT_INTERVAL,
  OFFLINE_INTERVAL,
} from "@sts2/shared/features/connection/polling-config";
import { useAppSelector } from "../store/hooks";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

// Extracted selector — avoids creating new selector instance per render
const selectGameStateResult = gameStateApi.endpoints.getGameState.select();

/**
 * Game state hook powered by RTK Query.
 *
 * Same return interface as the old SWR-based useGameState so
 * existing consumers (App.tsx) don't need changes.
 */
export function useGameState() {
  // Derive polling interval from last known state_type
  const lastStateType = useAppSelector(
    (state) => selectGameStateResult(state).data?.state_type
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

  // Connection status + game mode synced via connectionListeners (no useEffect needed)

  return {
    gameState: data ?? null,
    connectionStatus,
    error: error ?? null,
    gameMode: (data?.game_mode ?? "singleplayer") as "singleplayer" | "multiplayer",
  };
}
