import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { gameStateApi } from "../gameStateApi";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

function makeStore() {
  return configureStore({
    reducer: { [gameStateApi.reducerPath]: gameStateApi.reducer },
    middleware: (gdm) => gdm().concat(gameStateApi.middleware),
  });
}

describe("gameStateApi.getGameState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns data when Rust reports ok", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: "ok",
      data: { state_type: "menu", game_mode: "singleplayer" },
    });

    const store = makeStore();
    const result = await store.dispatch(
      gameStateApi.endpoints.getGameState.initiate()
    );

    expect(invoke).toHaveBeenCalledWith("get_latest_game_state");
    expect(result.data).toMatchObject({ state_type: "menu" });
    expect(result.error).toBeUndefined();
  });

  it("returns error when Rust reports error", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: "error",
      status: "FETCH_ERROR",
      message: "connection refused",
    });

    const store = makeStore();
    const result = await store.dispatch(
      gameStateApi.endpoints.getGameState.initiate()
    );

    expect(result.error).toMatchObject({
      status: "FETCH_ERROR",
      data: "connection refused",
    });
  });

  it("returns error when invoke itself throws", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));

    const store = makeStore();
    const result = await store.dispatch(
      gameStateApi.endpoints.getGameState.initiate()
    );

    expect(result.error).toMatchObject({ status: "FETCH_ERROR" });
  });
});
