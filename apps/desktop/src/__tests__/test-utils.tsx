import React from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { configureStore, combineSlices } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { runSlice } from "../features/run/runSlice";
import { evaluationSlice, type EvalEntry } from "../features/evaluation/evaluationSlice";

// Use combineSlices so slice selectors (e.g., selectEvals) get properly
// scoped to their slice state within the root state. This is required
// for selectors like selectEvalEntry that chain through selectEvals.

const testReducer = combineSlices(runSlice, evaluationSlice);
type TestState = ReturnType<typeof testReducer>;

function createTestStore(preloadedState?: Partial<TestState>) {
  return configureStore({
    reducer: testReducer,
    preloadedState: preloadedState as TestState,
  });
}

type TestStore = ReturnType<typeof createTestStore>;

const EMPTY_EVAL: EvalEntry = { evalKey: "", result: null, isLoading: false, error: null };

/** Default evaluation state with all eval types initialised to empty entries */
export function createEmptyEvals() {
  return {
    card_reward: { ...EMPTY_EVAL },
    shop: { ...EMPTY_EVAL },
    event: { ...EMPTY_EVAL },
    rest_site: { ...EMPTY_EVAL },
    card_removal: { ...EMPTY_EVAL },
    card_upgrade: { ...EMPTY_EVAL },
    card_select: { ...EMPTY_EVAL },
    relic_select: { ...EMPTY_EVAL },
    map: { ...EMPTY_EVAL },
  } as const;
}

interface ExtendedRenderOptions extends Omit<RenderOptions, "wrapper"> {
  preloadedState?: Partial<TestState>;
  store?: TestStore;
}

export function renderWithStore(
  ui: React.ReactElement,
  {
    preloadedState,
    store = createTestStore(preloadedState),
    ...renderOptions
  }: ExtendedRenderOptions = {},
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  }
  return { store, ...render(ui, { wrapper: Wrapper, ...renderOptions }) };
}
