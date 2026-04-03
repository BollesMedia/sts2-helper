import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { listenerMiddleware } from "./listenerMiddleware";
import { gameStateApi } from "../services/gameStateApi";

export const store = configureStore({
  reducer: {
    [gameStateApi.reducerPath]: gameStateApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .prepend(listenerMiddleware.middleware)
      .concat(gameStateApi.middleware),
});

// Enable refetchOnFocus / refetchOnReconnect behaviors
setupListeners(store.dispatch);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
