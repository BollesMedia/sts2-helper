import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { apiFetch } from "@sts2/shared/lib/api-client";
import type { CardRewardEvaluation, EvaluationContext } from "@sts2/shared/evaluation/types";
import {
  genericEvalSchema,
  type GenericEvalRaw,
} from "@sts2/shared/evaluation/eval-schemas";
import {
  mapCoachOutputSchema,
  type MapCoachOutputRaw,
} from "@sts2/shared/evaluation/map-coach-schema";
import type {
  MapCoachEvaluation,
  MapComplianceInputs,
} from "../lib/eval-inputs/map";

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
  /**
   * Optional run-state snapshot computed desktop-side for map coach evals.
   * Echoed by the server and forwarded to `/api/choice` for persistence.
   */
  runStateSnapshot?: unknown;
  /**
   * Optional inputs for the server-side phase-2 compliance pipeline (repair +
   * rerank). When omitted, the server ships the LLM output without a
   * `compliance` field. Only populated for the map coach eval.
   */
  mapCompliance?: MapComplianceInputs;
}

/** Convert snake_case server output to camelCase client shape. */
function adaptMapCoach(raw: MapCoachOutputRaw): MapCoachEvaluation {
  return {
    reasoning: {
      riskCapacity: raw.reasoning.risk_capacity,
      actGoal: raw.reasoning.act_goal,
    },
    headline: raw.headline,
    confidence: raw.confidence,
    macroPath: {
      floors: raw.macro_path.floors.map((f) => ({
        floor: f.floor,
        nodeType: f.node_type,
        nodeId: f.node_id,
      })),
      summary: raw.macro_path.summary,
    },
    keyBranches: raw.key_branches.map((b) => ({
      floor: b.floor,
      decision: b.decision,
      recommended: b.recommended,
      alternatives: b.alternatives,
      closeCall: b.close_call,
    })),
    teachingCallouts: raw.teaching_callouts,
    compliance: raw.compliance
      ? {
          repaired: raw.compliance.repaired,
          reranked: raw.compliance.reranked,
          rerankReason: raw.compliance.rerank_reason,
          repairReasons: raw.compliance.repair_reasons.map((r) => ({
            kind: r.kind,
            detail: r.detail,
          })),
        }
      : undefined,
  };
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

    // Map coach evaluation — parses with zod then transforms snake→camel.
    // Server also echoes the desktop-computed `runStateSnapshot` back so the
    // caller can forward it to `/api/choice` for persistence.
    evaluateMap: build.mutation<MapCoachEvaluation, MapPromptRequest>({
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
            runStateSnapshot: args.runStateSnapshot,
            mapCompliance: args.mapCompliance,
          });
          // Server response is map-coach output + optional `runStateSnapshot`
          // echo. Strip the echo before zod-parsing since the schema is strict.
          const { runStateSnapshot: _echo, ...rest } = (raw as Record<string, unknown>) ?? {};
          void _echo;
          const parsed = mapCoachOutputSchema.parse(rest);
          return { data: adaptMapCoach(parsed) };
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
    startRun: build.mutation<void, { runId: string; character: string; ascension: number; gameMode: string; userId: string | null; runIdSource?: "save_file" | "client_fallback" | null }>({
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
      runIdSource?: "save_file" | "client_fallback" | null;
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
      /** Optional run-state snapshot — set on map_node choices */
      runStateSnapshot?: unknown;
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
