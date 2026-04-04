# Redux Game State Bridge

Store MCP game state responses in a dedicated Redux slice before eval listeners react, enabling content-based dedup, time-travel debugging, and simpler listener predicates.

## Problem

1. RTK Query creates new object references on every poll even when content is identical, causing false re-triggers in eval listeners
2. No game state history — impossible to debug transition sequences (map -> combat -> map)
3. Listener predicates are complex, comparing RTK Query cache objects with closure-scoped state
4. Map listener requires a closure-scoped `lastMapKey` to work around reference-equality issues

## Architecture

### Data Flow

```
MCP (localhost:15526)
    | [HTTP fetch every 500ms-5s]
gameStateApi (RTK Query) -- still handles polling, connection, multiplayer
    | [matchFulfilled]
Bridge Listener -- computes content key, deduplicates, dispatches
    | [gameStateReceived action -- only when content changed]
gameStateSlice -- stores current, previous, history, content keys
    | [listeners predicate on gameStateReceived + state_type]
9 eval listeners -- read from slice selectors, not RTK Query cache
```

### What Changes

- New `gameStateSlice` with current/previous/history
- New bridge listener mirrors RTK Query results into the slice (with content dedup)
- 9 eval listeners (map + 8 others) switch predicates and selectors to use the slice
- Map listener's closure-scoped `lastMapKey` replaced by `lastMapContentKey` in the slice

### What Stays The Same

- `gameStateApi` (RTK Query) -- still polls, handles connection detection, multiplayer mode
- `useGameState` hook -- still drives dynamic polling intervals
- `runListeners`, `connectionListeners`, `choiceTrackingListener`, `runAnalyticsListener` -- stay on `matchFulfilled` (they depend on seeing every poll, including duplicates, and use closure-scoped state tied to `matchFulfilled` semantics)
- `evaluationSlice`, `evaluationApi`, `runSlice` -- unchanged
- All pure functions (`shouldEvaluateMap`, `buildPreEvalPayload`, `computeMapEvalKey`, etc.) -- unchanged

## New Slice: `gameStateSlice`

### State Shape

```typescript
interface GameStateEntry {
  data: GameState;
  contentKey: string;
  receivedAt: number;
}

interface GameStateSliceState {
  current: GameState | null;
  previous: GameState | null;
  contentKey: string | null;
  lastMapContentKey: string | null;
  history: GameStateEntry[]; // dev-only ring buffer, max 30
}
```

### Reducer: `gameStateReceived`

Single action: `gameStateReceived(payload: GameState)`

Reducer logic:
1. Compute `contentKey` from payload via `computeGameStateContentKey()`
2. If `contentKey === state.contentKey`, skip (no-op) -- content dedup
3. Shift `state.current` -> `state.previous`
4. Set `state.current = action.payload`
5. Set `state.contentKey = contentKey`
6. If `action.payload.state_type === "map"`, update `state.lastMapContentKey` via `computeMapContentKey()`
7. If `import.meta.env.DEV`, append to `state.history` (evict oldest if > 30)

### Selectors

- `selectCurrentGameState(state)` -> `GameState | null`
- `selectPreviousGameState(state)` -> `GameState | null`
- `selectGameStateType(state)` -> `string | null` (current.state_type)
- `selectGameStateContentKey(state)` -> `string | null`
- `selectLastMapContentKey(state)` -> `string | null`
- `selectGameStateHistory(state)` -> `GameStateEntry[]` (dev only)

## Content Key Function

Generalize the existing `computeMapContentKey` pattern to all state types:

```typescript
function computeGameStateContentKey(state: GameState): string {
  const base = state.state_type;

  switch (state.state_type) {
    case "map":
      return computeMapContentKey(
        state.state_type,
        state.map?.current_position ?? null,
        state.map.next_options
      );

    case "card_reward":
      return `${base}:${state.card_reward.cards.map(c => c.id).sort().join(",")}`;

    case "shop":
      return `${base}:${state.shop.items.map(i => `${i.id}:${i.is_stocked}:${i.can_afford}`).sort().join(",")}`;

    case "event":
      return `${base}:${state.event.event_id}:${state.event.options.map(o => `${o.index}:${o.locked}`).join(",")}`;

    case "rest_site":
      return `${base}:${state.rest_site.options.map(o => o.id).sort().join(",")}`;

    case "card_select":
      return `${base}:${state.card_select.prompt}:${state.card_select.cards.map(c => c.id).sort().join(",")}`;

    case "relic_select":
      return `${base}:${state.relic_select.relics.map(r => r.id).sort().join(",")}`;

    case "monster":
    case "elite":
    case "boss":
      // Combat changes every poll -- include round + turn + enemy HP
      return `${base}:${state.battle?.round}:${state.battle?.turn}:${
        state.battle?.enemies?.map(e => `${e.id}:${e.hp}`).join(",") ?? ""
      }`;

    default:
      // Menu, overlay, treasure, combat_rewards -- use state_type + floor
      return `${base}:${state.run?.floor ?? 0}`;
  }
}
```

This function lives in `packages/shared/evaluation/` alongside the existing `computeMapContentKey`. The exact field selection per state type may need adjustment based on actual game state shapes -- the key principle is: include only fields that, when changed, should trigger listener re-evaluation.

## Bridge Listener

```typescript
export function setupGameStateBridge() {
  startAppListening({
    matcher: gameStateApi.endpoints.getGameState.matchFulfilled,
    effect: (action, listenerApi) => {
      listenerApi.dispatch(gameStateReceived(action.payload));
    },
  });
}
```

- Registered in `store.ts` FIRST, before all other listeners
- The slice reducer handles dedup (content key comparison), so the bridge is a simple passthrough
- No `structuredClone` needed -- `res.json()` already produces unique objects per poll

## Eval Listener Migration

### Predicate Pattern (all 9 listeners)

```typescript
// BEFORE
predicate: (action, currentState, previousState) => {
  if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
  const current = gameStateApi.endpoints.getGameState.select()(currentState);
  const previous = gameStateApi.endpoints.getGameState.select()(previousState);
  return current.data?.state_type === "shop" && current.data !== previous.data;
},

// AFTER
predicate: (action, currentState) => {
  if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
  if (!gameStateReceived.match(action)) return false;
  return selectCurrentGameState(currentState)?.state_type === "shop";
},
```

Critical: state_type check MUST stay in the predicate. If moved to the effect, `cancelActiveListeners()` would kill in-flight evals when unrelated state types arrive (e.g., combat state cancelling a shop eval).

### Effect Pattern (all 9 listeners)

```typescript
// BEFORE
const gameState = gameStateApi.endpoints.getGameState.select()(state).data;

// AFTER
const gameState = selectCurrentGameState(state);
```

All other effect logic remains the same.

### Map Listener Specific

The map listener drops:
- Closure-scoped `let lastMapKey` variable
- `computeMapContentKey` call in the predicate
- `lastMapKey = null` reset when leaving map

These are replaced by:
- `selectLastMapContentKey(state)` in the effect (for `shouldEvaluateMap` dedup)
- The slice automatically tracks `lastMapContentKey`, updating it only when a map state is received

The map predicate becomes:
```typescript
predicate: (action, currentState) => {
  if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
  if (!gameStateReceived.match(action)) return false;
  return selectCurrentGameState(currentState)?.state_type === "map";
},
```

Content dedup for map is handled at the slice level (the bridge skips dispatch when content key matches), so the predicate doesn't need to check it.

### card_select Subtypes

The `card_select` state type is overloaded for: card reward (via card_select), deck-pick, card upgrade, and card removal. Four listeners share the same `state_type`. Their predicates must include subtype detection:

```typescript
// Card upgrade listener
predicate: (action, currentState) => {
  if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
  if (!gameStateReceived.match(action)) return false;
  const gs = selectCurrentGameState(currentState);
  if (gs?.state_type !== "card_select") return false;
  const prompt = (gs as CardSelectState).card_select.prompt?.toLowerCase() ?? "";
  return prompt.includes("upgrade") || prompt.includes("smith") || prompt.includes("enhance");
},
```

## History (Dev Only)

The `history` array is only populated when `import.meta.env.DEV` is true. Production builds skip the append entirely -- zero overhead.

Each entry stores the full `GameState`, a `contentKey`, and `receivedAt` timestamp. Max 30 entries (ring buffer).

This enables:
- Inspecting game state transition sequences in Redux DevTools
- Time-travel debugging through state changes
- Post-mortem debugging of eval trigger issues

## Files to Change

### New Files
- `apps/desktop/src/features/gameState/gameStateSlice.ts` -- slice, selectors, types
- `apps/desktop/src/features/gameState/gameStateBridge.ts` -- bridge listener
- `packages/shared/evaluation/game-state-content-key.ts` -- `computeGameStateContentKey()`
- Tests for each new file

### Modified Files
- `apps/desktop/src/store/store.ts` -- register bridge listener first, add slice to combineSlices
- `apps/desktop/src/features/map/mapListeners.ts` -- migrate predicate + effect, remove lastMapKey closure
- `apps/desktop/src/features/evaluation/cardRewardEvalListener.ts` -- migrate predicate + effect
- `apps/desktop/src/features/evaluation/shopEvalListener.ts` -- migrate
- `apps/desktop/src/features/evaluation/restSiteEvalListener.ts` -- migrate
- `apps/desktop/src/features/evaluation/eventEvalListener.ts` -- migrate
- `apps/desktop/src/features/evaluation/cardSelectEvalListener.ts` -- migrate
- `apps/desktop/src/features/evaluation/cardUpgradeEvalListener.ts` -- migrate
- `apps/desktop/src/features/evaluation/cardRemovalEvalListener.ts` -- migrate
- `apps/desktop/src/features/evaluation/relicSelectEvalListener.ts` -- migrate
- `apps/desktop/src/lib/eval-inputs/map.ts` -- move `computeMapContentKey` export (shared between slice and existing callers)

### Unchanged Files
- `apps/desktop/src/services/gameStateApi.ts` -- RTK Query stays
- `apps/desktop/src/views/connection/polling-config.ts` -- polling intervals stay
- `apps/desktop/src/features/run/runListeners.ts` -- stays on matchFulfilled
- `apps/desktop/src/features/evaluation/choiceTrackingListener.ts` -- stays on matchFulfilled
- `apps/desktop/src/store/connectionListeners.ts` -- stays on matchFulfilled

## Verification

1. All existing tests pass (`npx vitest run`)
2. TypeScript compiles clean (`npx tsc --noEmit`)
3. New tests for: gameStateSlice reducer, content key computation, bridge listener behavior
4. Manual testing: play through Act 1 map -> combat -> map -> shop -> rest site, verify:
   - Each eval fires exactly once per content change
   - No false re-triggers on identical polls
   - Map eval carries forward correctly on recommended path
   - Redux DevTools shows game state history (dev mode)
5. Remove temporary debug logging from mapListeners.ts and the debug-log API route
