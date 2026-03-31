"use client";

import useSWR from "swr";
import type { GameState } from "../../types/game-state";
import { STS2MCP_API_URL } from "../../lib/constants";
import {
  POLLING_INTERVALS,
  DEFAULT_INTERVAL,
  OFFLINE_INTERVAL,
  ERROR_INTERVAL,
} from "./polling-config";

async function fetcher(url: string): Promise<GameState> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`STS2MCP responded with ${res.status}`);
  }
  return res.json();
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
      compare: (a, b) => {
        if (!a || !b) return false;
        return a.state_type === b.state_type && JSON.stringify(a) === JSON.stringify(b);
      },
      shouldRetryOnError: true,
      errorRetryCount: Infinity,
    }
  );

  const connectionStatus: ConnectionStatus = error
    ? "disconnected"
    : isLoading
      ? "connecting"
      : "connected";

  return { gameState: data ?? null, connectionStatus, error };
}
