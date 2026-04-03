import { startAppListening } from "./listenerMiddleware";

const RUN_STORAGE_KEY = "sts2-redux-run";
const CONNECTION_STORAGE_KEY = "sts2-redux-connection-mode";

/**
 * Load persisted state for preloadedState in store config.
 * Connection status always starts as 'disconnected' — we discover
 * the real status via polling.
 * Returns Record<string, unknown> to avoid circular type dep on RootState.
 */
export function loadPersistedState(): Record<string, unknown> {
  try {
    const runRaw = localStorage.getItem(RUN_STORAGE_KEY);
    const modeRaw = localStorage.getItem(CONNECTION_STORAGE_KEY);
    return {
      ...(runRaw ? { run: JSON.parse(runRaw) } : {}),
      ...(modeRaw
        ? { connection: { status: "disconnected" as const, gameMode: JSON.parse(modeRaw) } }
        : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Listener that debounces writes of run + connection slices to localStorage.
 * Fires when either slice changes, waits 500ms, then writes.
 */
export function setupPersistenceListener() {
  startAppListening({
    predicate: (_action, currentState, previousState) =>
      currentState.run !== previousState.run ||
      currentState.connection?.gameMode !== previousState.connection?.gameMode,
    effect: async (_action, listenerApi) => {
      listenerApi.cancelActiveListeners();
      await listenerApi.delay(500);

      const state = listenerApi.getState();
      try {
        localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(state.run));
        if (state.connection) {
          localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(state.connection.gameMode));
        }
      } catch {
        // localStorage full or unavailable — silently skip
      }
    },
  });
}
