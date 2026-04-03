import { configureStore, combineSlices } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { listenerMiddleware } from "./listenerMiddleware";
import { loadPersistedState, setupPersistenceListener } from "./persistence";
import { gameStateApi } from "../services/gameStateApi";
import { connectionSlice } from "../features/connection/connectionSlice";
import { runSlice } from "../features/run/runSlice";

const rootReducer = combineSlices(
  gameStateApi,
  connectionSlice,
  runSlice,
);

export const store = configureStore({
  reducer: rootReducer,
  preloadedState: loadPersistedState() as Partial<ReturnType<typeof rootReducer>>,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .prepend(listenerMiddleware.middleware)
      .concat(gameStateApi.middleware),
});

setupListeners(store.dispatch);
setupPersistenceListener();

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
