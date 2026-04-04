# Map Pathing Refactor — LLM Weights + Constraint-Aware Tracer

**Date:** 2026-04-04
**Status:** Draft

## Problem

The map path visualization uses a local DFS heuristic (`traceRecommendedPath`) that can disagree with the LLM's evaluation. The LLM says "skip the elite" but the green path routes through it. Additionally, the tracer produces physically impossible paths — 5 monsters into an elite (HP death spiral), routing to shops with no gold.

The LLM also struggles with hallucination on STS2 content (new game, trained on STS1) and cannot reliably compute graph-traversal paths. Asking it for coordinates would be unreliable.

## Solution

**Hybrid approach:** The LLM outputs simple node-type preference weights (what to prioritize). A new constraint-aware local tracer uses those weights to compute the full path while enforcing survivability constraints (HP budget, gold thresholds). The LLM owns *priority*, the tracer owns *feasibility*.

## Design

### 1. LLM Tool Schema Changes

Add `node_preferences` to the `submit_map_evaluation` tool schema:

```json
{
  "node_preferences": {
    "type": "object",
    "description": "Rate how desirable each node type is right now (0.0 = avoid, 1.0 = strongly seek). Consider HP, gold, deck needs, act, and ascension.",
    "properties": {
      "monster": { "type": "number" },
      "elite": { "type": "number" },
      "shop": { "type": "number" },
      "rest": { "type": "number" },
      "treasure": { "type": "number" },
      "event": { "type": "number" }
    },
    "required": ["monster", "elite", "shop", "rest", "treasure", "event"]
  }
}
```

**Parsing:** Add `nodePreferences` to `MapPathEvaluation` interface. Parse from `raw.node_preferences`. Fall back to current heuristic weights if missing.

**Token cost:** ~50-60 additional output tokens per evaluation.

### 2. Constraint-Aware Path Tracer

Replace `traceRecommendedPath` as the primary path computation with a new constraint-aware function.

**Inputs:**
- Start position (col, row)
- Map node graph
- Boss position
- LLM `nodePreferences` (or fallback defaults)
- Current game context: HP%, gold, act, ascension, deck size, relic count, current removal cost

**Algorithm — greedy DFS with constraint gates:**

At each branching point, score each child's subtree, but:

1. **Score using LLM weights** — `nodePreferences[nodeType]` is the base score
2. **Track simulated HP** along the path:
   - Monster: subtract estimated cost (see HP Cost Estimation section)
   - Elite: subtract estimated cost
   - Rest: add 30% max HP (capped at max)
   - All other node types: no HP change
3. **Hard constraint gates** — never route through a node if:
   - Elite and simulated HP < 40%
   - Shop and gold < `min(currentRemovalCost, 150)` (can't do anything useful)
   - Simulated HP would drop below 15% at any point (survival floor)
4. **Soft penalties** — reduce score but don't block:
   - Elite where simulated HP < 70% (risky but survivable)
   - 3+ consecutive monsters (diminishing returns on HP drain)
   - Back-to-back shops (gold depletion)
   - Elite without a rest site within 2 nodes after
5. **First node is pinned** to the LLM's top-ranked option

**Output:** Same `PathCoord[]` format — drop-in replacement for visualization.

**Fallback:** When `nodePreferences` is null (LLM didn't return them), use default weights derived from the current heuristic. Constraints still apply regardless.

### 3. Deviation Handling & Re-evaluation Strategy

Two-tier response to player movement to minimize unnecessary API calls:

**Tier 1 — Local re-trace (free, instant):**
- Player moves to a node NOT on the recommended path
- Re-run constraint-aware tracer from new position using **stored** LLM weights
- Update path visualization immediately
- No API call

**Tier 2 — Full LLM re-evaluation:**
Only when game context has materially changed since last eval:
- Post-combat HP loss exceeds threshold (e.g. lost >20% in one fight)
- Gold crossed a meaningful boundary (enough to change shop viability)
- New act
- Deck size changed significantly (card reward picked, card removed)
- Multiple deviations deep (stored weights may no longer reflect reality)

**State flow:**
1. LLM eval fires -> stores `nodePreferences` + `bestPathNodes` in Redux
2. Player deviates -> tracer re-runs with stored `nodePreferences` -> updates `recommendedPath` and `bestPathNodes` via `mapPathRetraced`
3. Context changes materially -> full re-eval -> new `nodePreferences` from LLM -> fresh trace

### 4. Redux State Changes

**Extended `MapEvalState`:**

```typescript
interface MapEvalState {
  // Existing
  recommendedPath: { col: number; row: number }[];
  recommendedNodes: string[];
  bestPathNodes: string[];

  // Modified — expanded context
  lastEvalContext: EvalContext | null;

  // New
  nodePreferences: NodePreferences | null;
}

interface NodePreferences {
  monster: number;
  elite: number;
  shop: number;
  rest: number;
  treasure: number;
  event: number;
}

interface EvalContext {
  hpPercent: number;
  deckSize: number;
  act: number;
  gold: number;       // New — shop viability threshold
  ascension: number;  // New — affects HP cost estimates
}
```

**New reducer:** `mapPathRetraced` — updates `recommendedPath` and `bestPathNodes` without touching `nodePreferences` or `lastEvalContext`. Used for Tier 1 local re-traces.

**New selector:** `selectNodePreferences` — returns stored weights or null.

### 5. HP Cost Estimation

**Static estimates (initial):**

```typescript
const HP_COST_ESTIMATES = {
  monster: { act1: 0.10, act2: 0.13, act3: 0.16 },
  elite:   { act1: 0.27, act2: 0.30, act3: 0.35 },
} as const;

const ASCENSION_SCALING = {
  8: 1.15,  // enemies have more HP, fights last longer
  9: 1.25,  // enemies deal more damage
} as const;

const REST_HEALING = 0.30; // 30% of max HP

const PATH_CONSTRAINTS = {
  eliteMinHp: 0.70,            // soft penalty below this
  eliteHardMinHp: 0.40,        // hard gate below this
  shopMinGoldFn: (removalCost: number) => Math.min(removalCost, 150),
  survivalFloor: 0.15,         // never let simulated HP drop below
  consecutiveMonsterPenalty: 3, // soft penalty after this many
  eliteRequiresRestWithin: 2,  // soft penalty if no rest within N nodes
} as const;
```

All thresholds are tunable constants. Designed to be swappable with data-driven values later.

**Future — data-driven estimates (not in scope):**

Passively collect pre/post combat HP snapshots via the game state bridge:

```typescript
interface CombatHpSnapshot {
  runId: string;
  floor: number;
  act: number;
  ascension: number;
  character: string;
  nodeType: 'monster' | 'elite';
  hpBefore: number;
  hpAfter: number;
  maxHp: number;
}
```

Over time, replace static estimates with per-character, per-ascension, per-act averages derived from real player data.

### 6. Files Changed

**New files:**
- `packages/shared/evaluation/path-constraints.ts` — constants (HP costs, thresholds, ascension scaling)
- `apps/desktop/src/views/map/constraint-aware-tracer.ts` — new tracer function (pure, fully testable)
- `apps/desktop/src/views/map/__tests__/constraint-aware-tracer.test.ts` — test suite

**Modified files:**
- `packages/shared/evaluation/prompt-builder.ts` — add `node_preferences` to map eval tool schema
- `apps/desktop/src/lib/eval-inputs/map.ts` — add `NodePreferences` type, extend `MapPathEvaluation`
- `apps/desktop/src/services/evaluationApi.ts` — parse `node_preferences` from LLM response
- `apps/desktop/src/features/run/runSlice.ts` — add `nodePreferences` to state, expand `EvalContext`, add `mapPathRetraced` reducer
- `apps/desktop/src/features/run/runSelectors.ts` — add `selectNodePreferences` selector
- `apps/desktop/src/features/map/mapListeners.ts` — Tier 1/Tier 2 deviation logic
- `apps/desktop/src/lib/should-evaluate-map.ts` — extend context comparison with gold/ascension
- `apps/desktop/src/lib/build-pre-eval-payload.ts` — swap to new tracer

**Deprecated (fallback only):**
- `apps/desktop/src/views/map/map-path-tracer.ts` — `traceRecommendedPath` used only when `nodePreferences` is null

**Not touched:**
- `apps/desktop/src/views/map/map-view.tsx` — already reads `recommendedPath` from Redux, data shape unchanged
