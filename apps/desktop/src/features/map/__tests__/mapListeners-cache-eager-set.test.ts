import { describe, it, expect, beforeEach, vi } from "vitest";
import { configureStore, combineSlices, createListenerMiddleware } from "@reduxjs/toolkit";
import type { MapState } from "@sts2/shared/types/game-state";

/**
 * Behavioral regression test for issue #97 / PR #95 (eager run-state cache).
 *
 * The map listener writes the computed `RunState` to a module-private cache
 * (`lastMapRunState`) BEFORE the early-return gates that would otherwise
 * skip the eval pipeline. The choice-write block reads that cache to populate
 * `runStateSnapshot` on `/api/choice` payloads. If the eager `set(...)` is
 * moved BELOW any gate, then on the first listener fire of a run the cache
 * stays empty when that gate short-circuits — and the next `map_node` choice
 * is persisted with a null `runStateSnapshot`, the bug PR #95 fixed.
 *
 * The reviewer of PR #122 rejected an earlier source-order parsing test as
 * brittle (rename the cache, refactor the gate into a helper, or invert the
 * `if (!shouldEval)` polarity, and a structural test silently passes). This
 * replacement asserts the OBSERVABLE behaviour: build a real store with
 * `setupMapEvalListener`, intercept `/api/choice` requests via a mocked
 * `apiFetch`, and check that the captured payload's `runStateSnapshot` is
 * non-null after each gate short-circuits.
 *
 * Coverage:
 *  - Gate 1 (shouldEvaluateMap → false): tested directly.
 *  - Gate 3 (evalKey dedup): tested directly.
 *  - Gate 2 (narrator on-track): tested SHALLOWLY — the gate cannot fire
 *    unless `lastNarratedPathByRun` is populated, which only happens via a
 *    successful eval, and that same code path ALSO writes `lastMapRunState`.
 *    A behavioural regression that empties the cache when only gate 2 fires
 *    is therefore impossible in production. The gate-2 test asserts the
 *    listener still produces a non-null `runStateSnapshot` after the warmup
 *    + gate cycle, which is a smoke test for the wiring.
 *
 * Fixtures are shaped so that the eval pipeline's OWN cache write (the
 * second `lastMapRunState.set(...)` inside the success-path try block) does
 * NOT run on the gate-1 / gate-3 tests — every dispatched `gameStateReceived`
 * is a state that short-circuits at the gate under test. That makes the
 * eager set the only writer for those tests, so a regression that disables
 * it produces a sharply-failing assertion.
 */

// ---- Mocks ----

// `apiFetch` is the single network seam — every endpoint in evaluationApi
// goes through it. Capture per-path bodies; default to a benign empty
// response so non-target endpoints don't blow up on `res.json()`.
const { apiFetchMock, getCalls } = vi.hoisted(() => {
  const calls: { path: string; body: unknown }[] = [];
  const apiFetchMock = vi.fn(async (path: string, init: { body?: string }) => {
    let body: unknown;
    try {
      body = init.body ? JSON.parse(init.body) : null;
    } catch {
      body = init.body;
    }
    calls.push({ path, body });
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response;
  });
  return {
    apiFetchMock,
    getCalls: () => calls,
  };
});

vi.mock("@sts2/shared/lib/api-client", () => ({
  apiFetch: apiFetchMock,
  setApiBaseUrl: vi.fn(),
  setAccessTokenGetter: vi.fn(),
  setFetchImplementation: vi.fn(),
  apiUrl: (p: string) => p,
}));

// `waitForRunCreated` is a real promise tied to a real `startRun` dispatch
// in production. Resolve it immediately so the `.then()` that wraps the
// `logChoice` dispatch fires on the next microtask.
vi.mock("../../run/runAnalyticsListener", async () => {
  const actual = await vi.importActual<typeof import("../../run/runAnalyticsListener")>(
    "../../run/runAnalyticsListener",
  );
  return {
    ...actual,
    waitForRunCreated: () => Promise.resolve(),
  };
});

// Replace the production `startAppListening` (bound to the real store) with a
// listener middleware bound to the test store. The map listener pulls in
// `startAppListening` at module load time, so this mock is a stand-in that
// the test rebinds after `createTestStore` runs.
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

vi.mock("../../../store/listenerMiddleware", () => ({
  startAppListening: startAppListeningProxy,
}));

// The dev logger calls Tauri APIs on init; `logDevEvent` and `logReduxSnapshot`
// no-op when not initialized, but stub them out anyway so the test environment
// never touches the Tauri bridge.
vi.mock("../../../lib/dev-logger", () => ({
  logDevEvent: vi.fn(),
  logReduxSnapshot: vi.fn(),
}));

// ---- Imports that depend on the mocks above ----

import { setupMapEvalListener } from "../mapListeners";
import {
  runSlice,
  runStarted,
  deckUpdated,
  playerUpdated,
  mapEvalUpdated,
} from "../../run/runSlice";
import { gameStateSlice, gameStateReceived } from "../../gameState/gameStateSlice";
import { evaluationSlice, evalStarted } from "../../evaluation/evaluationSlice";
import { evaluationApi } from "../../../services/evaluationApi";
import { gameStateApi } from "../../../services/gameStateApi";
import { connectionSlice } from "../../connection/connectionSlice";
import { computeMapEvalKey } from "../../../lib/eval-inputs/map";
import { clearEvaluationRegistry } from "@sts2/shared/evaluation/last-evaluation-registry";

// ---- Test store factory ----

function createTestStore() {
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

let runCounter = 0;
function nextRunId(): string {
  runCounter += 1;
  return `run_test_eager_cache_${runCounter}`;
}

/**
 * Seed an active run with a deck, player, AND a non-null `lastEvalContext` so
 * `shouldEvaluateMap` sees `hasPrevContext = true`. Without that seed, the
 * very first `gameStateReceived` slips past gate 1 (init eval), runs the full
 * pipeline, and the pipeline's success-path `lastMapRunState.set(...)` masks
 * any regression in the eager set. With the seed in place, every dispatched
 * map state is gated at the chosen short-circuit and only the eager set can
 * populate the cache.
 */
function seedRun(
  store: ReturnType<typeof createTestStore>,
  runId: string,
): void {
  store.dispatch(
    runStarted({
      runId,
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
      relics: [{ id: "burning_blood", name: "Burning Blood", description: "Heal 6 at end of combat." }],
      potions: [],
      potionSlotCap: null,
      cardRemovalCost: 75,
    }),
  );
  store.dispatch(
    mapEvalUpdated({
      lastEvalContext: {
        hpPercent: 0.875,
        deckSize: 3,
        act: 1,
        gold: 99,
        ascension: 0,
      },
    }),
  );
}

/**
 * Build a minimal MapState. Fixture nodes form a single column (col 0) with
 * the boss at row 4; `next_options` are appended to it so `buildMapPrompt`
 * has a non-empty future-nodes set.
 */
function buildMapState(opts: {
  currentPosition: { col: number; row: number };
  nextOptions: { col: number; row: number; type: string }[];
  act?: number;
}): MapState {
  const { currentPosition, nextOptions } = opts;
  const allNodes = [
    { col: 0, row: 0, type: "Monster", children: [[0, 1] as [number, number]] },
    { col: 0, row: 1, type: "Monster", children: [[0, 2] as [number, number]] },
    { col: 0, row: 2, type: "Monster", children: [[0, 3] as [number, number]] },
    { col: 0, row: 3, type: "Monster", children: [] },
    ...nextOptions.map((o) => ({
      col: o.col,
      row: o.row,
      type: o.type,
      children: [] as [number, number][],
    })),
  ];
  return {
    state_type: "map",
    player: {
      character: "Ironclad",
      hp: 70,
      max_hp: 80,
      gold: 99,
    },
    map: {
      current_position: { ...currentPosition, type: "Monster" },
      visited: [],
      next_options: nextOptions.map((o, i) => ({ ...o, index: i, leads_to: [] })),
      nodes: allNodes,
      boss: { col: 0, row: 4 },
    },
    run: { act: opts.act ?? 1, floor: currentPosition.row, ascension: 0 },
  };
}

/** Pull the body of every captured /api/choice POST. */
function getChoiceBodies(): Record<string, unknown>[] {
  return getCalls()
    .filter((c) => c.path === "/api/choice")
    .map((c) => c.body as Record<string, unknown>);
}

/** Pull every captured /api/evaluate POST — used to assert the eval pipeline did NOT run. */
function getEvaluateBodies(): unknown[] {
  return getCalls().filter((c) => c.path === "/api/evaluate").map((c) => c.body);
}

/** Wait for the listener's effect (and its `waitForRunCreated().then()`) to settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

// ---- Tests ----

describe("setupMapEvalListener — eager run-state cache (#97)", () => {
  beforeEach(() => {
    apiFetchMock.mockClear();
    apiFetchMock.mockImplementation(async (path: string, init: { body?: string }) => {
      let body: unknown;
      try {
        body = init.body ? JSON.parse(init.body) : null;
      } catch {
        body = init.body;
      }
      getCalls().push({ path, body });
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });
    getCalls().length = 0;
    clearEvaluationRegistry();
    localStorage.clear();
  });

  it("populates runStateSnapshot when shouldEvaluateMap gate short-circuits (single-option row)", async () => {
    const store = createTestStore();
    setupMapEvalListener();
    // Each test uses a fresh runId so the runStarted listener clears
    // `lastMapRunState` for THIS runId — guards against module-level state
    // leaking from prior tests in the same vitest worker.
    const runId = nextRunId();
    seedRun(store, runId);

    // First map state: cold cache, position (0,0). Single-option row + seeded
    // hasPrevContext=true → shouldEvaluateMap returns false → gate 1 fires.
    // No previous position → choice block produces no outcome. prevMapPosition
    // is set to (0,0). The success-path cache write does NOT run.
    const state1 = buildMapState({
      currentPosition: { col: 0, row: 0 },
      nextOptions: [{ col: 0, row: 1, type: "Monster" }],
    });
    store.dispatch(gameStateReceived(state1));
    await flush();

    expect(getChoiceBodies()).toHaveLength(0);
    // Sanity: gate 1 fired, eval pipeline did NOT run.
    expect(getEvaluateBodies()).toHaveLength(0);

    // Second map state: position moves (0,0) → (0,1). Choice block fires.
    // Single option ahead → gate 1 short-circuits the eval pipeline again.
    // The choice's runStateSnapshot is the eager-cached value.
    const state2 = buildMapState({
      currentPosition: { col: 0, row: 1 },
      nextOptions: [{ col: 0, row: 2, type: "Monster" }],
    });
    store.dispatch(gameStateReceived(state2));
    await flush();

    // Sanity: still no eval pipeline run, so any non-null runStateSnapshot
    // had to come from the eager set.
    expect(getEvaluateBodies()).toHaveLength(0);

    const choices = getChoiceBodies();
    expect(choices).toHaveLength(1);
    expect(choices[0].choiceType).toBe("map_node");
    // The actual assertion: snapshot is present even though gate 1 short-
    // circuited the eval pipeline. If the eager set is moved below
    // `if (!shouldEval) return;`, the cache stays empty for this run on
    // the first cycle and runStateSnapshot becomes null.
    expect(choices[0].runStateSnapshot).not.toBeNull();
    expect(choices[0].runStateSnapshot).toBeDefined();
  });

  it("populates runStateSnapshot when evalKey dedup gate short-circuits", async () => {
    const store = createTestStore();
    setupMapEvalListener();
    const runId = nextRunId();
    seedRun(store, runId);

    // Pre-arm the evaluationSlice with the evalKey BOTH map states will
    // compute (same `next_options`). The dedup check is
    // `currentKey === evalKey` — when it matches, the listener returns
    // BEFORE the success-path cache write.
    const sharedOptions = [
      { col: 0, row: 1, type: "Monster" },
      { col: 1, row: 1, type: "Elite" },
    ];
    const evalKey = computeMapEvalKey(
      sharedOptions.map((o, i) => ({ ...o, index: i, leads_to: [] })),
    );
    store.dispatch(evalStarted({ evalType: "map", evalKey }));

    // First map state: seeds prevMapPosition. Same options → evalKey matches
    // → gate 3 fires. No prev position → no choice. No success-path write.
    const state1 = buildMapState({
      currentPosition: { col: 0, row: 0 },
      nextOptions: sharedOptions,
    });
    store.dispatch(gameStateReceived(state1));
    await flush();

    expect(getChoiceBodies()).toHaveLength(0);
    expect(getEvaluateBodies()).toHaveLength(0);

    // Second state: position moves. Same options → still matches stored
    // evalKey → gate 3 fires again. Choice fires with eager-cached snapshot.
    const state2 = buildMapState({
      currentPosition: { col: 0, row: 1 },
      nextOptions: sharedOptions,
    });
    store.dispatch(gameStateReceived(state2));
    await flush();

    expect(getEvaluateBodies()).toHaveLength(0);
    const choices = getChoiceBodies();
    expect(choices).toHaveLength(1);
    expect(choices[0].choiceType).toBe("map_node");
    expect(choices[0].runStateSnapshot).not.toBeNull();
    expect(choices[0].runStateSnapshot).toBeDefined();
  });

  it("populates runStateSnapshot when the narrator on-track gate fires after a successful eval", async () => {
    // The narrator gate cannot be hit on a cold cache — it requires
    // `lastNarratedPathByRun` to be populated, and the only writer for that
    // map is the success-path `evaluateMap` block (line 502 in mapListeners),
    // which ALSO writes `lastMapRunState` two lines apart. So this test is
    // necessarily a SMOKE TEST for the wiring rather than a sharp regression
    // catch — it confirms the choice payload still carries a non-null
    // `runStateSnapshot` after a warmup eval + a follow-up move that lands
    // on a narrated node. A regression that empties the cache before the
    // narrator gate is impossible to produce in real code without also
    // breaking gate 1 or gate 3 (those tests catch the regression sharply).

    const store = createTestStore();
    setupMapEvalListener();
    const runId = nextRunId();
    seedRun(store, runId);

    // Configure /api/evaluate to return a valid map coach payload that
    // narrates node "0,1". The desktop adapter expects snake_case fields.
    apiFetchMock.mockImplementation(async (path: string, init: { body?: string }) => {
      let body: unknown = null;
      try { body = init.body ? JSON.parse(init.body) : null; } catch { /* ignore */ }
      getCalls().push({ path, body });
      if (path === "/api/evaluate") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            reasoning: { risk_capacity: "moderate", act_goal: "elite then heal" },
            headline: "Stay left",
            confidence: 0.7,
            macro_path: {
              floors: [{ floor: 1, node_type: "monster", node_id: "0,1" }],
              summary: "Take the monster on the left.",
            },
            key_branches: [],
            teaching_callouts: [],
          }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });

    // Warmup: clear lastEvalContext so shouldEvaluateMap returns true on
    // the warmup state, run a multi-option fork to trigger the eval, then
    // re-pin lastEvalContext for the gate cycle.
    store.dispatch(mapEvalUpdated({ lastEvalContext: null }));
    const warmupOptions = [
      { col: 0, row: 1, type: "Monster" },
      { col: 1, row: 1, type: "Elite" },
    ];
    const warmupState = buildMapState({
      currentPosition: { col: 0, row: 0 },
      nextOptions: warmupOptions,
    });
    store.dispatch(gameStateReceived(warmupState));
    for (let i = 0; i < 50; i++) await Promise.resolve();

    store.dispatch(
      mapEvalUpdated({
        lastEvalContext: {
          hpPercent: 0.875,
          deckSize: 3,
          act: 1,
          gold: 99,
          ascension: 0,
        },
      }),
    );
    getCalls().length = 0;

    // Gate cycle: player moves (0,0) → (0,1). Same act, eager-compliance
    // computed, winner-first-node "0,1" matches the warmup's narrated path
    // → narrator gate's `onTrack` branch returns. Choice fires before the
    // gate, so the payload reads the eager-cached state.
    const gateState = buildMapState({
      currentPosition: { col: 0, row: 1 },
      nextOptions: [
        { col: 0, row: 2, type: "Monster" },
        { col: 1, row: 2, type: "Elite" },
      ],
    });
    store.dispatch(gameStateReceived(gateState));
    await flush();

    const choices = getChoiceBodies();
    expect(choices).toHaveLength(1);
    expect(choices[0].choiceType).toBe("map_node");
    expect(choices[0].runStateSnapshot).not.toBeNull();
    expect(choices[0].runStateSnapshot).toBeDefined();
  });
});
