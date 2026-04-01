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
 * Validate that a game state response has the expected shape for its state_type.
 * The mod API is untrusted — transitional states can omit required fields.
 * Catching malformed data here prevents crashes deeper in the component tree.
 */
function isValidGameState(data: unknown): data is GameState {
  if (!data || typeof data !== "object") return false;
  const state = data as Record<string, unknown>;
  if (typeof state.state_type !== "string") return false;

  // Menu state has no nested data
  if (state.state_type === "menu") return true;

  // All other states require a run object
  if (!state.run || typeof state.run !== "object") return false;

  // Map from state_type to the key holding the nested container object
  const containerKey: Record<string, string> = {
    monster: "battle", elite: "battle", boss: "battle",
    hand_select: "battle",
    map: "map", shop: "shop", event: "event", rest_site: "rest_site",
    combat_rewards: "rewards", card_reward: "card_reward",
    card_select: "card_select", relic_select: "relic_select", treasure: "treasure",
  };

  const key = containerKey[state.state_type];
  if (!key) return true; // Unknown state_type — mod is responding, just no UI for this state

  const container = state[key];
  if (!container || typeof container !== "object") return false;

  // card_reward has no player field
  if (state.state_type === "card_reward") return true;

  // All other states need a player object with at least a character string
  const { player } = container as Record<string, unknown>;
  if (!player || typeof player !== "object") return false;
  if (typeof (player as Record<string, unknown>).character !== "string") return false;

  return true;
}

async function fetcher(url: string): Promise<GameState> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`STS2MCP responded with ${res.status}`);
  }
  const data = await res.json();
  if (!isValidGameState(data)) {
    throw new Error(`Malformed game state (state_type: ${(data as Record<string, unknown>)?.state_type ?? "missing"})`);
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
