import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { apiFetch } from "@sts2/shared/lib/api-client";
import type { CardRewardEvaluation, EvaluationContext } from "@sts2/shared/evaluation/types";
import type { TierLetter } from "@sts2/shared/evaluation/tier-utils";
import type { MapPathEvaluation } from "../lib/eval-inputs/map";

// --- Request types ---

interface EvalRequestBase {
  context: EvaluationContext;
  runNarrative?: string | null;
  runId?: string | null;
  gameVersion?: string | null;
  userId?: string | null;
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

/** Raw response from map-style eval endpoints (event, rest_site) — snake_case */
interface MapEvalRawResponse {
  rankings: {
    item_id: string;
    rank: number;
    tier: string;
    synergy_score: number;
    confidence: number;
    recommendation: string;
    reasoning: string;
  }[];
  skip_recommended?: boolean;
  skip_reasoning?: string | null;
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
            userId: args.userId,
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
            userId: args.userId,
            gameVersion: args.gameVersion,
          });
          return { data };
        } catch (err) {
          return { error: { status: "CUSTOM_ERROR", data: err instanceof Error ? err.message : "Eval failed" } };
        }
      },
    }),

    // Event evaluation — returns raw map-style response (snake_case rankings)
    evaluateEvent: build.mutation<MapEvalRawResponse, MapPromptRequest>({
      async queryFn(args) {
        try {
          const data = await evalFetch<MapEvalRawResponse>({
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

    // Rest site evaluation — returns raw map-style response (snake_case rankings)
    evaluateRestSite: build.mutation<MapEvalRawResponse, MapPromptRequest>({
      async queryFn(args) {
        try {
          const data = await evalFetch<MapEvalRawResponse>({
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

    // Map path evaluation — transforms snake_case API response to camelCase
    evaluateMap: build.mutation<MapPathEvaluation, MapPromptRequest>({
      async queryFn(args) {
        try {
          const raw = await evalFetch<Record<string, unknown>>({
            type: "map",
            evalType: "map",
            context: args.context,
            runNarrative: args.runNarrative,
            mapPrompt: args.mapPrompt,
            runId: args.runId,
            gameVersion: args.gameVersion,
          });
          const rawPrefs = raw.node_preferences as Record<string, number> | undefined;
          const data: MapPathEvaluation = {
            rankings: ((raw.rankings as Array<Record<string, unknown>>) ?? []).map((r) => ({
              optionIndex: r.option_index as number,
              nodeType: r.node_type as string,
              tier: (r.tier as string).toUpperCase() as TierLetter,
              confidence: r.confidence as number,
              recommendation: r.recommendation as string,
              reasoning: r.reasoning as string,
            })),
            overallAdvice: (raw.overall_advice as string) ?? null,
            recommendedPath: Array.isArray(raw.recommended_path)
              ? (raw.recommended_path as Array<{ col: number; row: number }>).map((p) => ({ col: p.col, row: p.row }))
              : [],
            nodePreferences: rawPrefs
              ? {
                  monster: rawPrefs.monster ?? 0.4,
                  elite: rawPrefs.elite ?? 0.5,
                  shop: rawPrefs.shop ?? 0.5,
                  rest: rawPrefs.rest ?? 0.6,
                  treasure: rawPrefs.treasure ?? 0.9,
                  event: rawPrefs.event ?? 0.5,
                }
              : null,
          };
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
      narrative?: unknown;
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
    logChoice: build.mutation<void, {
      runId: string | null;
      choiceType: string;
      floor: number;
      act?: number;
      offeredItemIds: string[];
      chosenItemId: string | null;
      recommendedItemId?: string | null;
      recommendedTier?: string | null;
      wasFollowed?: boolean;
      rankingsSnapshot?: unknown;
      userId?: string | null;
    }>({
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
