import { listen } from "@tauri-apps/api/event";
import { gameStateApi } from "../../services/gameStateApi";
import type { AppDispatch } from "../../store/store";

/**
 * Register once at app init. Every time the Rust poller finishes a
 * fetch, force-refetch the RTK Query endpoint so the existing
 * matchFulfilled / matchRejected listeners see a new result without
 * the JS side running its own timer (which WKWebView throttles when
 * the window is unfocused).
 *
 * We also start ONE persistent subscription so the cache entry stays
 * alive for the full app lifetime — otherwise `keepUnusedDataFor: 0`
 * would garbage-collect it between events on routes that don't
 * currently render useGameState, and downstream listeners would miss
 * updates.
 */
export async function setupGameStateSubscription(dispatch: AppDispatch) {
  // Persistent subscription — holds the RTK Query cache entry alive
  // for the lifetime of the app. The returned promise resolves to
  // { unsubscribe } but we intentionally never call it.
  dispatch(gameStateApi.endpoints.getGameState.initiate());

  const refetch = () =>
    dispatch(
      gameStateApi.endpoints.getGameState.initiate(undefined, {
        forceRefetch: true,
        subscribe: false,
      }),
    );

  await listen("game-state-updated", refetch);
  await listen("game-state-error", refetch);

  // Backfill: grab whatever Rust already has in case its first emit
  // fired before our listeners were registered.
  refetch();
}
