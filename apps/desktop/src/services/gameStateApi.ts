import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import type { GameState } from "@sts2/shared/types/game-state";
import {
  STS2MCP_SINGLEPLAYER_URL,
  STS2MCP_MULTIPLAYER_URL,
} from "@sts2/shared/lib/constants";
import { reportError } from "@sts2/shared/lib/error-reporter";
import {
  validateGameStateStructure,
  snapshotShape,
} from "@sts2/shared/lib/validate-game-state";

/** Cached game mode — avoids 409 ping-pong on every poll */
let activeMode: "singleplayer" | "multiplayer" = "singleplayer";

/** Rate-limit validation error reports — one per stateType+errors combo per session */
const reportedValidationErrors = new Set<string>();

/**
 * Validate mod response. Logs on failure but still returns data
 * (soft failure — downstream null guards handle gracefully).
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

export const gameStateApi = createApi({
  reducerPath: "gameStateApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (build) => ({
    getGameState: build.query<GameState, void>({
      async queryFn() {
        try {
          const url =
            activeMode === "multiplayer"
              ? STS2MCP_MULTIPLAYER_URL
              : STS2MCP_SINGLEPLAYER_URL;

          const res = await fetch(url);

          // 409 = wrong mode. Switch and retry once.
          if (res.status === 409) {
            activeMode =
              activeMode === "singleplayer" ? "multiplayer" : "singleplayer";
            const retryUrl =
              activeMode === "multiplayer"
                ? STS2MCP_MULTIPLAYER_URL
                : STS2MCP_SINGLEPLAYER_URL;
            const retryRes = await fetch(retryUrl);
            if (!retryRes.ok) {
              activeMode = "singleplayer";
              return { error: { status: retryRes.status, data: `STS2MCP responded with ${retryRes.status}` } };
            }
            return { data: validateAndReturn(await retryRes.json()) };
          }

          if (!res.ok) {
            return { error: { status: res.status, data: `STS2MCP responded with ${res.status}` } };
          }

          return { data: validateAndReturn(await res.json()) };
        } catch (err) {
          return {
            error: {
              status: "FETCH_ERROR",
              data: err instanceof Error ? err.message : "Network error",
            },
          };
        }
      },
      keepUnusedDataFor: 0, // game state is always live
    }),
  }),
});

export const { useGetGameStateQuery } = gameStateApi;
