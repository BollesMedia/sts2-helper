import { useRef } from "react";
import { useGetGameStateQuery, gameStateApi } from "../services/gameStateApi";
import { reportError } from "@sts2/shared/lib/error-reporter";
import { STS2MCP_BASE_URL } from "@sts2/shared/lib/constants";
import { useAppSelector } from "../store/hooks";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

const selectGameStateResult = gameStateApi.endpoints.getGameState.select();

function isNotReady(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: unknown }).status === "NOT_READY"
  );
}

/**
 * Game state hook. Polling cadence lives in the Rust-side poller —
 * the frontend just reads the latest cached result and re-renders
 * when the poller emits a Tauri event (see gameStateSubscription).
 */
export function useGameState() {
  useAppSelector((state) => selectGameStateResult(state).data?.state_type);

  const { data, error, isLoading } = useGetGameStateQuery();

  const notReady = isNotReady(error);
  const connectionStatus: ConnectionStatus =
    error && !notReady ? "disconnected" : isLoading || notReady ? "connecting" : "connected";

  const disconnectReported = useRef(false);
  if (error && !notReady && !disconnectReported.current) {
    disconnectReported.current = true;
    reportError("connection", "Game API disconnected", {
      errorMessage: String(error),
      url: STS2MCP_BASE_URL,
    });
  }
  if (!error || notReady) {
    disconnectReported.current = false;
  }

  return {
    gameState: data ?? null,
    connectionStatus,
    error: notReady ? null : (error ?? null),
    gameMode: (data?.game_mode ?? "singleplayer") as
      | "singleplayer"
      | "multiplayer",
  };
}
