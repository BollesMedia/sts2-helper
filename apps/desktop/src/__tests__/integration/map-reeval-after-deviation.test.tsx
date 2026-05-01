// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { configureStore, combineSlices, createListenerMiddleware } from "@reduxjs/toolkit";
import type { MapState, MultiplayerFields } from "@sts2/shared/types/game-state";

/**
 * Regression tests for #134 — re-eval should fire when the player returns
 * to the map at a node off the previously recommended path, regardless of
 * what intermediate state (combat, event, etc.) was visited between two
 * map-state polls.
 *
 * The off-path trigger added in #131 makes this a first-class case in
 * `shouldEvaluateMap`. The listener uses `bestPathNodes` (winner-only)
 * for deviation detection.
 */

// ---- Mocks (must precede listener import) ----

const { apiFetchMock } = vi.hoisted(() => {
  const mapEvaluatePayload = {
    reasoning: {
      risk_capacity: "Healthy buffer.",
      act_goal: "Reach boss above 70% HP.",
    },
    headline: "Take the elite for the relic.",
    confidence: 0.82,
    macro_path: {
      floors: [
        { floor: 1, node_type: "elite" as const, node_id: "0,1" },
        { floor: 2, node_type: "rest" as const, node_id: "0,2" },
        { floor: 3, node_type: "boss" as const, node_id: "1,3" },
      ],
      summary: "Elite then rest, recover before boss.",
    },
    key_branches: [],
    teaching_callouts: [],
  };

  const apiFetchMock = vi.fn(async (path: string) => {
    if (path === "/api/evaluate") {
      return {
        ok: true,
        status: 200,
        json: async () => mapEvaluatePayload,
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response;
  });
  return { apiFetchMock };
});

vi.mock("@sts2/shared/lib/api-client", () => ({
  apiFetch: apiFetchMock,
  setApiBaseUrl: vi.fn(),
  setAccessTokenGetter: vi.fn(),
  setFetchImplementation: vi.fn(),
  apiUrl: (p: string) => p,
}));

vi.mock("../../features/run/runAnalyticsListener", async () => {
  const actual = await vi.importActual<
    typeof import("../../features/run/runAnalyticsListener")
  >("../../features/run/runAnalyticsListener");
  return {
    ...actual,
    waitForRunCreated: () => Promise.resolve(),
  };
});

const { startAppListeningProxy, rebindStartAppListening } = vi.hoisted(() => {
  let real: ((options: unknown) => unknown) | null = null;
  const rebindStartAppListening = (impl: (options: unknown) => unknown) => {
    real = impl;
  };
  const startAppListeningProxy = (options: unknown) => {
    if (!real) throw new Error("startAppListening called before rebind");
    return real(options);
  };
  return { startAppListeningProxy, rebindStartAppListening };
});

vi.mock("../../store/listenerMiddleware", () => ({
  startAppListening: startAppListeningProxy,
}));

vi.mock("../../lib/dev-logger", () => ({
  logDevEvent: vi.fn(),
  logReduxSnapshot: vi.fn(),
}));

// ---- Imports that depend on the mocks above ----

import { setupMapEvalListener } from "../../features/map/mapListeners";
import {
  runSlice,
  runStarted,
  deckUpdated,
  playerUpdated,
} from "../../features/run/runSlice";
import { gameStateSlice, gameStateReceived } from "../../features/gameState/gameStateSlice";
import {
  evaluationSlice,
  selectEvals,
} from "../../features/evaluation/evaluationSlice";
import { evaluationApi } from "../../services/evaluationApi";
import { gameStateApi } from "../../services/gameStateApi";
import { connectionSlice } from "../../features/connection/connectionSlice";
import { clearEvaluationRegistry } from "@sts2/shared/evaluation/last-evaluation-registry";
import { TEST_NODES, TEST_BOSS } from "../fixtures/map-state";

// ---- Test store factory ----

function createIntegrationStore() {
  const listenerMiddleware = createListenerMiddleware();
  rebindStartAppListening(
    listenerMiddleware.startListening as unknown as (options: unknown) => unknown,
  );

  const rootReducer = combineSlices(
    gameStateApi,
    evaluationApi,
    connectionSlice,
    runSlice,
    evaluationSlice,
    gameStateSlice,
  );

  return configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware()
        .prepend(listenerMiddleware.middleware)
        .concat(gameStateApi.middleware)
        .concat(evaluationApi.middleware),
  });
}

// ---- Fixture builders ----

/** Initial map state — player at the start, two-option fork ahead. */
function buildInitialMapState(): MapState & MultiplayerFields {
  return {
    state_type: "map",
    player: {
      character: "Ironclad",
      hp: 70,
      max_hp: 80,
      gold: 99,
    },
    map: {
      current_position: { col: 1, row: 0, type: "Monster" },
      visited: [{ col: 1, row: 0, type: "Monster" }],
      next_options: [
        {
          index: 0,
          col: 0,
          row: 1,
          type: "Elite",
          leads_to: [{ col: 0, row: 2, type: "RestSite" }],
        },
        {
          index: 1,
          col: 2,
          row: 1,
          type: "Shop",
          leads_to: [{ col: 2, row: 2, type: "Monster" }],
        },
      ],
      nodes: TEST_NODES,
      boss: TEST_BOSS,
    },
    run: { act: 1, floor: 1, ascension: 0 },
  };
}

/**
 * Map state returned to AFTER the deviation encounter — player is now at
 * (2,1) Shop (which the coach did NOT recommend), with next_options being
 * children of (2,1).
 */
function buildPostDeviationMapState(): MapState & MultiplayerFields {
  return {
    state_type: "map",
    player: {
      character: "Ironclad",
      hp: 60,
      max_hp: 80,
      gold: 80,
    },
    map: {
      current_position: { col: 2, row: 1, type: "Shop" },
      visited: [
        { col: 1, row: 0, type: "Monster" },
        { col: 2, row: 1, type: "Shop" },
      ],
      next_options: [
        {
          index: 0,
          col: 2,
          row: 2,
          type: "Monster",
          leads_to: [{ col: 1, row: 3, type: "Boss" }],
        },
      ],
      nodes: TEST_NODES,
      boss: TEST_BOSS,
    },
    run: { act: 1, floor: 2, ascension: 0 },
  };
}

function seedRun(store: ReturnType<typeof createIntegrationStore>): void {
  store.dispatch(
    runStarted({
      runId: "run_test_map_deviation",
      character: "Ironclad",
      ascension: 0,
      gameMode: "singleplayer",
      runIdSource: "client_fallback",
    }),
  );
  store.dispatch(
    deckUpdated([
      { name: "Strike", description: "Deal 6 damage." },
      { name: "Defend", description: "Gain 5 Block." },
      { name: "Bash", description: "Deal 8 damage. Apply 2 Vulnerable." },
    ]),
  );
  store.dispatch(
    playerUpdated({
      character: "Ironclad",
      hp: 70,
      maxHp: 80,
      gold: 99,
      maxEnergy: 3,
      relics: [
        { id: "burning_blood", name: "Burning Blood", description: "Heal 6 at end of combat." },
      ],
      potions: [],
      potionSlotCap: null,
      cardRemovalCost: 75,
    }),
  );
}

async function waitForEvalSettled(
  store: ReturnType<typeof createIntegrationStore>,
): Promise<void> {
  const { waitFor } = await import("@testing-library/react");
  await waitFor(() => {
    const entry = selectEvals(store.getState()).map;
    expect(entry.isLoading).toBe(false);
    expect(entry.result).not.toBeNull();
  });
}

// ---- Test ----

/**
 * Map state at the ancient node — player walked from (1,0) to (0,1) Elite
 * (via combat or event), is now sitting at the next node up. This mirrors
 * the "leave ancient, map eval runs" step in the user's repro: a successful
 * intermediate eval fired, with a fresh recommended path.
 */
function buildPostFirstHopMapState(): MapState & MultiplayerFields {
  return {
    state_type: "map",
    player: {
      character: "Ironclad",
      hp: 70,
      max_hp: 80,
      gold: 99,
    },
    map: {
      current_position: { col: 0, row: 1, type: "Elite" },
      visited: [
        { col: 1, row: 0, type: "Monster" },
        { col: 0, row: 1, type: "Elite" },
      ],
      next_options: [
        {
          index: 0,
          col: 0,
          row: 2,
          type: "RestSite",
          leads_to: [{ col: 1, row: 3, type: "Boss" }],
        },
      ],
      nodes: TEST_NODES,
      boss: TEST_BOSS,
    },
    run: { act: 1, floor: 2, ascension: 0 },
  };
}

describe("map re-eval after off-path deviation (#134)", () => {
  beforeEach(() => {
    apiFetchMock.mockClear();
    clearEvaluationRegistry();
    localStorage.clear();
  });

  it("fires a fresh /api/evaluate when the player returns to the map at a node off the recommended path (no intermediate eval)", async () => {
    const store = createIntegrationStore();
    setupMapEvalListener();
    seedRun(store);

    // 1. Initial map state — first eval fires and resolves with Elite path.
    store.dispatch(gameStateReceived(buildInitialMapState()));
    await waitForEvalSettled(store);

    expect(
      apiFetchMock.mock.calls.filter(([path]) => path === "/api/evaluate").length,
    ).toBe(1);

    const mapEvalAfterFirst = store.getState().run.runs["run_test_map_deviation"]?.mapEval;
    expect(mapEvalAfterFirst?.bestPathNodes).toEqual(
      expect.arrayContaining(["1,0", "0,1", "0,2", "1,3"]),
    );
    expect(mapEvalAfterFirst?.bestPathNodes).not.toContain("2,1");

    // 2. Player picks Shop (2,1) — deviation, NOT on recommended path.
    //    Combat resolves; player returns to the map at the deviation node.
    store.dispatch(gameStateReceived(buildPostDeviationMapState()));

    // 3. Listener should detect the off-path position and fire a second eval.
    await waitForEvalSettled(store);

    const secondCallCount = apiFetchMock.mock.calls.filter(
      ([path]) => path === "/api/evaluate",
    ).length;
    expect(secondCallCount).toBe(2);
  });

  it("fires a re-eval when player deviates AFTER an intermediate on-path eval (matches user repro)", async () => {
    const store = createIntegrationStore();
    setupMapEvalListener();
    seedRun(store);

    // 1. Initial map at (1,0). Eval-1 picks Elite path: (0,1) → (0,2) → (1,3).
    store.dispatch(gameStateReceived(buildInitialMapState()));
    await waitForEvalSettled(store);
    expect(
      apiFetchMock.mock.calls.filter(([p]) => p === "/api/evaluate").length,
    ).toBe(1);

    // 2. Player picks the Elite at (0,1) (on-path) — combat resolves and
    //    they're on the map at (0,1). With a single forced row ahead
    //    [(0,2)], the listener should NOT re-eval here (no meaningful fork,
    //    on-path) — this mirrors the "leave ancient, map eval runs" step.
    store.dispatch(gameStateReceived(buildPostFirstHopMapState()));
    await new Promise((r) => setTimeout(r, 50));

    const mapEvalAfterHop = store.getState().run.runs["run_test_map_deviation"]?.mapEval;
    expect(mapEvalAfterHop?.bestPathNodes ?? []).not.toContain("2,1");

    // 3. Player deviates to (2,1) — but in the underlying map graph (2,1)
    //    is a child of (1,0), not (0,1), so this scenario only models the
    //    SHAPE of "off-path map state arrives" without a graph-valid
    //    transition. The listener doesn't validate graph traversal — it
    //    just reacts to the dispatched map state — so we can still assert
    //    the deviation re-eval behavior fires.
    store.dispatch(gameStateReceived(buildPostDeviationMapState()));
    await waitForEvalSettled(store);

    const finalCount = apiFetchMock.mock.calls.filter(
      ([p]) => p === "/api/evaluate",
    ).length;
    expect(finalCount).toBeGreaterThanOrEqual(2);

    const finalMapEval = store.getState().run.runs["run_test_map_deviation"]?.mapEval;
    expect(finalMapEval?.recommendedPath?.[0]).toEqual({ col: 2, row: 1 });
  });

  it("re-evals on deviation even when the prior LLM macroPath included the deviation node (LLM-multi-floor defense)", async () => {
    // Repro for an LLM-output edge case: if the previous eval's macroPath
    // contained MULTIPLE entries for the same floor (a tree-shaped output
    // instead of a strict per-floor recommendation), `bestPathNodes` would
    // include the deviation node, making `isOnRecommendedPath` evaluate to
    // true and silently suppress the re-eval. Expected: the listener still
    // re-evals after a real deviation.
    //
    // This test installs a one-shot apiFetch that returns a macroPath
    // containing BOTH options at row 1 (`0,1` and `2,1`) for the first
    // call, then returns the normal payload for subsequent calls.
    const dirtyPayload = {
      reasoning: { risk_capacity: "x", act_goal: "y" },
      headline: "x",
      confidence: 0.5,
      macro_path: {
        floors: [
          // Both options at floor 1 — should never happen, but the schema
          // doesn't forbid it. Defensive listener behavior must still treat
          // the player as off-path when they pick a node that isn't the
          // deterministic scorer's winner.
          { floor: 1, node_type: "elite" as const, node_id: "0,1" },
          { floor: 1, node_type: "shop" as const, node_id: "2,1" },
          { floor: 2, node_type: "rest" as const, node_id: "0,2" },
          { floor: 3, node_type: "boss" as const, node_id: "1,3" },
        ],
        summary: "two options at f1",
      },
      key_branches: [],
      teaching_callouts: [],
    };

    let callCount = 0;
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path !== "/api/evaluate") {
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      }
      callCount += 1;
      if (callCount === 1) {
        return { ok: true, status: 200, json: async () => dirtyPayload } as unknown as Response;
      }
      // Subsequent calls — fall back to the normal mock.
      const cleanPayload = {
        reasoning: { risk_capacity: "x", act_goal: "y" },
        headline: "post-deviation",
        confidence: 0.7,
        macro_path: {
          floors: [
            { floor: 2, node_type: "monster" as const, node_id: "2,2" },
            { floor: 3, node_type: "boss" as const, node_id: "1,3" },
          ],
          summary: "from deviation forward",
        },
        key_branches: [],
        teaching_callouts: [],
      };
      return { ok: true, status: 200, json: async () => cleanPayload } as unknown as Response;
    });

    const store = createIntegrationStore();
    setupMapEvalListener();
    seedRun(store);

    // 1. Initial map state. Eval-1 returns the "dirty" macroPath with TWO
    //    floor-1 entries. The listener must dedupe by floor and keep only
    //    the first entry per floor — bestPathNodes should contain (0,1)
    //    but NOT (2,1).
    store.dispatch(gameStateReceived(buildInitialMapState()));
    await waitForEvalSettled(store);

    const mapEvalAfterFirst = store.getState().run.runs["run_test_map_deviation"]?.mapEval;
    expect(mapEvalAfterFirst?.bestPathNodes).toEqual(
      expect.arrayContaining(["1,0", "0,1", "0,2", "1,3"]),
    );
    // Critical invariant: the duplicate floor-1 entry must NOT pollute
    // bestPathNodes. If it did, off-path detection would silently fail.
    expect(mapEvalAfterFirst?.bestPathNodes).not.toContain("2,1");

    // 2. Player picks Shop (2,1) — a real deviation. The listener should
    //    detect the off-path position and fire a second eval.
    store.dispatch(gameStateReceived(buildPostDeviationMapState()));
    await waitForEvalSettled(store);

    const finalCount = apiFetchMock.mock.calls.filter(
      ([p]) => p === "/api/evaluate",
    ).length;
    expect(finalCount).toBeGreaterThanOrEqual(2);
  });
});
