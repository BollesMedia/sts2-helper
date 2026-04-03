import { configureStore, combineSlices } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { listenerMiddleware } from "./listenerMiddleware";
import { loadPersistedState, setupPersistenceListener } from "./persistence";
import { gameStateApi } from "../services/gameStateApi";
import { evaluationApi } from "../services/evaluationApi";
import { connectionSlice } from "../features/connection/connectionSlice";
import { runSlice } from "../features/run/runSlice";

// Import listeners for side-effect registration
import { setupConnectionListeners } from "../features/connection/connectionListeners";
import { setupGameStateUpdateListener } from "../features/run/runListeners";
import { setupRunAnalyticsListener } from "../features/run/runAnalyticsListener";
import { setupRunApiListener } from "../features/run/runApiListener";
import { setupMapEvalListener } from "../features/map/mapListeners";

const rootReducer = combineSlices(
  gameStateApi,
  evaluationApi,
  connectionSlice,
  runSlice,
);

export const store = configureStore({
  reducer: rootReducer,
  preloadedState: loadPersistedState() as Partial<ReturnType<typeof rootReducer>>,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .prepend(listenerMiddleware.middleware)
      .concat(gameStateApi.middleware)
      .concat(evaluationApi.middleware),
});

setupListeners(store.dispatch);

// Start all listeners
setupPersistenceListener();
setupConnectionListeners();
setupGameStateUpdateListener();
setupRunAnalyticsListener();
setupRunApiListener();
setupMapEvalListener();

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
