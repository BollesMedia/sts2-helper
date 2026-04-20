import { configureStore, combineSlices } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { listenerMiddleware } from "./listenerMiddleware";
import { loadPersistedState, setupPersistenceListener } from "./persistence";
import { gameStateApi } from "../services/gameStateApi";
import { evaluationApi } from "../services/evaluationApi";
import { connectionSlice } from "../features/connection/connectionSlice";
import { runSlice } from "../features/run/runSlice";
import { evaluationSlice } from "../features/evaluation/evaluationSlice";
import { gameStateSlice } from "../features/gameState/gameStateSlice";

// Import listeners for side-effect registration
import { setupGameStateBridge } from "../features/gameState/gameStateBridge";
import { setupConnectionListeners } from "../features/connection/connectionListeners";
import { setupGameStateUpdateListener } from "../features/run/runListeners";
import { setupRunAnalyticsListener } from "../features/run/runAnalyticsListener";
import { setupChoiceTrackingListener } from "../features/choice/choiceTrackingListener";
import { setupMapEvalListener } from "../features/map/mapListeners";
import { setupEvaluationListeners } from "../features/evaluation/evaluationListeners";
import { setupGameStateSubscription } from "../features/connection/gameStateSubscription";
import { setupSaveFileSubscription } from "../features/run/saveFileSubscription";

const rootReducer = combineSlices(
  gameStateApi,
  evaluationApi,
  connectionSlice,
  runSlice,
  evaluationSlice,
  gameStateSlice,
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
setupGameStateBridge(); // Must be FIRST — slice must be populated before eval listeners fire
setupPersistenceListener();
setupConnectionListeners();
setupGameStateUpdateListener();
setupRunAnalyticsListener();
setupChoiceTrackingListener(); // Must be AFTER gameStateUpdate so deck is current
setupMapEvalListener();
setupEvaluationListeners();
setupGameStateSubscription(store.dispatch).catch((err) => {
  console.error("[gameStateSubscription] setup failed", err);
});
setupSaveFileSubscription(store.dispatch).catch((err) => {
  console.error("[saveFileSubscription] setup failed", err);
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
