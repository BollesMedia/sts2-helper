import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { apiFetch } from "@sts2/shared/lib/api-client";
import type { CardRewardEvaluation, EvaluationContext } from "@sts2/shared/evaluation/types";
import type { MapPathEvaluation } from "@sts2/shared/features/map/use-map-evaluation";

// --- Request types ---

interface EvalRequestBase {
  context: EvaluationContext;
  runNarrative?: string | null;
  runId?: string | null;
  gameVersion?: string | null;
}

interface CardRewardRequest extends EvalRequestBase {
  items: {
    id: string;
    name: string;
    description: string;
    cost: number;
    type?: string;
    rarity?: string;
  }[];
  exclusive?: boolean;
  goldBudget?: number;
}

interface ShopRequest extends EvalRequestBase {
  items: {
    id: string;
    name: string;
    description: string;
    cost: number;
    type?: string;
    rarity?: string;
    on_sale?: boolean;
  }[];
  goldBudget?: number;
}

interface MapPromptRequest extends EvalRequestBase {
  evalType?: string;
  mapPrompt: string;
}

// --- Shared fetch helper ---

async function evalFetch<T>(body: Record<string, unknown>): Promise<T> {
  const res = await apiFetch("/api/evaluate", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new Error(errorBody?.detail ?? `Evaluation failed: ${res.status}`);
  }

  return res.json();
}

// --- API definition ---

export const evaluationApi = createApi({
  reducerPath: "evaluationApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (build) => ({
    // Card reward evaluation (pick 1 of 3)
    evaluateCardReward: build.mutation<CardRewardEvaluation, CardRewardRequest>({
      async queryFn(args) {
        try {
          const data = await evalFetch<CardRewardEvaluation>({
            type: "card_reward",
            context: args.context,
            runNarrative: args.runNarrative,
            items: args.items,
            exclusive: args.exclusive ?? true,
            runId: args.runId,
            goldBudget: args.goldBudget,
            gameVersion: args.gameVersion,
          });
          return { data };
        } catch (err) {
          return { error: { status: "CUSTOM_ERROR", data: err instanceof Error ? err.message : "Eval failed" } };
        }
      },
    }),

    // Shop evaluation
    evaluateShop: build.mutation<CardRewardEvaluation, ShopRequest>({
      async queryFn(args) {
        try {
          const data = await evalFetch<CardRewardEvaluation>({
            type: "shop",
            context: args.context,
            runNarrative: args.runNarrative,
            items: args.items,
            goldBudget: args.goldBudget,
            runId: args.runId,
            gameVersion: args.gameVersion,
          });
          return { data };
        } catch (err) {
          return { error: { status: "CUSTOM_ERROR", data: err instanceof Error ? err.message : "Eval failed" } };
        }
      },
    }),

    // Event evaluation
    evaluateEvent: build.mutation<CardRewardEvaluation, MapPromptRequest>({
      async queryFn(args) {
        try {
          const data = await evalFetch<CardRewardEvaluation>({
            type: "map",
            evalType: args.evalType ?? "event",
            context: args.context,
            runNarrative: args.runNarrative,
            mapPrompt: args.mapPrompt,
            runId: args.runId,
            gameVersion: args.gameVersion,
          });
          return { data };
        } catch (err) {
          return { error: { status: "CUSTOM_ERROR", data: err instanceof Error ? err.message : "Eval failed" } };
        }
      },
    }),

    // Rest site evaluation
    evaluateRestSite: build.mutation<CardRewardEvaluation, MapPromptRequest>({
      async queryFn(args) {
        try {
          const data = await evalFetch<CardRewardEvaluation>({
            type: "map",
            evalType: args.evalType ?? "rest_site",
            context: args.context,
            runNarrative: args.runNarrative,
            mapPrompt: args.mapPrompt,
            runId: args.runId,
            gameVersion: args.gameVersion,
          });
          return { data };
        } catch (err) {
          return { error: { status: "CUSTOM_ERROR", data: err instanceof Error ? err.message : "Eval failed" } };
        }
      },
    }),

    // Map path evaluation
    evaluateMap: build.mutation<MapPathEvaluation, MapPromptRequest>({
      async queryFn(args) {
        try {
          const data = await evalFetch<MapPathEvaluation>({
            type: "map",
            evalType: "map",
            context: args.context,
            runNarrative: args.runNarrative,
            mapPrompt: args.mapPrompt,
            runId: args.runId,
            gameVersion: args.gameVersion,
          });
          return { data };
        } catch (err) {
          return { error: { status: "CUSTOM_ERROR", data: err instanceof Error ? err.message : "Eval failed" } };
        }
      },
    }),

    // Boss briefing (no tool use, returns {strategy: string})
    evaluateBossBriefing: build.mutation<{ strategy: string | null }, MapPromptRequest>({
      async queryFn(args) {
        try {
          const data = await evalFetch<{ strategy: string | null }>({
            type: "map",
            evalType: "boss_briefing",
            context: null,
            mapPrompt: args.mapPrompt,
            runId: args.runId,
            gameVersion: args.gameVersion,
          });
          return { data };
        } catch (err) {
          return { error: { status: "CUSTOM_ERROR", data: err instanceof Error ? err.message : "Eval failed" } };
        }
      },
    }),

    // Generic map prompt eval (card removal, card upgrade, card select, relic select)
    evaluateGeneric: build.mutation<Record<string, unknown>, MapPromptRequest>({
      async queryFn(args) {
        try {
          const data = await evalFetch<Record<string, unknown>>({
            type: "map",
            evalType: args.evalType,
            context: args.context,
            runNarrative: args.runNarrative,
            mapPrompt: args.mapPrompt,
            runId: args.runId,
            gameVersion: args.gameVersion,
          });
          return { data };
        } catch (err) {
          return { error: { status: "CUSTOM_ERROR", data: err instanceof Error ? err.message : "Eval failed" } };
        }
      },
    }),

    // Run API calls
    startRun: build.mutation<void, { runId: string; character: string; ascension: number; gameMode: string; userId: string | null }>({
      async queryFn(args) {
        try {
          await apiFetch("/api/run", {
            method: "POST",
            body: JSON.stringify({ action: "start", ...args }),
          });
          return { data: undefined };
        } catch (err) {
          return { error: { status: "CUSTOM_ERROR", data: err instanceof Error ? err.message : "Failed" } };
        }
      },
    }),

    endRun: build.mutation<void, {
      runId: string;
      victory?: boolean;
      finalFloor?: number;
      actReached?: number;
      causeOfDeath?: string | null;
      bossesFought?: string[] | null;
      finalDeck?: string[] | null;
      finalRelics?: string[] | null;
      finalDeckSize?: number | null;
      narrative?: string | null;
      notes?: string;
    }>({
      async queryFn(args) {
        try {
          await apiFetch("/api/run", {
            method: "POST",
            body: JSON.stringify({ action: "end", ...args }),
          });
          return { data: undefined };
        } catch (err) {
          return { error: { status: "CUSTOM_ERROR", data: err instanceof Error ? err.message : "Failed" } };
        }
      },
    }),

    // Choice logging
    logChoice: build.mutation<void, { runId: string; choiceType: string; floor: number; offeredItemIds: string[]; chosenItemId: string | null; recommendedItemId: string | null }>({
      async queryFn(args) {
        try {
          await apiFetch("/api/choice", {
            method: "POST",
            body: JSON.stringify(args),
          });
          return { data: undefined };
        } catch (err) {
          return { error: { status: "CUSTOM_ERROR", data: err instanceof Error ? err.message : "Failed" } };
        }
      },
    }),
  }),
});

export const {
  useEvaluateCardRewardMutation,
  useEvaluateShopMutation,
  useEvaluateEventMutation,
  useEvaluateRestSiteMutation,
  useEvaluateMapMutation,
  useEvaluateBossBriefingMutation,
  useEvaluateGenericMutation,
  useStartRunMutation,
  useEndRunMutation,
  useLogChoiceMutation,
} = evaluationApi;
