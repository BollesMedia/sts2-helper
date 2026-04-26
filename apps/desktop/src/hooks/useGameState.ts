import { useRef } from "react";
import { useGetGameStateQuery, gameStateApi } from "../services/gameStateApi";
import { reportError } from "@sts2/shared/lib/error-reporter";
import { STS2MCP_BASE_URL } from "@sts2/shared/lib/constants";
import { useAppSelector } from "../store/hooks";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

/**
 * Why we're disconnected — drives banner copy so users get an actionable
 * message instead of the generic "make sure the game is running".
 *
 * - `mod_incompatible`: MCP returned 5xx with a body matching a .NET runtime
 *   exception pattern (e.g. `MissingMethodException` after a STS2 game update
 *   removes a getter the mod calls). Always combat-only in practice because
 *   map/menu extractors don't touch the affected APIs.
 * - `unreachable`: Rust poller couldn't reach the mod (game off, port blocked).
 * - `unknown`: Rejected for a reason we don't recognize — generic copy.
 */
export type DisconnectReason = "mod_incompatible" | "unreachable" | "unknown";

const selectGameStateResult = gameStateApi.endpoints.getGameState.select();

function isNotReady(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: unknown }).status === "NOT_READY"
  );
}

const MOD_INCOMPATIBLE_PATTERN = /MissingMethodException|Method not found/i;

export function classifyDisconnect(error: unknown): DisconnectReason {
  if (typeof error !== "object" || error === null) return "unknown";
  const e = error as { status?: unknown; data?: unknown };
  if (
    typeof e.status === "number" &&
    e.status >= 500 &&
    typeof e.data === "string" &&
    MOD_INCOMPATIBLE_PATTERN.test(e.data)
  ) {
    return "mod_incompatible";
  }
  if (e.status === "FETCH_ERROR") return "unreachable";
  return "unknown";
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

  const disconnectReason: DisconnectReason | null =
    connectionStatus === "disconnected" ? classifyDisconnect(error) : null;

  return {
    gameState: data ?? null,
    connectionStatus,
    disconnectReason,
    error: notReady ? null : (error ?? null),
    gameMode: (data?.game_mode ?? "singleplayer") as
      | "singleplayer"
      | "multiplayer",
  };
}
