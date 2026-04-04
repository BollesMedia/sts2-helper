import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

// --- Eval types ---

export type EvalType =
  | "card_reward"
  | "shop"
  | "event"
  | "rest_site"
  | "card_removal"
  | "card_upgrade"
  | "card_select"
  | "relic_select"
  | "map";

const ALL_EVAL_TYPES: EvalType[] = [
  "card_reward",
  "shop",
  "event",
  "rest_site",
  "card_removal",
  "card_upgrade",
  "card_select",
  "relic_select",
  "map",
];

// --- State shape ---

export interface EvalEntry {
  /** Dedup key derived from current inputs (e.g., sorted card IDs) */
  evalKey: string;
  /** Evaluation result — shape varies by eval type */
  result: unknown | null;
  isLoading: boolean;
  error: string | null;
}

function createEmptyEntry(): EvalEntry {
  return { evalKey: "", result: null, isLoading: false, error: null };
}

interface EvaluationState {
  evals: Record<EvalType, EvalEntry>;
}

const initialState: EvaluationState = {
  evals: Object.fromEntries(
    ALL_EVAL_TYPES.map((t) => [t, createEmptyEntry()])
  ) as Record<EvalType, EvalEntry>,
};

// --- Slice ---

export const evaluationSlice = createSlice({
  name: "evaluation",
  initialState,
  reducers: {
    /** Eval started — sets loading, clears error, stores evalKey for dedup */
    evalStarted(
      state,
      action: PayloadAction<{ evalType: EvalType; evalKey: string }>
    ) {
      const entry = state.evals[action.payload.evalType];
      entry.evalKey = action.payload.evalKey;
      entry.result = null;
      entry.isLoading = true;
      entry.error = null;
    },

    /** Eval succeeded — stores result, clears loading */
    evalSucceeded(
      state,
      action: PayloadAction<{
        evalType: EvalType;
        evalKey: string;
        result: unknown;
      }>
    ) {
      const entry = state.evals[action.payload.evalType];
      // Only apply if evalKey matches (guards against stale responses)
      if (entry.evalKey === action.payload.evalKey) {
        entry.result = action.payload.result;
        entry.isLoading = false;
        entry.error = null;
      }
    },

    /** Eval failed — stores error, clears loading */
    evalFailed(
      state,
      action: PayloadAction<{
        evalType: EvalType;
        evalKey: string;
        error: string;
      }>
    ) {
      const entry = state.evals[action.payload.evalType];
      if (entry.evalKey === action.payload.evalKey) {
        entry.error = action.payload.error;
        entry.isLoading = false;
      }
    },

    /** Retry requested — clears error and result to trigger re-eval */
    evalRetryRequested(state, action: PayloadAction<EvalType>) {
      const entry = state.evals[action.payload];
      entry.error = null;
      entry.result = null;
      entry.evalKey = "";
    },

    /** Clear a single eval type (e.g., when leaving a screen) */
    evalCleared(state, action: PayloadAction<EvalType>) {
      state.evals[action.payload] = createEmptyEntry();
    },

    /** Clear all evals (e.g., on new run) */
    allEvalsCleared(state) {
      for (const type of ALL_EVAL_TYPES) {
        state.evals[type] = createEmptyEntry();
      }
    },
  },
  selectors: {
    selectEvals: (state) => state.evals,
  },
});

export const {
  evalStarted,
  evalSucceeded,
  evalFailed,
  evalRetryRequested,
  evalCleared,
  allEvalsCleared,
} = evaluationSlice.actions;

export const { selectEvals } = evaluationSlice.selectors;
