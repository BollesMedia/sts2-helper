"use client";

import { useRef } from "react";
import useSWR from "swr";
import type { GameState } from "../../types/game-state";
import { STS2MCP_API_URL } from "../../lib/constants";
import { reportError } from "../../lib/error-reporter";
import {
  POLLING_INTERVALS,
  DEFAULT_INTERVAL,
  OFFLINE_INTERVAL,
  ERROR_INTERVAL,
} from "./polling-config";

/**
 * Check if the mod response is valid JSON with a state_type string.
 * This is the ONLY check needed to confirm the mod is connected.
 * Component-level defense-in-depth (optional chaining) handles missing
 * properties — we don't reject data here to avoid freezing the UI on
 * stale cached state during screen transitions.
 */
function isGameStateResponse(data: unknown): data is GameState {
  if (!data || typeof data !== "object") return false;
  return typeof (data as Record<string, unknown>).state_type === "string";
}

async function fetcher(url: string): Promise<GameState> {
  // fetch() throws on network errors (mod not running) — real disconnect
  const res = await fetch(url);
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
  const { data, error, isLoading } = useSWR<GameState>(
    STS2MCP_API_URL,
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
      url: STS2MCP_API_URL,
    });
  }
  if (!error) {
    disconnectReported.current = false;
  }

  return { gameState: data ?? null, connectionStatus, error };
}
