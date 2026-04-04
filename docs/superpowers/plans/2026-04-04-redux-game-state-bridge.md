# Redux Game State Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store MCP game state in a dedicated Redux slice with content-based dedup and history, then migrate all 9 eval listeners to consume the slice instead of RTK Query cache.

**Architecture:** A bridge listener mirrors RTK Query `matchFulfilled` results into a new `gameStateSlice` that tracks current/previous/history with content-based dedup. Eval listener predicates switch from reference-equality comparisons on RTK Query cache to matching the `gameStateReceived` action + state_type filter. Effects read game state from slice selectors.

**Tech Stack:** Redux Toolkit (createSlice, createSelector), RTK Listener Middleware, TypeScript, Vitest

---

## Pre-Implementation: Clean Up Debug Code

Before starting, remove the temporary debug logging and API route added during the map eval investigation.

- [ ] **Step 1: Remove debug code from mapListeners.ts**

In `apps/desktop/src/features/map/mapListeners.ts`, remove the `DEBUG_API` constant, the `debugLog` function, and all `debugLog(...)` calls. Revert the `console.log` calls too. The file should match the committed version at `e8da052` plus the `prevContext?.act ?? 0` fix.

- [ ] **Step 2: Remove debug API route**

Delete the file `apps/web/src/app/api/debug-log/route.ts`.

- [ ] **Step 3: Delete debug log file if it exists**

```bash
rm -f apps/web/debug-map-eval.log
```

- [ ] **Step 4: Verify clean state**

```bash
npx vitest run
npx tsc --noEmit -p apps/desktop/tsconfig.json
```

Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Remove temporary map eval debug logging"
```

---

### Task 1: Content Key Function

**Files:**
- Create: `packages/shared/evaluation/game-state-content-key.ts`
- Test: `apps/desktop/src/lib/__tests__/game-state-content-key.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/desktop/src/lib/__tests__/game-state-content-key.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeGameStateContentKey } from "@sts2/shared/evaluation/game-state-content-key";
import type { GameState } from "@sts2/shared/types/game-state";

describe("computeGameStateContentKey", () => {
  it("produces stable key for map state", () => {
    const state = {
      state_type: "map",
      map: {
        current_position: { col: 2, row: 5, type: "Monster" },
        next_options: [
          { col: 1, row: 6, type: "Monster", index: 0, leads_to: [] },
          { col: 3, row: 6, type: "Elite", index: 1, leads_to: [] },
        ],
        nodes: [],
        boss: { col: 1, row: 15 },
        visited: [],
      },
      run: { act: 1, floor: 5, ascension: 0 },
    } as unknown as GameState;

    const key = computeGameStateContentKey(state);
    expect(key).toBe("map:2,5:1,6|3,6");
  });

  it("returns same key for identical map content with different object refs", () => {
    const make = () =>
      ({
        state_type: "map",
        map: {
          current_position: { col: 2, row: 5, type: "Monster" },
          next_options: [
            { col: 1, row: 6, type: "Monster", index: 0, leads_to: [] },
          ],
          nodes: [],
          boss: { col: 1, row: 15 },
          visited: [],
        },
        run: { act: 1, floor: 5, ascension: 0 },
      }) as unknown as GameState;

    expect(computeGameStateContentKey(make())).toBe(computeGameStateContentKey(make()));
  });

  it("produces key for card_reward state", () => {
    const state = {
      state_type: "card_reward",
      card_reward: { cards: [{ id: "strike" }, { id: "defend" }], can_skip: true },
      run: { act: 1, floor: 3, ascension: 0 },
    } as unknown as GameState;

    const key = computeGameStateContentKey(state);
    expect(key).toBe("card_reward:defend,strike");
  });

  it("produces key for shop state", () => {
    const state = {
      state_type: "shop",
      shop: {
        items: [
          { index: 0, card_id: "havoc", is_stocked: true, can_afford: true },
          { index: 1, card_id: "anger", is_stocked: false, can_afford: true },
        ],
        can_proceed: true,
      },
      run: { act: 1, floor: 6, ascension: 0 },
    } as unknown as GameState;

    const key = computeGameStateContentKey(state);
    expect(key).toContain("shop:");
  });

  it("produces key for event state", () => {
    const state = {
      state_type: "event",
      event: {
        event_id: "big_fish",
        event_name: "Big Fish",
        is_ancient: false,
        in_dialogue: false,
        options: [
          { index: 0, title: "Eat", is_locked: false, is_proceed: false, was_chosen: false },
          { index: 1, title: "Banana", is_locked: false, is_proceed: false, was_chosen: false },
        ],
      },
      run: { act: 1, floor: 4, ascension: 0 },
    } as unknown as GameState;

    const key = computeGameStateContentKey(state);
    expect(key).toBe("event:big_fish:0:false,1:false");
  });

  it("produces key for rest_site state", () => {
    const state = {
      state_type: "rest_site",
      rest_site: {
        options: [
          { id: "rest", index: 0, name: "Rest", is_enabled: true, description: "" },
          { id: "smith", index: 1, name: "Smith", is_enabled: true, description: "" },
        ],
        can_proceed: false,
      },
      run: { act: 1, floor: 7, ascension: 0 },
    } as unknown as GameState;

    const key = computeGameStateContentKey(state);
    expect(key).toBe("rest_site:rest,smith");
  });

  it("produces key for card_select state", () => {
    const state = {
      state_type: "card_select",
      card_select: {
        prompt: "Choose a card to upgrade",
        cards: [{ id: "bash" }, { id: "strike" }],
        screen_type: "grid",
        can_confirm: false,
        can_cancel: false,
      },
      run: { act: 1, floor: 7, ascension: 0 },
    } as unknown as GameState;

    const key = computeGameStateContentKey(state);
    expect(key).toBe("card_select:Choose a card to upgrade:bash,strike");
  });

  it("produces key for relic_select state", () => {
    const state = {
      state_type: "relic_select",
      relic_select: {
        prompt: "Choose a relic",
        relics: [{ id: "vajra", index: 0 }, { id: "bag_of_marbles", index: 1 }],
        can_skip: false,
      },
      run: { act: 1, floor: 8, ascension: 0 },
    } as unknown as GameState;

    const key = computeGameStateContentKey(state);
    expect(key).toBe("relic_select:bag_of_marbles,vajra");
  });

  it("produces key for combat state", () => {
    const state = {
      state_type: "monster",
      battle: {
        round: 2,
        turn: "player",
        is_play_phase: true,
        enemies: [
          { id: "jaw_worm", hp: 30 },
          { id: "cultist", hp: 48 },
        ],
      },
      run: { act: 1, floor: 1, ascension: 0 },
    } as unknown as GameState;

    const key = computeGameStateContentKey(state);
    expect(key).toBe("monster:2:player:cultist:48,jaw_worm:30");
  });

  it("produces fallback key for unknown state type", () => {
    const state = {
      state_type: "menu",
      message: "Main Menu",
    } as unknown as GameState;

    const key = computeGameStateContentKey(state);
    expect(key).toBe("menu:0");
  });

  it("differs when content changes", () => {
    const base = {
      state_type: "card_reward",
      card_reward: { cards: [{ id: "strike" }], can_skip: true },
      run: { act: 1, floor: 3, ascension: 0 },
    } as unknown as GameState;

    const changed = {
      ...base,
      card_reward: { cards: [{ id: "defend" }], can_skip: true },
    } as unknown as GameState;

    expect(computeGameStateContentKey(base)).not.toBe(computeGameStateContentKey(changed));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run apps/desktop/src/lib/__tests__/game-state-content-key.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement computeGameStateContentKey**

Create `packages/shared/evaluation/game-state-content-key.ts`:

```typescript
import type { GameState } from "../types/game-state";
import { computeMapContentKey } from "./map-content-key";

/**
 * Compute a content-based key from a game state.
 *
 * Used by gameStateSlice to dedup identical polls — only dispatches
 * gameStateReceived when the key changes. Each state type includes
 * only the fields that, when changed, should trigger listener re-evaluation.
 */
export function computeGameStateContentKey(state: GameState): string {
  const base = state.state_type;

  switch (state.state_type) {
    case "map":
      return computeMapContentKey(
        state.state_type,
        state.map?.current_position ?? null,
        state.map.next_options
      );

    case "card_reward":
      return `${base}:${state.card_reward.cards.map((c) => c.id).sort().join(",")}`;

    case "shop":
      return `${base}:${state.shop.items.map((i) => `${i.index}:${i.is_stocked}:${i.can_afford}`).sort().join(",")}`;

    case "event":
      return `${base}:${state.event.event_id}:${state.event.options.map((o) => `${o.index}:${o.is_locked}`).join(",")}`;

    case "rest_site":
      return `${base}:${state.rest_site.options.map((o) => o.id).sort().join(",")}`;

    case "card_select":
      return `${base}:${state.card_select.prompt}:${state.card_select.cards.map((c) => c.id).sort().join(",")}`;

    case "relic_select":
      return `${base}:${state.relic_select.relics.map((r) => r.id).sort().join(",")}`;

    case "monster":
    case "elite":
    case "boss":
      return `${base}:${state.battle?.round}:${state.battle?.turn}:${
        state.battle?.enemies?.map((e) => `${e.id}:${e.hp}`).sort().join(",") ?? ""
      }`;

    default:
      return `${base}:${(state as { run?: { floor?: number } }).run?.floor ?? 0}`;
  }
}
```

Note: this imports `computeMapContentKey` from a new shared location. We need to move it.

- [ ] **Step 4: Move computeMapContentKey to shared package**

Create `packages/shared/evaluation/map-content-key.ts`:

```typescript
/**
 * Compute a content-based key for map state.
 *
 * Includes state_type, position, and sorted options so the key is stable
 * across polls with identical content but different object references.
 */
export function computeMapContentKey(
  stateType: string,
  position: { col: number; row: number } | null,
  options: readonly { col: number; row: number }[]
): string {
  const pos = position ? `${position.col},${position.row}` : "null";
  const opts = options.map((o) => `${o.col},${o.row}`).sort().join("|");
  return `${stateType}:${pos}:${opts}`;
}
```

Update `apps/desktop/src/lib/eval-inputs/map.ts` to re-export from the shared package instead of defining its own:

Replace the `computeMapContentKey` function definition with:

```typescript
export { computeMapContentKey } from "@sts2/shared/evaluation/map-content-key";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run apps/desktop/src/lib/__tests__/game-state-content-key.test.ts
npx vitest run apps/desktop/src/lib/eval-inputs/__tests__/compute-map-content-key.test.ts
```

Expected: all pass (existing map content key tests still work via re-export).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/evaluation/game-state-content-key.ts packages/shared/evaluation/map-content-key.ts apps/desktop/src/lib/eval-inputs/map.ts apps/desktop/src/lib/__tests__/game-state-content-key.test.ts apps/desktop/src/lib/eval-inputs/__tests__/compute-map-content-key.test.ts
git commit -m "feat: add computeGameStateContentKey for content-based dedup"
```

---

### Task 2: Game State Slice

**Files:**
- Create: `apps/desktop/src/features/gameState/gameStateSlice.ts`
- Test: `apps/desktop/src/features/gameState/__tests__/gameStateSlice.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/desktop/src/features/gameState/__tests__/gameStateSlice.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  gameStateSlice,
  gameStateReceived,
  selectCurrentGameState,
  selectPreviousGameState,
  selectGameStateType,
  selectGameStateContentKey,
  selectLastMapContentKey,
  selectGameStateHistory,
} from "../gameStateSlice";
import type { GameState } from "@sts2/shared/types/game-state";

const reducer = gameStateSlice.reducer;

function makeMapState(col: number, row: number): GameState {
  return {
    state_type: "map",
    map: {
      current_position: { col, row, type: "Monster" },
      next_options: [{ col: col + 1, row: row + 1, type: "Monster", index: 0, leads_to: [] }],
      nodes: [],
      boss: { col: 1, row: 15 },
      visited: [],
    },
    run: { act: 1, floor: 5, ascension: 0 },
  } as unknown as GameState;
}

function makeShopState(): GameState {
  return {
    state_type: "shop",
    shop: {
      items: [{ index: 0, card_id: "strike", is_stocked: true, can_afford: true }],
      can_proceed: true,
    },
    run: { act: 1, floor: 6, ascension: 0 },
  } as unknown as GameState;
}

function makeCombatState(round: number): GameState {
  return {
    state_type: "monster",
    battle: { round, turn: "player", is_play_phase: true, enemies: [{ id: "jaw_worm", hp: 30 }] },
    run: { act: 1, floor: 3, ascension: 0 },
  } as unknown as GameState;
}

describe("gameStateSlice", () => {
  it("sets current on first dispatch", () => {
    const state = reducer(undefined, gameStateReceived(makeMapState(2, 5)));
    expect(state.current?.state_type).toBe("map");
    expect(state.previous).toBeNull();
  });

  it("shifts current to previous on second dispatch", () => {
    let state = reducer(undefined, gameStateReceived(makeMapState(2, 5)));
    state = reducer(state, gameStateReceived(makeShopState()));
    expect(state.current?.state_type).toBe("shop");
    expect(state.previous?.state_type).toBe("map");
  });

  it("skips update when content key matches (dedup)", () => {
    const map1 = makeMapState(2, 5);
    let state = reducer(undefined, gameStateReceived(map1));
    const map2 = makeMapState(2, 5); // same content, different ref
    state = reducer(state, gameStateReceived(map2));
    // current should still be the first object (no update)
    expect(state.previous).toBeNull();
  });

  it("updates when content key differs", () => {
    let state = reducer(undefined, gameStateReceived(makeMapState(2, 5)));
    state = reducer(state, gameStateReceived(makeMapState(3, 6)));
    expect(state.previous?.state_type).toBe("map");
    expect(state.current?.state_type).toBe("map");
  });

  it("tracks lastMapContentKey only for map states", () => {
    let state = reducer(undefined, gameStateReceived(makeMapState(2, 5)));
    const mapKey = state.lastMapContentKey;
    expect(mapKey).not.toBeNull();

    state = reducer(state, gameStateReceived(makeShopState()));
    // lastMapContentKey preserved across non-map states
    expect(state.lastMapContentKey).toBe(mapKey);
  });

  it("updates lastMapContentKey when map content changes", () => {
    let state = reducer(undefined, gameStateReceived(makeMapState(2, 5)));
    const key1 = state.lastMapContentKey;
    state = reducer(state, gameStateReceived(makeCombatState(1)));
    state = reducer(state, gameStateReceived(makeMapState(3, 6)));
    expect(state.lastMapContentKey).not.toBe(key1);
  });

  it("appends to history in dev mode", () => {
    let state = reducer(undefined, gameStateReceived(makeMapState(2, 5)));
    state = reducer(state, gameStateReceived(makeShopState()));
    // In test env (acts like dev), history should have entries
    expect(state.history.length).toBe(2);
  });

  it("evicts oldest when history exceeds 30", () => {
    let state = reducer(undefined, gameStateReceived(makeCombatState(0)));
    for (let i = 1; i <= 35; i++) {
      state = reducer(state, gameStateReceived(makeCombatState(i)));
    }
    expect(state.history.length).toBeLessThanOrEqual(30);
  });

  describe("selectors", () => {
    it("selectCurrentGameState returns current", () => {
      const sliceState = reducer(undefined, gameStateReceived(makeMapState(2, 5)));
      const rootState = { gameState: sliceState } as any;
      expect(selectCurrentGameState(rootState)?.state_type).toBe("map");
    });

    it("selectPreviousGameState returns previous", () => {
      let sliceState = reducer(undefined, gameStateReceived(makeMapState(2, 5)));
      sliceState = reducer(sliceState, gameStateReceived(makeShopState()));
      const rootState = { gameState: sliceState } as any;
      expect(selectPreviousGameState(rootState)?.state_type).toBe("map");
    });

    it("selectGameStateType returns state_type", () => {
      const sliceState = reducer(undefined, gameStateReceived(makeShopState()));
      const rootState = { gameState: sliceState } as any;
      expect(selectGameStateType(rootState)).toBe("shop");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run apps/desktop/src/features/gameState/__tests__/gameStateSlice.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement gameStateSlice**

Create `apps/desktop/src/features/gameState/gameStateSlice.ts`:

```typescript
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { GameState } from "@sts2/shared/types/game-state";
import { computeGameStateContentKey } from "@sts2/shared/evaluation/game-state-content-key";
import { computeMapContentKey } from "@sts2/shared/evaluation/map-content-key";
import type { MapState } from "@sts2/shared/types/game-state";

const MAX_HISTORY = 30;

export interface GameStateEntry {
  data: GameState;
  contentKey: string;
  receivedAt: number;
}

interface GameStateSliceState {
  current: GameState | null;
  previous: GameState | null;
  contentKey: string | null;
  lastMapContentKey: string | null;
  history: GameStateEntry[];
}

const initialState: GameStateSliceState = {
  current: null,
  previous: null,
  contentKey: null,
  lastMapContentKey: null,
  history: [],
};

export const gameStateSlice = createSlice({
  name: "gameState",
  initialState,
  reducers: {
    gameStateReceived(state, action: PayloadAction<GameState>) {
      const newKey = computeGameStateContentKey(action.payload);

      // Content dedup — skip if identical
      if (newKey === state.contentKey) return;

      // Shift current -> previous
      state.previous = state.current;
      state.current = action.payload;
      state.contentKey = newKey;

      // Track last map content key (persists across non-map states)
      if (action.payload.state_type === "map") {
        const mapState = action.payload as MapState;
        state.lastMapContentKey = computeMapContentKey(
          mapState.state_type,
          mapState.map?.current_position ?? null,
          mapState.map.next_options
        );
      }

      // Dev-only history
      if (import.meta.env.DEV || import.meta.env.MODE === "test") {
        state.history.push({
          data: action.payload,
          contentKey: newKey,
          receivedAt: Date.now(),
        });
        if (state.history.length > MAX_HISTORY) {
          state.history = state.history.slice(-MAX_HISTORY);
        }
      }
    },
  },
  selectors: {
    selectCurrentGameState: (state) => state.current,
    selectPreviousGameState: (state) => state.previous,
    selectGameStateType: (state) => state.current?.state_type ?? null,
    selectGameStateContentKey: (state) => state.contentKey,
    selectLastMapContentKey: (state) => state.lastMapContentKey,
    selectGameStateHistory: (state) => state.history,
  },
});

export const { gameStateReceived } = gameStateSlice.actions;
export const {
  selectCurrentGameState,
  selectPreviousGameState,
  selectGameStateType,
  selectGameStateContentKey,
  selectLastMapContentKey,
  selectGameStateHistory,
} = gameStateSlice.selectors;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run apps/desktop/src/features/gameState/__tests__/gameStateSlice.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/gameState/
git commit -m "feat: add gameStateSlice with content dedup and history"
```

---

### Task 3: Bridge Listener + Store Registration

**Files:**
- Create: `apps/desktop/src/features/gameState/gameStateBridge.ts`
- Modify: `apps/desktop/src/store/store.ts`

- [ ] **Step 1: Create bridge listener**

Create `apps/desktop/src/features/gameState/gameStateBridge.ts`:

```typescript
import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateApi } from "../../services/gameStateApi";
import { gameStateReceived } from "./gameStateSlice";

/**
 * Bridge listener: mirrors RTK Query game state results into gameStateSlice.
 *
 * Must be registered BEFORE all eval listeners so the slice is up-to-date
 * when their predicates fire. The slice reducer handles content-based dedup.
 */
export function setupGameStateBridge() {
  startAppListening({
    matcher: gameStateApi.endpoints.getGameState.matchFulfilled,
    effect: (action, listenerApi) => {
      listenerApi.dispatch(gameStateReceived(action.payload));
    },
  });
}
```

- [ ] **Step 2: Register in store.ts**

Modify `apps/desktop/src/store/store.ts`:

Add imports:

```typescript
import { gameStateSlice } from "../features/gameState/gameStateSlice";
import { setupGameStateBridge } from "../features/gameState/gameStateBridge";
```

Add `gameStateSlice` to `combineSlices`:

```typescript
const rootReducer = combineSlices(
  gameStateApi,
  evaluationApi,
  connectionSlice,
  runSlice,
  evaluationSlice,
  gameStateSlice,
);
```

Add `setupGameStateBridge()` as the FIRST listener registration (before `setupPersistenceListener()`):

```typescript
// Start all listeners
setupGameStateBridge(); // Must be FIRST — slice must be populated before eval listeners fire
setupPersistenceListener();
setupConnectionListeners();
setupGameStateUpdateListener();
setupRunAnalyticsListener();
setupChoiceTrackingListener();
setupMapEvalListener();
setupEvaluationListeners();
```

- [ ] **Step 3: Verify types and tests**

```bash
npx tsc --noEmit -p apps/desktop/tsconfig.json
npx vitest run
```

Expected: clean compile, all tests pass. The bridge is wired but no listeners consume it yet.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/features/gameState/gameStateBridge.ts apps/desktop/src/store/store.ts
git commit -m "feat: add game state bridge listener and register in store"
```

---

### Task 4: Migrate Simple Eval Listeners (shop, rest_site, event, relic_select)

These 4 listeners have straightforward `state_type` checks — no subtype detection.

**Files:**
- Modify: `apps/desktop/src/features/evaluation/shopEvalListener.ts`
- Modify: `apps/desktop/src/features/evaluation/restSiteEvalListener.ts`
- Modify: `apps/desktop/src/features/evaluation/eventEvalListener.ts`
- Modify: `apps/desktop/src/features/evaluation/relicSelectEvalListener.ts`

For each listener, the migration is identical in structure. Apply the following changes to each file:

**Import changes (all 4 files):**

Remove:
```typescript
import { gameStateApi } from "../../services/gameStateApi";
```

Add:
```typescript
import { gameStateReceived, selectCurrentGameState } from "../gameState/gameStateSlice";
```

**Predicate change (all 4 files):**

Replace the predicate with (substituting the appropriate `STATE_TYPE` and `EVAL_TYPE`):

```typescript
predicate: (action, currentState) => {
  if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
  if (!gameStateReceived.match(action)) return false;
  return selectCurrentGameState(currentState)?.state_type === STATE_TYPE;
},
```

Where `STATE_TYPE` is:
- shopEvalListener: `"shop"`
- restSiteEvalListener: `"rest_site"`
- eventEvalListener: `"event"`
- relicSelectEvalListener: `"relic_select"`

**Effect change (all 4 files):**

Replace:
```typescript
const gameState = gameStateApi.endpoints.getGameState.select()(state).data;
```

With:
```typescript
const gameState = selectCurrentGameState(state);
```

- [ ] **Step 1: Migrate shopEvalListener.ts**

Apply import, predicate, and effect changes. The predicate becomes:

```typescript
predicate: (action, currentState) => {
  if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
  if (!gameStateReceived.match(action)) return false;
  return selectCurrentGameState(currentState)?.state_type === "shop";
},
```

- [ ] **Step 2: Migrate restSiteEvalListener.ts**

Same pattern with `"rest_site"`.

- [ ] **Step 3: Migrate eventEvalListener.ts**

Same pattern with `"event"`.

- [ ] **Step 4: Migrate relicSelectEvalListener.ts**

Same pattern with `"relic_select"`.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit -p apps/desktop/tsconfig.json
npx vitest run
```

Expected: clean compile, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/evaluation/shopEvalListener.ts apps/desktop/src/features/evaluation/restSiteEvalListener.ts apps/desktop/src/features/evaluation/eventEvalListener.ts apps/desktop/src/features/evaluation/relicSelectEvalListener.ts
git commit -m "feat: migrate shop, rest_site, event, relic_select listeners to gameStateSlice"
```

---

### Task 5: Migrate card_select Subtype Listeners (cardReward, cardSelect, cardUpgrade, cardRemoval)

These 4 listeners share `state_type === "card_select"` (or `"card_reward"`) and differentiate via prompt parsing or subtype detection.

**Files:**
- Modify: `apps/desktop/src/features/evaluation/cardRewardEvalListener.ts`
- Modify: `apps/desktop/src/features/evaluation/cardSelectEvalListener.ts`
- Modify: `apps/desktop/src/features/evaluation/cardUpgradeEvalListener.ts`
- Modify: `apps/desktop/src/features/evaluation/cardRemovalEvalListener.ts`

**Import changes (all 4 files):**

Remove:
```typescript
import { gameStateApi } from "../../services/gameStateApi";
```

Add:
```typescript
import { gameStateReceived, selectCurrentGameState } from "../gameState/gameStateSlice";
```

- [ ] **Step 1: Migrate cardRewardEvalListener.ts**

This listener has the most complex predicate — it handles both `card_reward` and reward-style `card_select`.

New predicate:

```typescript
predicate: (action, currentState) => {
  if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
  if (!gameStateReceived.match(action)) return false;

  const gs = selectCurrentGameState(currentState);
  if (gs?.state_type === "card_reward") return true;

  if (gs?.state_type === "card_select") {
    const deckCards = currentState.run.runs[currentState.run.activeRunId ?? ""]?.deck ?? [];
    const subType = getCardSelectSubType(
      gs.card_select?.prompt,
      gs.card_select?.cards ?? [],
      deckCards.map((c) => c.name)
    );
    return subType === "card_reward";
  }

  return false;
},
```

Effect: replace `gameStateApi.endpoints.getGameState.select()(state).data` with `selectCurrentGameState(state)`.

- [ ] **Step 2: Migrate cardSelectEvalListener.ts**

New predicate:

```typescript
predicate: (action, currentState) => {
  if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
  if (!gameStateReceived.match(action)) return false;

  const gs = selectCurrentGameState(currentState);
  if (gs?.state_type !== "card_select") return false;

  const deckCards = currentState.run.runs[currentState.run.activeRunId ?? ""]?.deck ?? [];
  const subType = getCardSelectSubType(
    gs.card_select?.prompt,
    gs.card_select?.cards ?? [],
    deckCards.map((c) => c.name)
  );
  return subType === "card_select";
},
```

Effect: replace `gameStateApi.endpoints.getGameState.select()(state).data` with `selectCurrentGameState(state)`.

- [ ] **Step 3: Migrate cardUpgradeEvalListener.ts**

New predicate:

```typescript
predicate: (action, currentState) => {
  if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
  if (!gameStateReceived.match(action)) return false;

  const gs = selectCurrentGameState(currentState);
  if (gs?.state_type !== "card_select") return false;
  const prompt = gs.card_select?.prompt?.toLowerCase() ?? "";
  return prompt.includes("upgrade") || prompt.includes("smith") || prompt.includes("enhance");
},
```

Effect: replace `gameStateApi.endpoints.getGameState.select()(state).data` with `selectCurrentGameState(state)`.

- [ ] **Step 4: Migrate cardRemovalEvalListener.ts**

New predicate:

```typescript
predicate: (action, currentState) => {
  if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
  if (!gameStateReceived.match(action)) return false;

  const gs = selectCurrentGameState(currentState);
  if (gs?.state_type !== "card_select") return false;
  const prompt = gs.card_select?.prompt?.toLowerCase() ?? "";
  return prompt.includes("remove") || prompt.includes("purge");
},
```

Effect: replace `gameStateApi.endpoints.getGameState.select()(state).data` with `selectCurrentGameState(state)`.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit -p apps/desktop/tsconfig.json
npx vitest run
```

Expected: clean compile, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/evaluation/cardRewardEvalListener.ts apps/desktop/src/features/evaluation/cardSelectEvalListener.ts apps/desktop/src/features/evaluation/cardUpgradeEvalListener.ts apps/desktop/src/features/evaluation/cardRemovalEvalListener.ts
git commit -m "feat: migrate card_select subtype listeners to gameStateSlice"
```

---

### Task 6: Migrate Map Listener

The map listener is the most complex — it has the closure-scoped `lastMapKey`, the `shouldEvaluateMap` logic, and the pre-eval dispatch.

**Files:**
- Modify: `apps/desktop/src/features/map/mapListeners.ts`

- [ ] **Step 1: Update imports**

Remove:
```typescript
import { computeMapEvalKey, computeMapContentKey, buildMapPrompt, type MapPathEvaluation } from "../../lib/eval-inputs/map";
```

Add:
```typescript
import { computeMapEvalKey, buildMapPrompt, type MapPathEvaluation } from "../../lib/eval-inputs/map";
import { gameStateReceived, selectCurrentGameState, selectLastMapContentKey } from "../gameState/gameStateSlice";
```

Remove the `gameStateApi` import (only if no other usage remains — check first; the import may already have been the only consumer).

- [ ] **Step 2: Replace predicate**

Remove the entire closure-scoped `let lastMapKey: string | null = null;` variable.

Replace the predicate with:

```typescript
predicate: (action, currentState) => {
  if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
  if (!gameStateReceived.match(action)) return false;
  return selectCurrentGameState(currentState)?.state_type === "map";
},
```

The content-based dedup that was done via `lastMapKey` in the predicate is now handled by the `gameStateSlice` reducer (it skips dispatch when content key matches). The `lastMapContentKey` field in the slice replaces the closure variable for cross-state-type persistence.

- [ ] **Step 3: Update effect — read game state from slice**

Replace:
```typescript
const gameState = gameStateApi.endpoints.getGameState.select()(state).data;
```

With:
```typescript
const gameState = selectCurrentGameState(state);
```

- [ ] **Step 4: Remove redundant content key check from shouldEvaluateMap block**

The `shouldEvaluateMap` logic and the pre-eval dispatch remain unchanged. The `selectMapEvalContext` and `selectRecommendedNodesSet` selectors still read from `runSlice` — they are not affected by this migration.

The key behavioral change: the slice's content dedup means the predicate only fires when map content actually changed. The `shouldEvaluateMap` logic is still the guard for whether to proceed with the eval.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit -p apps/desktop/tsconfig.json
npx vitest run
```

Expected: clean compile, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/map/mapListeners.ts
git commit -m "feat: migrate map listener to gameStateSlice, remove lastMapKey closure"
```

---

### Task 7: Remove gameStateApi Import from Migrated Listeners

After all listeners are migrated, verify that `gameStateApi` is no longer imported in any eval listener file. If any stale imports remain, remove them.

- [ ] **Step 1: Search for stale imports**

```bash
grep -r "gameStateApi" apps/desktop/src/features/evaluation/ apps/desktop/src/features/map/mapListeners.ts
```

Expected: no matches. If any remain, remove the import line.

- [ ] **Step 2: Verify no regressions**

```bash
npx tsc --noEmit -p apps/desktop/tsconfig.json
npx vitest run
```

Expected: clean compile, all 152+ tests pass.

- [ ] **Step 3: Commit (if any changes)**

```bash
git add -A && git commit -m "chore: remove stale gameStateApi imports from migrated listeners"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Full type check**

```bash
npx tsc --noEmit -p apps/desktop/tsconfig.json
npx tsc --noEmit -p apps/web/tsconfig.json
```

Expected: no errors.

- [ ] **Step 2: Full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Manual smoke test**

Run the app in dev mode. Play through:
1. Start a run -> map eval fires once
2. Follow recommended path -> no re-eval
3. Enter combat -> return to map -> no spurious re-eval (the bug we were debugging)
4. Deviate from path -> re-eval fires
5. New act -> re-eval fires
6. Card reward -> eval fires once
7. Shop -> eval fires once
8. Rest site -> eval fires once
9. Open Redux DevTools -> verify `gameState.current`, `gameState.previous`, `gameState.history` are populated

- [ ] **Step 4: Final commit with all verification passing**

```bash
git add -A && git commit -m "feat: complete Redux game state bridge migration"
```
