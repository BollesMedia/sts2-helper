import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { apiFetch } from "@sts2/shared/lib/api-client";
import type { CardRewardEvaluation, EvaluationContext } from "@sts2/shared/evaluation/types";
import {
  mapEvalResponseSchema,
  genericEvalSchema,
  type GenericEvalRaw,
} from "@sts2/shared/evaluation/eval-schemas";
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

// Fallback recommendation when the model omits it — mirrors the derivation
// in `@sts2/shared/evaluation/parse-tool-response.ts:toCardRewardEvaluation`.
function deriveRecommendationFromTier(
  tier: "S" | "A" | "B" | "C" | "D" | "F",
): "strong_pick" | "good_pick" | "situational" | "skip" {
  if (tier === "S" || tier === "A") return "strong_pick";
  if (tier === "B") return "good_pick";
  if (tier === "C") return "situational";
  return "skip";
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

    // Event evaluation — returns the validated generic eval shape (snake_case).
    evaluateEvent: build.mutation<GenericEvalRaw, MapPromptRequest>({
      async queryFn(args) {
        try {
          const raw = await evalFetch<unknown>({
            type: "map",
            evalType: args.evalType ?? "event",
            context: args.context,
            runNarrative: args.runNarrative,
            mapPrompt: args.mapPrompt,
            runId: args.runId,
            gameVersion: args.gameVersion,
          });
          return { data: genericEvalSchema.parse(raw) };
        } catch (err) {
          return { error: { status: "CUSTOM_ERROR", data: err instanceof Error ? err.message : "Eval failed" } };
        }
      },
    }),

    // Rest site evaluation — returns the validated generic eval shape (snake_case).
    evaluateRestSite: build.mutation<GenericEvalRaw, MapPromptRequest>({
      async queryFn(args) {
        try {
          const raw = await evalFetch<unknown>({
            type: "map",
            evalType: args.evalType ?? "rest_site",
            context: args.context,
            runNarrative: args.runNarrative,
            mapPrompt: args.mapPrompt,
            runId: args.runId,
            gameVersion: args.gameVersion,
          });
          return { data: genericEvalSchema.parse(raw) };
        } catch (err) {
          return { error: { status: "CUSTOM_ERROR", data: err instanceof Error ? err.message : "Eval failed" } };
        }
      },
    }),

    // Map path evaluation — parses with zod then transforms to camelCase.
    evaluateMap: build.mutation<MapPathEvaluation, MapPromptRequest>({
      async queryFn(args) {
        try {
          const raw = await evalFetch<unknown>({
            type: "map",
            evalType: "map",
            context: args.context,
            runNarrative: args.runNarrative,
            mapPrompt: args.mapPrompt,
            runId: args.runId,
            gameVersion: args.gameVersion,
          });
          const parsed = mapEvalResponseSchema.parse(raw);
          const data: MapPathEvaluation = {
            rankings: parsed.rankings.map((r) => ({
              optionIndex: r.option_index,
              nodeType: r.node_type ?? "",
              tier: r.tier,
              confidence: r.confidence,
              recommendation: r.recommendation ?? deriveRecommendationFromTier(r.tier),
              reasoning: r.reasoning,
            })),
            overallAdvice: parsed.overall_advice,
            // recommendedPath is populated client-side by the map retrace
            // listener (mapPathRetraced). Haiku's tool schema has never
            // included it — the old `raw.recommended_path` reader was
            // dead code that always returned []. Initialize empty.
            recommendedPath: [],
            nodePreferences: parsed.node_preferences,
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
      sequence?: number;
      offeredItemIds: string[];
      chosenItemId: string | null;
      recommendedItemId?: string | null;
      recommendedTier?: string | null;
      wasFollowed?: boolean;
      rankingsSnapshot?: unknown;
      userId?: string | null;
      gameContext?: unknown;
      evalPending?: boolean;
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

    // Act path logging
    logActPath: build.mutation<void, {
      runId: string;
      act: number;
      recommendedPath: { col: number; row: number; nodeType: string }[];
      actualPath: { col: number; row: number; nodeType: string }[];
      nodePreferences?: unknown;
      deviationCount: number;
      deviationNodes: { col: number; row: number; recommended: string; actual: string }[];
      contextAtStart?: unknown;
    }>({
      async queryFn(args) {
        try {
          await apiFetch("/api/act-path", {
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
  useLogActPathMutation,
} = evaluationApi;
