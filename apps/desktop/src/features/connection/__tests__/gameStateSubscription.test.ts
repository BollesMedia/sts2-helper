import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";

const { listenMock } = vi.hoisted(() => ({ listenMock: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { setupGameStateSubscription } from "../gameStateSubscription";
import { gameStateApi } from "../../../services/gameStateApi";

function makeStore(onAction?: (action: unknown) => void) {
  const spyMiddleware =
    () => (next: (a: unknown) => unknown) => (action: unknown) => {
      if (onAction) onAction(action);
      return next(action);
    };
  return configureStore({
    reducer: { [gameStateApi.reducerPath]: gameStateApi.reducer },
    middleware: (gdm) =>
      gdm().concat(gameStateApi.middleware).concat(spyMiddleware),
  });
}

describe("setupGameStateSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes to both events and triggers matchFulfilled / matchRejected on each emit", async () => {
    const handlers: Record<string, () => void> = {};
    listenMock.mockImplementation(async (name: string, cb: () => void) => {
      handlers[name] = cb;
      return () => {};
    });

    const fulfilledSpy = vi.fn();
    const rejectedSpy = vi.fn();
    const store = makeStore((action) => {
      if (typeof action === "object" && action !== null && "type" in action) {
        if (gameStateApi.endpoints.getGameState.matchFulfilled(action as never)) {
          fulfilledSpy();
        }
        if (gameStateApi.endpoints.getGameState.matchRejected(action as never)) {
          rejectedSpy();
        }
      }
    });

    // Default mock for setup's persistent subscribe + backfill call
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: "ok",
      data: { state_type: "menu", game_mode: "singleplayer" },
    });

    await setupGameStateSubscription(store.dispatch);
    // Flush setup-triggered dispatches
    await new Promise((r) => setTimeout(r, 0));

    expect(listenMock).toHaveBeenCalledWith(
      "game-state-updated",
      expect.any(Function),
    );
    expect(listenMock).toHaveBeenCalledWith(
      "game-state-error",
      expect.any(Function),
    );

    fulfilledSpy.mockClear();
    rejectedSpy.mockClear();

    // Emit success → matchFulfilled must fire
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      type: "ok",
      data: { state_type: "menu", game_mode: "singleplayer" },
    });
    handlers["game-state-updated"]();
    await new Promise((r) => setTimeout(r, 0));
    expect(fulfilledSpy).toHaveBeenCalledTimes(1);

    // Emit error → matchRejected must fire
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      type: "error",
      status: "500",
      message: "nope",
    });
    handlers["game-state-error"]();
    await new Promise((r) => setTimeout(r, 0));
    expect(rejectedSpy).toHaveBeenCalledTimes(1);
  });

  it("kicks off one immediate backfill so downstream listeners catch the first cached state", async () => {
    listenMock.mockImplementation(async () => () => {});
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: "ok",
      data: { state_type: "menu", game_mode: "singleplayer" },
    });

    const store = makeStore();
    const dispatchSpy = vi.spyOn(store, "dispatch");
    await setupGameStateSubscription(store.dispatch);
    await new Promise((r) => setTimeout(r, 0));

    expect(invoke).toHaveBeenCalledWith("get_latest_game_state");
    expect(dispatchSpy).toHaveBeenCalled();
  });
});
