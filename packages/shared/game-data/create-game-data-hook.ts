"use client";

import useSWR from "swr";

const SWR_CONFIG = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  dedupingInterval: 1000 * 60 * 60, // 1 hour — game data is static
};

/**
 * Factory for game data hooks. Wraps a fetcher in SWR with
 * static-data caching defaults.
 */
export function createGameDataHook<T>(key: string, fetcher: () => Promise<T[]>) {
  return function useGameData() {
    return useSWR<T[]>(`game-data:${key}`, fetcher, SWR_CONFIG);
  };
}
