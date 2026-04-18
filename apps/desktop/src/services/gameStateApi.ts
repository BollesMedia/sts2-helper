import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { invoke } from "@tauri-apps/api/core";
import type { GameState } from "@sts2/shared/types/game-state";
import { reportError } from "@sts2/shared/lib/error-reporter";
import {
  validateGameStateStructure,
  snapshotShape,
} from "@sts2/shared/lib/validate-game-state";

type PollResult =
  | { type: "ok"; data: GameState }
  | { type: "error"; status: string; message: string };

/** Rate-limit validation error reports — one per stateType+errors combo per session */
const reportedValidationErrors = new Set<string>();

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
      data && typeof data === "object" ? Object.keys(data) : "N/A",
    );

    if (!reportedValidationErrors.has(errorKey)) {
      reportedValidationErrors.add(errorKey);
      reportError(
        "game_state_validation",
        `Invalid ${result.stateType} response`,
        {
          stateType: result.stateType,
          errors: result.errors,
          rawKeys:
            data && typeof data === "object" ? Object.keys(data) : [],
          responseShape: snapshotShape(data, 3),
        },
      );
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
          const result = await invoke<PollResult>("get_latest_game_state");
          if (result.type === "error") {
            return {
              error: { status: result.status, data: result.message },
            };
          }
          return { data: validateAndReturn(result.data) };
        } catch (err) {
          return {
            error: {
              status: "FETCH_ERROR",
              data: err instanceof Error ? err.message : String(err),
            },
          };
        }
      },
      keepUnusedDataFor: 0,
    }),
  }),
});

export const { useGetGameStateQuery } = gameStateApi;
