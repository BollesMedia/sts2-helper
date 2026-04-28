// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { configureStore, combineSlices, createListenerMiddleware } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { render, screen, waitFor } from "@testing-library/react";
import type { MapState, MultiplayerFields } from "@sts2/shared/types/game-state";

/**
 * Happy-path integration test for the map-coach evaluation chain (#80).
 *
 * Pins contract alignment across the full pipeline that per-task tests miss
 * at the boundaries:
 *
 *   gameStateReceived(map)
 *     → setupMapEvalListener (real listener)
 *       → buildMapPrompt (real)
 *         → /api/evaluate (mocked apiFetch returns mapCoachOutputSchema-shaped payload)
 *           → adaptMapCoach (real adapter inside evaluationApi)
 *             → evalSucceeded → evaluationSlice
 *               → MapView render — headline in sidebar + SVG halo on best option
 *
 * The existing per-layer tests cover slices with preloaded state and the route
 * with a mocked LLM. This test catches drift at the seams (e.g. an adapter
 * shape mismatch that the adapter unit test passes but the rendered sidebar
 * silently misses), with one realistic fixture rather than a per-state-type
 * matrix.
 */

// ---- Mocks (must precede listener import) ----

// Single network seam — every endpoint in evaluationApi goes through `apiFetch`.
// We capture calls and return a canned `mapCoachOutputSchema`-shaped payload
// for `/api/evaluate`; everything else returns a benign empty 200 so
// non-target endpoints (logChoice, etc.) don't blow up on `res.json()`.
const { apiFetchMock, mapEvaluatePayload } = vi.hoisted(() => {
  const mapEvaluatePayload = {
    reasoning: {
      risk_capacity: "Moderate HP buffer; can take one elite this floor.",
      act_goal: "Reach the boss above 70% HP with one extra relic.",
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
  return { apiFetchMock, mapEvaluatePayload };
});

vi.mock("@sts2/shared/lib/api-client", () => ({
  apiFetch: apiFetchMock,
  setApiBaseUrl: vi.fn(),
  setAccessTokenGetter: vi.fn(),
  setFetchImplementation: vi.fn(),
  apiUrl: (p: string) => p,
}));

// `waitForRunCreated` is a real promise resolved by the `startRun` analytics
// listener in production. Resolve immediately so the choice-write `.then()`
// fires on the next microtask without us wiring the analytics listener.
vi.mock("../../features/run/runAnalyticsListener", async () => {
  const actual = await vi.importActual<
    typeof import("../../features/run/runAnalyticsListener")
  >("../../features/run/runAnalyticsListener");
  return {
    ...actual,
    waitForRunCreated: () => Promise.resolve(),
  };
});

// `setupMapEvalListener` calls `startAppListening` at import time; it's bound
// to the real production store, so we proxy the call through to a freshly
// constructed test listener middleware via `rebindStartAppListening`.
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

// Dev logger talks to Tauri; no-op so tests stay clean.
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
import { MapView } from "../../views/map/map-view";
import { TEST_NODES, TEST_BOSS } from "../fixtures/map-state";

// ---- Test store factory (mirrors production combineSlices order) ----

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

  const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware()
        .prepend(listenerMiddleware.middleware)
        .concat(gameStateApi.middleware)
        .concat(evaluationApi.middleware),
  });

  return store;
}

// ---- Fixture builders ----

/**
 * Build the realistic map state used by the test. Topology mirrors the small
 * 4-row test map shared with the slice tests:
 *
 *   Row 3:           [1,3 Boss]
 *                      ↑    ↑
 *   Row 2: [0,2 Rest]      [2,2 Monster]
 *           ↑                ↑
 *   Row 1: [0,1 Elite]      [2,1 Shop]
 *           ↑                ↑
 *   Row 0:        [1,0 Monster]   ← current
 *
 * The coach response narrates `0,1 → 0,2 → 1,3`, so the SVG halo should land
 * on the Elite at (0,1) and the rendered sidebar should display the
 * coach's headline + summary post-adapter.
 */
function buildHappyPathMapState(): MapState & MultiplayerFields {
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

/** Seed the run slice with deck/player/run for the listener to read. */
function seedRun(store: ReturnType<typeof createIntegrationStore>): void {
  store.dispatch(
    runStarted({
      runId: "run_test_map_eval_integration",
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

// ---- Test ----

describe("map-eval flow — listener → /api/evaluate → adapter → slice → MapView (#80)", () => {
  beforeEach(() => {
    apiFetchMock.mockClear();
    clearEvaluationRegistry();
    localStorage.clear();
  });

  it("dispatches map state, hits /api/evaluate, and renders sidebar headline + green SVG halo on the best option", async () => {
    const store = createIntegrationStore();
    setupMapEvalListener();
    seedRun(store);

    const mapState = buildHappyPathMapState();
    store.dispatch(gameStateReceived(mapState));

    // Wait for the eval pipeline: listener fires async, hits /api/evaluate,
    // adapts the response, dispatches evalSucceeded. The slice transitions
    // from isLoading=true (after evalStarted) to a populated result.
    await waitFor(() => {
      const mapEntry = selectEvals(store.getState()).map;
      expect(mapEntry.result).not.toBeNull();
      expect(mapEntry.isLoading).toBe(false);
    });

    // Boundary check #1 — adapter pass: snake_case wire shape became camelCase
    // on the slice, with the macro_path floors mapped through.
    const result = selectEvals(store.getState()).map.result as {
      headline: string;
      macroPath: { floors: { nodeId: string }[]; summary: string };
      reasoning: { riskCapacity: string; actGoal: string };
    };
    expect(result.headline).toBe("Take the elite for the relic.");
    expect(result.macroPath.floors[0].nodeId).toBe("0,1");
    expect(result.reasoning.riskCapacity).toContain("Moderate HP buffer");

    // Boundary check #2 — `/api/evaluate` was actually called with the real
    // prompt (built by `buildMapPrompt`), not skipped by some gate.
    const evaluateCalls = apiFetchMock.mock.calls.filter(
      ([path]) => path === "/api/evaluate",
    );
    expect(evaluateCalls.length).toBe(1);

    // Boundary check #3 — render the view against the SAME store and assert
    // the rendered sidebar reflects the slice contents end-to-end.
    const { container } = render(
      <Provider store={store}>
        <MapView state={mapState} />
      </Provider>,
    );

    // Sidebar: headline + path summary from the coach response post-adapter.
    expect(screen.getByText("Take the elite for the relic.")).toBeTruthy();
    expect(screen.getByText("Elite then rest, recover before boss.")).toBeTruthy();

    // SVG halo: bestOptionKey resolves to "0,1" (macro_path[0]), so a green
    // best-edge stroke (#34d399, width 3) is drawn from current to (0,1).
    const greenBestEdges = Array.from(container.querySelectorAll("line")).filter(
      (line) =>
        line.getAttribute("stroke") === "#34d399" &&
        line.getAttribute("stroke-width") === "3",
    );
    expect(greenBestEdges).toHaveLength(1);

    // The Best badge appears on exactly one option chip — the Elite.
    const bestBadges = Array.from(container.querySelectorAll("span")).filter(
      (s) => s.textContent === "Best",
    );
    expect(bestBadges).toHaveLength(1);
  });
});
