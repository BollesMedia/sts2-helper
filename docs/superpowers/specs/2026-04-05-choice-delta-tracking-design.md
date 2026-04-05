# Choice Delta Tracking & Recommendation Analytics

**Date:** 2026-04-05
**Status:** Approved
**Context:** After beating A7 Ironclad with significant deviations from recommendations (many card reward skips, map path divergences), the existing choice tracking system needs to reliably capture what was recommended vs what was chosen, persist it in a structured queryable format, and handle the race condition where users act before evaluations complete.

## Problem

1. The current `choiceTrackingListener` has a bug where card reward choices are always detected as "skip" — the state machine transition detection is fragile due to closure-scoped mutable state.
2. Map path deviations trigger re-evaluation but are never logged as discrete choice events.
3. No act-level path comparison (recommended vs actual route) is persisted.
4. When users act before an LLM evaluation completes, the recommendation that *would have been* made is lost.
5. Choice data lacks game context (HP, gold, deck size) at decision time, limiting analytical value.

## Approach: Pure Detection Functions + Thin Listener

Extract all choice detection logic from the monolithic `choiceTrackingListener.ts` into pure, testable functions. The listener becomes a thin shell that feeds state transitions into these functions and dispatches results. This directly addresses the skip-detection bug by making every detection path unit-testable with plain state objects.

The new structured logging layers alongside the existing run-narrative system (not replacing it), since the narrative serves a real-time prompt-context purpose distinct from historical analysis.

## Architecture

### 1. Pure Choice Detection Layer

**Location:** `packages/shared/choice-detection/`

Each detection function takes explicit before/after state and returns a typed result — no closures, no mutable state, no Redux dependency.

#### `detect-card-reward-choice.ts`

```ts
type CardRewardChoice =
  | { type: "card_picked"; chosenName: string; offeredIds: string[] }
  | { type: "card_skipped"; offeredIds: string[] }
  | null; // no choice detected yet

function detectCardRewardChoice(input: {
  prevStateType: string;
  currentStateType: string;
  offeredCardIds: string[];
  previousDeckNames: Set<string>;
  currentDeckNames: Set<string>;
}): CardRewardChoice;
```

#### `detect-map-node-choice.ts`

```ts
interface MapNodeChoice {
  chosenNode: { col: number; row: number; nodeType: string };
  recommendedNode: { col: number; row: number; nodeType: string } | null;
  allOptions: { col: number; row: number; nodeType: string }[];
  wasFollowed: boolean;
}

function detectMapNodeChoice(input: {
  prevPosition: { col: number; row: number } | null;
  currentPosition: { col: number; row: number };
  bestPathNodes: Set<string>;
  nextOptions: { col: number; row: number; nodeType: string }[];
  recommendedNextNode: { col: number; row: number; nodeType: string } | null;
}): MapNodeChoice | null;
```

#### Additional detection functions

- `detectShopChoice(prevDeck, currentDeck, offeredItems)` — handles purchases, removals, and browse-only
- `detectRestSiteChoice(prevDeck, currentDeck)` — rest vs upgrade

#### Thin listener shell

`choiceTrackingListener.ts` is refactored to:
1. Maintain minimal state (previous state type, previous deck snapshot)
2. Feed each state transition into the appropriate pure detection function
3. Dispatch results (choice log + narrative append)
4. No detection logic lives in the listener itself

### 2. Database Schema Changes

#### Alter `choices` table

Add two columns:

- `game_context` (jsonb, nullable) — snapshot at decision time:
  ```json
  { "hpPercent": 0.75, "gold": 120, "deckSize": 18, "ascension": 7, "act": 2, "relics": ["..."], "character": "ironclad" }
  ```
- `eval_pending` (boolean, default false) — true when logged before eval completed; backfill marker

#### Add unique constraint for upserts

```sql
UNIQUE (run_id, floor, choice_type, sequence)
```

- `sequence` (smallint, default 0) — new column; stays 0 for card rewards and map nodes (one per floor); increments for multiple shop purchases on the same floor.
- This constraint enables the backfill upsert pattern.

#### New `act_paths` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK, default gen_random_uuid() |
| `run_id` | text | FK → runs.run_id |
| `act` | int | 1, 2, 3 |
| `recommended_path` | jsonb | Array of `{col, row, nodeType}` |
| `actual_path` | jsonb | Array of `{col, row, nodeType}` |
| `node_preferences` | jsonb | LLM weights at act start |
| `deviation_count` | int | Nodes where actual ≠ recommended |
| `deviation_nodes` | jsonb | Array of `{col, row, recommended, actual}` |
| `context_at_start` | jsonb | HP, gold, deck size, relics entering the act |
| `user_id` | uuid | FK → auth.users |
| `created_at` | timestamptz | default now() |

Unique constraint: `UNIQUE (run_id, act)`

#### Analytics view updates

- `recommendation_follow_rates` — exclude `eval_pending = true` rows; add `game_context` breakdowns (e.g., follow rate by HP bracket)
- `card_win_rates` — incorporate `game_context` for richer slicing

### 3. Backfill Pattern (Eval-Pending Resolution)

#### Step 1 — Immediate log

When user acts before eval completes:
- Choice detection fires normally
- `logChoice` is called with `eval_pending: true`, `recommendedItemId: null`, `rankingsSnapshot: null`
- The choice is persisted immediately — we never lose the user's actual decision

#### Step 2 — Backfill on eval completion

Each eval listener already calls `registerLastEvaluation()` when the API returns. After registration, the listener checks the pending-choice registry. If a match exists, it fires the backfill.

#### Pending choice registry

```ts
// packages/shared/choice-detection/pending-choice-registry.ts
registerPendingChoice(floor: number, choiceType: string, chosenItemId: string | null): void;
getPendingChoice(floor: number, choiceType: string): { chosenItemId: string | null } | undefined;
clearPendingChoice(floor: number, choiceType: string): void;
clearAll(): void; // called on new run
```

In-memory, same pattern as `last-evaluation-registry`. Cleared on new run.

#### Backfill payload builder

```ts
// packages/shared/choice-detection/build-backfill-payload.ts
function buildBackfillPayload(
  evalResult: LastEvaluation,
  pendingChoice: { chosenItemId: string | null }
): BackfillPayload | null;
```

Computes `wasFollowed` from `evalResult.recommendedId` vs `pendingChoice.chosenItemId`. Returns the upsert payload with `eval_pending: false`.

#### API endpoint

Extend `POST /api/choice` to handle upserts via the `(run_id, floor, choice_type, sequence)` constraint using `ON CONFLICT ... DO UPDATE`.

### 4. Map Node Choice Tracking

Map deviations become discrete choice events logged to the existing `choices` table.

**Integration point:** The map listener (`mapListeners.ts`) already computes `isOnPath`. Before triggering Tier 1/Tier 2 re-eval, it now:

1. Detects that the player moved to a new node (position changed from previous poll)
2. Calls `detectMapNodeChoice` to compare actual vs recommended
3. Logs to `choices` with:
   - `choice_type: "map_node"`
   - `offered_items` = all `next_options` as `[{col, row, nodeType}]`
   - `chosen_item_id` = `"col,row"` of actual node
   - `recommended_item_id` = `"col,row"` of recommended next node
   - `game_context` = HP, gold, deck size, node preferences
4. Existing Tier 1/Tier 2 re-eval proceeds as normal

Eval-pending applies here too, though it's less likely since map evals fire proactively when entering the map screen.

### 5. Act Path Logging

One record per act per run, comparing the full recommended route against the actual route taken.

#### Act path tracker

```ts
// packages/shared/choice-detection/act-path-tracker.ts
appendNode(actNumber: number, node: { col: number; row: number; nodeType: string }): void;
getActPath(actNumber: number): { col: number; row: number; nodeType: string }[];
flushAct(actNumber: number): ActPathRecord;
clearAll(): void; // called on new run
```

In-memory, accumulates each node visited during an act.

#### When to flush

- **Act change:** A listener watches for `run.act` changing in game state. On change, flush the previous act's path to `act_paths`.
- **Run end:** The existing `runAnalyticsListener` that detects run end also flushes the current act's path.

#### What gets persisted

- `recommended_path` — the `mapEval.recommendedPath` from Redux at act start
- `actual_path` — accumulated from the act path tracker
- `node_preferences` — from Redux at act start
- `deviation_count` and `deviation_nodes` — computed by comparing the two paths
- `context_at_start` — HP, gold, deck size, relics when the act began

### 6. Test Strategy

All pure functions in `packages/shared/choice-detection/` are tested without Tauri or Redux dependencies.

#### `detectCardRewardChoice` tests

- 3 cards offered → user picks one (deck grows, new name matches offered)
- 3 cards offered → user skips (leaves combat_rewards, deck unchanged)
- User picks before eval completes (same detection, caller sets eval_pending)
- Edge: deck grows but new card name doesn't match offered IDs
- Edge: state transitions from card_reward directly to map (no combat_rewards)
- Edge: multiple card rewards on same floor

#### `detectMapNodeChoice` tests

- User picks recommended node (wasFollowed = true)
- User deviates (wasFollowed = false, both nodes captured)
- User moves before eval returns (recommended = null)
- First map node of act (no previous position)

#### `buildActPathRecord` tests

- Complete act, 0 deviations
- Act with multiple deviations, correct count and nodes
- Partial act (run ended mid-act)

#### `buildBackfillPayload` tests

- Eval recommended card A, user picked card A → wasFollowed = true
- Eval recommended card A, user picked card B → wasFollowed = false
- Eval recommended card A, user skipped → wasFollowed = false
- Eval recommended skip, user skipped → wasFollowed = true
- No pending choice → returns null

#### Listener integration tests

Mock Redux store with realistic state sequences:
- Full card reward → pick → log flow
- Full card reward → skip → log flow (regression test for current bug)
- Eval-pending → backfill flow end-to-end

## File Structure

```
packages/shared/choice-detection/
├── detect-card-reward-choice.ts
├── detect-card-reward-choice.test.ts
├── detect-map-node-choice.ts
├── detect-map-node-choice.test.ts
├── detect-shop-choice.ts
├── detect-shop-choice.test.ts
├── detect-rest-site-choice.ts
├── detect-rest-site-choice.test.ts
├── build-backfill-payload.ts
├── build-backfill-payload.test.ts
├── pending-choice-registry.ts
├── pending-choice-registry.test.ts
├── act-path-tracker.ts
├── act-path-tracker.test.ts
└── types.ts

apps/desktop/src/features/choice/
├── choiceTrackingListener.ts  (refactored — thin shell)
└── choiceTrackingListener.test.ts (integration tests)

apps/desktop/src/features/map/
├── mapListeners.ts  (extended — map node choice logging + act path tracking)

supabase/migrations/
├── 0XX_choice_delta_tracking.sql  (schema changes + act_paths table)

apps/web/src/app/api/choice/
├── route.ts  (extended — upsert support for backfill)
```

## Out of Scope

- Feeding aggregate delta data back into LLM prompts (future work — query patterns first, then decide how to use them)
- UI for viewing choice analytics (build the data layer first)
- Modifying the run-narrative system (it continues to serve its prompt-context purpose alongside this)
- Weight system adjustments based on delta data (depends on having enough data to analyze)
