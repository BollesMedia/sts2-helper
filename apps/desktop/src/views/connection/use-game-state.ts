"use client";

import { useRef } from "react";
import useSWR from "swr";
import type { GameState } from "@sts2/shared/types/game-state";
import {
  STS2MCP_BASE_URL,
  STS2MCP_SINGLEPLAYER_URL,
  STS2MCP_MULTIPLAYER_URL,
} from "@sts2/shared/lib/constants";
import { reportError } from "@sts2/shared/lib/error-reporter";
import { validateGameStateStructure, snapshotShape } from "@sts2/shared/lib/validate-game-state";
import {
  POLLING_INTERVALS,
  DEFAULT_INTERVAL,
  OFFLINE_INTERVAL,
  ERROR_INTERVAL,
} from "./polling-config";

/** Rate-limit validation error reports — one per stateType+errors combo per session */
const reportedValidationErrors = new Set<string>();

/**
 * Validate mod response structure. Logs + reports to Sentry/Supabase on failure,
 * but still returns data (soft failure) so downstream null guards handle gracefully.
 */
function validateAndReturn(data: unknown): GameState {
  const result = validateGameStateStructure(data);

  if (!result.stateType) {
    throw new Error("Mod response missing state_type");
  }

  if (!result.valid) {
    const errorKey = `v2:${result.stateType}:${result.errors.join(",")}`;
    console.warn(
      `[GameState] Validation failed for "${result.stateType}":`,
      result.errors,
      "Raw keys:",
      data && typeof data === "object" ? Object.keys(data) : "N/A"
    );

    if (!reportedValidationErrors.has(errorKey)) {
      reportedValidationErrors.add(errorKey);
      reportError("game_state_validation", `Invalid ${result.stateType} response`, {
        stateType: result.stateType,
        errors: result.errors,
        rawKeys: data && typeof data === "object" ? Object.keys(data) : [],
        responseShape: snapshotShape(data, 3),
        activeMode,
      });
    }
  }

  return data as GameState;
}

/** Cached game mode — avoids 409 ping-pong on every poll */
let activeMode: "singleplayer" | "multiplayer" = "singleplayer";

async function fetcher(): Promise<GameState> {
  const url = activeMode === "multiplayer"
    ? STS2MCP_MULTIPLAYER_URL
    : STS2MCP_SINGLEPLAYER_URL;

  const res = await fetch(url);

  // 409 = wrong mode. Switch and retry once.
  if (res.status === 409) {
    activeMode = activeMode === "singleplayer" ? "multiplayer" : "singleplayer";
    const retryUrl = activeMode === "multiplayer"
      ? STS2MCP_MULTIPLAYER_URL
      : STS2MCP_SINGLEPLAYER_URL;
    const retryRes = await fetch(retryUrl);
    if (!retryRes.ok) {
      activeMode = "singleplayer";
      throw new Error(`STS2MCP responded with ${retryRes.status}`);
    }
    return validateAndReturn(await retryRes.json());
  }

  if (!res.ok) {
    throw new Error(`STS2MCP responded with ${res.status}`);
  }

  return validateAndReturn(await res.json());
}

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

export function useGameState() {
  // Stable SWR key — doesn't change when mode switches
  const { data, error, isLoading } = useSWR<GameState>(
    STS2MCP_BASE_URL,
    fetcher,
    {
      refreshInterval: (latestData) => {
        if (!latestData) return OFFLINE_INTERVAL;
        return POLLING_INTERVALS[latestData.state_type] ?? DEFAULT_INTERVAL;
      },
      errorRetryInterval: ERROR_INTERVAL,
      revalidateOnFocus: false,
      refreshWhenHidden: true,
      dedupingInterval: 200,
      shouldRetryOnError: true,
      errorRetryCount: Infinity,
    }
  );

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
      errorMessage: error.message ?? String(error),
      url: STS2MCP_BASE_URL,
    });
  }
  if (!error) {
    disconnectReported.current = false;
  }

  const gameMode = data?.game_mode;

  return { gameState: data ?? null, connectionStatus, error, gameMode: gameMode ?? activeMode };
}
