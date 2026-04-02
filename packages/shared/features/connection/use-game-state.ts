"use client";

import { useRef } from "react";
import useSWR from "swr";
import type { GameState } from "../../types/game-state";
import {
  STS2MCP_BASE_URL,
  STS2MCP_SINGLEPLAYER_URL,
  STS2MCP_MULTIPLAYER_URL,
} from "../../lib/constants";
import { reportError } from "../../lib/error-reporter";
import {
  POLLING_INTERVALS,
  DEFAULT_INTERVAL,
  OFFLINE_INTERVAL,
  ERROR_INTERVAL,
} from "./polling-config";

/**
 * Check if the mod response is valid JSON with a state_type string.
 * Component-level defense-in-depth handles missing properties.
 */
function isGameStateResponse(data: unknown): data is GameState {
  if (!data || typeof data !== "object") return false;
  return typeof (data as Record<string, unknown>).state_type === "string";
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
      // Retry failed — reset to singleplayer as safe default (e.g., old mod without multiplayer)
      activeMode = "singleplayer";
      throw new Error(`STS2MCP responded with ${retryRes.status}`);
    }
    const retryData = await retryRes.json();
    if (!isGameStateResponse(retryData)) {
      throw new Error("Mod response missing state_type");
    }
    return retryData;
  }

  if (!res.ok) {
    throw new Error(`STS2MCP responded with ${res.status}`);
  }

  const data = await res.json();
  if (!isGameStateResponse(data)) {
    throw new Error("Mod response missing state_type");
  }
  return data;
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

  const gameMode = (data as Record<string, unknown> | undefined)?.game_mode as string | undefined;

  return { gameState: data ?? null, connectionStatus, error, gameMode: gameMode ?? activeMode };
}
