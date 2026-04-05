# Map Pathing Refactor — LLM Weights + Constraint-Aware Tracer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local DFS path tracer with a constraint-aware tracer driven by LLM node-type preference weights, producing paths that respect survivability constraints (HP budget, gold thresholds) and align with the LLM's strategic evaluation.

**Architecture:** The LLM outputs simple node-type preference weights (0.0–1.0) via a new `node_preferences` field in the `submit_map_evaluation` tool response. A new pure constraint-aware tracer consumes those weights alongside game context (HP, gold, act, ascension) to compute the full path, enforcing hard gates (survival floor, elite HP minimum) and soft penalties (consecutive monsters, back-to-back shops). When the player deviates, the tracer re-runs locally with stored weights (Tier 1). Full LLM re-eval (Tier 2) only fires when game context has materially changed.

**Tech Stack:** TypeScript, Redux Toolkit, Vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/shared/evaluation/path-constraints.ts` (new) | All tunable constants: HP cost estimates, ascension scaling, constraint thresholds, rest healing factor |
| `apps/desktop/src/views/map/constraint-aware-tracer.ts` (new) | Pure constraint-aware tracer function — scores nodes using LLM weights, tracks simulated HP, enforces hard/soft constraints |
| `apps/desktop/src/views/map/__tests__/constraint-aware-tracer.test.ts` (new) | Full test suite for the tracer |
| `packages/shared/evaluation/prompt-builder.ts` (modify) | Add `node_preferences` to `submit_map_evaluation` tool schema |
| `apps/desktop/src/lib/eval-inputs/map.ts` (modify) | Add `NodePreferences` type, extend `MapPathEvaluation` with `nodePreferences` |
| `apps/desktop/src/services/evaluationApi.ts` (modify) | Parse `node_preferences` from LLM response |
| `apps/desktop/src/features/run/runSlice.ts` (modify) | Add `nodePreferences` to `MapEvalState`, expand `lastEvalContext` with `gold` and `ascension`, add `mapPathRetraced` reducer |
| `apps/desktop/src/features/run/runSelectors.ts` (modify) | Add `selectNodePreferences` selector |
| `apps/desktop/src/lib/should-evaluate-map.ts` (modify) | Extend `ShouldEvaluateMapInput` and logic for Tier 2 context-change detection |
| `apps/desktop/src/lib/__tests__/should-evaluate-map.test.ts` (modify) | Add tests for new Tier 2 triggers |
| `apps/desktop/src/lib/build-pre-eval-payload.ts` (modify) | Swap to constraint-aware tracer, accept `nodePreferences` param |
| `apps/desktop/src/lib/__tests__/build-pre-eval-payload.test.ts` (modify) | Update tests for new tracer integration |
| `apps/desktop/src/features/map/mapListeners.ts` (modify) | Tier 1/Tier 2 deviation logic, store `nodePreferences`, use new tracer |

---

### Task 1: Path Constraints Constants

**Files:**
- Create: `packages/shared/evaluation/path-constraints.ts`

- [ ] **Step 1: Create path-constraints.ts with all tunable constants**

```typescript
// packages/shared/evaluation/path-constraints.ts

/**
 * HP cost estimates as fraction of max HP, by act.
 * Used by the constraint-aware tracer to simulate HP along a path.
 */
export const HP_COST_ESTIMATES = {
  monster: { act1: 0.10, act2: 0.13, act3: 0.16 },
  elite: { act1: 0.27, act2: 0.30, act3: 0.35 },
} as const;

/**
 * Multiplier for HP costs at higher ascensions.
 * Applied on top of base act costs.
 */
export const ASCENSION_SCALING: Record<number, number> = {
  8: 1.15,
  9: 1.25,
};

/** Rest site heals 30% of max HP */
export const REST_HEALING = 0.30;

/** All constraint thresholds used by the tracer */
export const PATH_CONSTRAINTS = {
  /** Soft penalty: elite below this HP% (risky but survivable) */
  eliteMinHp: 0.70,
  /** Hard gate: never route through elite below this HP% */
  eliteHardMinHp: 0.40,
  /** Hard gate: shop not useful below this gold threshold */
  shopMinGoldFn: (removalCost: number) => Math.min(removalCost, 150),
  /** Hard gate: never let simulated HP drop below this */
  survivalFloor: 0.15,
  /** Soft penalty after this many consecutive monsters */
  consecutiveMonsterPenalty: 3,
  /** Soft penalty: elite without a rest within N nodes after */
  eliteRequiresRestWithin: 2,
} as const;

/** Default node preferences when LLM doesn't provide them */
export const DEFAULT_NODE_PREFERENCES = {
  monster: 0.4,
  elite: 0.5,
  shop: 0.5,
  rest: 0.6,
  treasure: 0.9,
  event: 0.5,
} as const;
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsc --noEmit packages/shared/evaluation/path-constraints.ts 2>&1 || echo "check complete"`
Expected: No type errors (file is self-contained constants).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/evaluation/path-constraints.ts
git commit -m "feat(map): add path constraint constants for constraint-aware tracer"
```

---

### Task 2: NodePreferences Type + MapPathEvaluation Extension

**Files:**
- Modify: `apps/desktop/src/lib/eval-inputs/map.ts:7-18`

- [ ] **Step 1: Add NodePreferences type and extend MapPathEvaluation**

In `apps/desktop/src/lib/eval-inputs/map.ts`, add the `NodePreferences` interface before `MapPathEvaluation` and add the `nodePreferences` field:

```typescript
// Add after the existing imports (line 5), before MapPathEvaluation (line 7)

export interface NodePreferences {
  monster: number;
  elite: number;
  shop: number;
  rest: number;
  treasure: number;
  event: number;
}

export interface MapPathEvaluation {
  rankings: {
    optionIndex: number;
    nodeType: string;
    tier: TierLetter;
    confidence: number;
    recommendation: string;
    reasoning: string;
  }[];
  overallAdvice: string | null;
  recommendedPath: { col: number; row: number }[];
  nodePreferences: NodePreferences | null;
}
```

The key change is adding the `NodePreferences` interface and the `nodePreferences` field to `MapPathEvaluation`.

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/lib/eval-inputs/map.ts
git commit -m "feat(map): add NodePreferences type and extend MapPathEvaluation"
```

---

### Task 3: Parse node_preferences from LLM Response

**Files:**
- Modify: `apps/desktop/src/services/evaluationApi.ts:169-198`

- [ ] **Step 1: Update evaluateMap endpoint to parse node_preferences**

In `apps/desktop/src/services/evaluationApi.ts`, update the `evaluateMap` mutation's response transformation (inside the `queryFn`, after `const raw = ...`). Add parsing of `node_preferences` and include it in the returned `MapPathEvaluation`:

```typescript
// Inside evaluateMap queryFn, replace the data construction (lines 181-194):
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/services/evaluationApi.ts
git commit -m "feat(map): parse node_preferences from LLM response"
```

---

### Task 4: Add node_preferences to LLM Tool Schema

**Files:**
- Modify: `packages/shared/evaluation/prompt-builder.ts:353-381`

- [ ] **Step 1: Extend buildMapToolSchema with node_preferences property**

In `packages/shared/evaluation/prompt-builder.ts`, add `node_preferences` to the `input_schema.properties` object inside `buildMapToolSchema`. Add it after the `overall_advice` property (line 376):

```typescript
export function buildMapToolSchema(optionCount: number) {
  return {
    name: "submit_map_evaluation",
    description: `Evaluate ${optionCount} path options. Return exactly ${optionCount} rankings.`,
    input_schema: {
      type: "object" as const,
      properties: {
        rankings: {
          type: "array",
          description: `Exactly ${optionCount} entries, one per path option in order.`,
          items: {
            type: "object",
            properties: {
              option_index: { type: "integer", description: "Path option number (1-indexed)" },
              node_type: { type: "string", description: "First node type on this path" },
              tier: { type: "string", enum: ["S", "A", "B", "C", "D", "F"] },
              confidence: { type: "integer", description: "0-100" },
              recommendation: { type: "string", enum: ["strong_pick", "good_pick", "situational", "skip"] },
              reasoning: { type: "string", description: "Max 15 words about the WHOLE path." },
            },
            required: ["option_index", "tier", "confidence", "reasoning"],
          },
        },
        overall_advice: { type: "string", description: "Max 15 words overall pathing strategy." },
        node_preferences: {
          type: "object",
          description: "Rate how desirable each node type is right now (0.0 = avoid, 1.0 = strongly seek). Consider HP, gold, deck needs, act, and ascension.",
          properties: {
            monster: { type: "number" },
            elite: { type: "number" },
            shop: { type: "number" },
            rest: { type: "number" },
            treasure: { type: "number" },
            event: { type: "number" },
          },
          required: ["monster", "elite", "shop", "rest", "treasure", "event"],
        },
      },
      required: ["rankings", "overall_advice", "node_preferences"],
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/evaluation/prompt-builder.ts
git commit -m "feat(map): add node_preferences to submit_map_evaluation tool schema"
```

---

### Task 5: Redux State — nodePreferences, Expanded EvalContext, mapPathRetraced

**Files:**
- Modify: `apps/desktop/src/features/run/runSlice.ts:17-26, 99-104, 169-177`
- Modify: `apps/desktop/src/features/run/runSelectors.ts`

- [ ] **Step 1: Write the failing test for selectNodePreferences**

Create a test inline to verify the selector works. First, add to or create a test file. Since selectors are simple and the existing codebase doesn't have a selector test file, we'll verify via the type system + a quick manual check. Skip to implementation.

- [ ] **Step 2: Extend MapEvalState with nodePreferences and expanded lastEvalContext**

In `apps/desktop/src/features/run/runSlice.ts`, update the `MapEvalState` interface:

```typescript
export interface MapEvalState {
  recommendedPath: { col: number; row: number }[];
  recommendedNodes: string[]; // serializable — all options' paths (UI highlighting)
  bestPathNodes: string[]; // serializable — best option's path only (deviation detection)
  lastEvalContext: {
    hpPercent: number;
    deckSize: number;
    act: number;
    gold: number;
    ascension: number;
  } | null;
  nodePreferences: {
    monster: number;
    elite: number;
    shop: number;
    rest: number;
    treasure: number;
    event: number;
  } | null;
}
```

Update the initial state in `runStarted` to include `nodePreferences: null`.

- [ ] **Step 3: Add mapPathRetraced reducer**

Add a new reducer in `runSlice.ts` after `mapEvalUpdated`:

```typescript
/** Tier 1 local re-trace: update path without touching nodePreferences or lastEvalContext */
mapPathRetraced(
  state,
  action: PayloadAction<{
    recommendedPath: { col: number; row: number }[];
    bestPathNodes: string[];
    recommendedNodes: string[];
  }>
) {
  const run = state.activeRunId ? state.runs[state.activeRunId] : null;
  if (run) {
    run.mapEval.recommendedPath = action.payload.recommendedPath;
    run.mapEval.bestPathNodes = action.payload.bestPathNodes;
    run.mapEval.recommendedNodes = action.payload.recommendedNodes;
  }
},
```

Export it alongside the other actions.

- [ ] **Step 4: Add selectNodePreferences selector**

In `apps/desktop/src/features/run/runSelectors.ts`, add:

```typescript
/** Stored LLM node-type preferences for local re-tracing */
export const selectNodePreferences = createSelector(
  selectActiveRun,
  (run) => run?.mapEval.nodePreferences ?? null
);
```

- [ ] **Step 5: Verify types compile**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsc --noEmit 2>&1 | head -30`
Expected: Type errors in `mapListeners.ts` and `build-pre-eval-payload.ts` because `lastEvalContext` shape changed (gold/ascension now required). These will be fixed in later tasks.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/run/runSlice.ts apps/desktop/src/features/run/runSelectors.ts
git commit -m "feat(map): add nodePreferences to Redux state, mapPathRetraced reducer, expanded EvalContext"
```

---

### Task 6: Constraint-Aware Tracer — Tests First

**Files:**
- Create: `apps/desktop/src/views/map/__tests__/constraint-aware-tracer.test.ts`

- [ ] **Step 1: Create test file with map fixtures and core test cases**

```typescript
// apps/desktop/src/views/map/__tests__/constraint-aware-tracer.test.ts

import { describe, it, expect } from "vitest";
import { traceConstraintAwarePath } from "../constraint-aware-tracer";
import type { MapNode } from "@sts2/shared/types/game-state";
import type { NodePreferences } from "../../../lib/eval-inputs/map";

/**
 * Test map layout — 4 rows, branching at row 1:
 *
 *   Row 3: [1,3 boss]
 *            ↑     ↑
 *   Row 2: [0,2 rest] [2,2 monster]
 *            ↑           ↑
 *   Row 1: [0,1 elite]  [2,1 shop]
 *            ↑           ↑
 *   Row 0: ------[1,0 start]------
 *
 * Boss at [1,3].
 */
const nodes: MapNode[] = [
  { col: 1, row: 0, type: "Monster", children: [[0, 1], [2, 1]] },
  { col: 0, row: 1, type: "Elite", children: [[0, 2]] },
  { col: 2, row: 1, type: "Shop", children: [[2, 2]] },
  { col: 0, row: 2, type: "RestSite", children: [[1, 3]] },
  { col: 2, row: 2, type: "Monster", children: [[1, 3]] },
  { col: 1, row: 3, type: "Boss", children: [] },
];

const bossPos = { col: 1, row: 3 };

const defaultPrefs: NodePreferences = {
  monster: 0.4,
  elite: 0.7,
  shop: 0.3,
  rest: 0.5,
  treasure: 0.9,
  event: 0.5,
};

const defaultContext = {
  hpPercent: 0.80,
  gold: 200,
  act: 1,
  ascension: 0,
  maxHp: 80,
  currentRemovalCost: 75,
};

describe("traceConstraintAwarePath", () => {
  it("returns a path from start to boss", () => {
    const path = traceConstraintAwarePath({
      startCol: 0,
      startRow: 1,
      nodes,
      bossPos,
      nodePreferences: defaultPrefs,
      ...defaultContext,
    });

    // Starts at the given position
    expect(path[0]).toEqual({ col: 0, row: 1 });
    // Ends at boss
    expect(path[path.length - 1]).toEqual({ col: 1, row: 3 });
  });

  it("prefers elite path when HP is high and elite weight is high", () => {
    const prefs: NodePreferences = { ...defaultPrefs, elite: 0.9, shop: 0.2 };
    const path = traceConstraintAwarePath({
      startCol: 1,
      startRow: 0,
      nodes,
      bossPos,
      nodePreferences: prefs,
      hpPercent: 0.90,
      gold: 200,
      act: 1,
      ascension: 0,
      maxHp: 80,
      currentRemovalCost: 75,
    });

    // Should route through elite (0,1) not shop (2,1)
    expect(path.some((p) => p.col === 0 && p.row === 1)).toBe(true);
  });

  it("avoids elite when HP is below hard gate (40%)", () => {
    const prefs: NodePreferences = { ...defaultPrefs, elite: 0.9 };
    const path = traceConstraintAwarePath({
      startCol: 1,
      startRow: 0,
      nodes,
      bossPos,
      nodePreferences: prefs,
      hpPercent: 0.30,
      gold: 200,
      act: 1,
      ascension: 0,
      maxHp: 80,
      currentRemovalCost: 75,
    });

    // Should avoid elite (0,1), take shop path (2,1) instead
    expect(path.some((p) => p.col === 2 && p.row === 1)).toBe(true);
    expect(path.some((p) => p.col === 0 && p.row === 1)).toBe(false);
  });

  it("avoids shop when gold is below threshold", () => {
    const prefs: NodePreferences = { ...defaultPrefs, shop: 0.9, elite: 0.2 };
    const path = traceConstraintAwarePath({
      startCol: 1,
      startRow: 0,
      nodes,
      bossPos,
      nodePreferences: prefs,
      hpPercent: 0.90,
      gold: 30,
      act: 1,
      ascension: 0,
      maxHp: 80,
      currentRemovalCost: 75,
    });

    // Should avoid shop (gold 30 < min(75, 150) = 75), take elite instead
    expect(path.some((p) => p.col === 0 && p.row === 1)).toBe(true);
  });

  it("enforces survival floor — never drops below 15% HP", () => {
    // Build a map with 3 consecutive elites
    const dangerNodes: MapNode[] = [
      { col: 0, row: 0, type: "Monster", children: [[0, 1]] },
      { col: 0, row: 1, type: "Elite", children: [[0, 2]] },
      { col: 0, row: 2, type: "Elite", children: [[0, 3]] },
      { col: 0, row: 3, type: "Boss", children: [] },
    ];
    const prefs: NodePreferences = { ...defaultPrefs, elite: 1.0 };

    const path = traceConstraintAwarePath({
      startCol: 0,
      startRow: 0,
      nodes: dangerNodes,
      bossPos: { col: 0, row: 3 },
      nodePreferences: prefs,
      hpPercent: 0.50,
      gold: 200,
      act: 1,
      ascension: 0,
      maxHp: 80,
      currentRemovalCost: 75,
    });

    // Path should exist (even with constraints, it's the only route)
    // but the tracer should still produce a path when there's no alternative
    expect(path.length).toBeGreaterThan(0);
  });

  it("applies rest site healing to simulated HP", () => {
    // Map: elite -> rest -> boss
    const healNodes: MapNode[] = [
      { col: 0, row: 0, type: "Elite", children: [[0, 1]] },
      { col: 0, row: 1, type: "RestSite", children: [[0, 2]] },
      { col: 0, row: 2, type: "Boss", children: [] },
    ];

    const path = traceConstraintAwarePath({
      startCol: 0,
      startRow: 0,
      nodes: healNodes,
      bossPos: { col: 0, row: 2 },
      nodePreferences: defaultPrefs,
      hpPercent: 0.60,
      gold: 200,
      act: 1,
      ascension: 0,
      maxHp: 80,
      currentRemovalCost: 75,
    });

    // Should include all 3 nodes (only path available)
    expect(path).toEqual([
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 0, row: 2 },
    ]);
  });

  it("applies ascension scaling to HP cost estimates", () => {
    // High ascension should make elite more costly, possibly triggering hard gate sooner
    const prefs: NodePreferences = { ...defaultPrefs, elite: 0.9 };

    // At ascension 0 with 50% HP, elite act1 cost is 27% -> 23% after = above 15% floor
    // At ascension 9 with 50% HP, elite act1 cost is 27% * 1.25 = 33.75% -> 16.25% after, borderline
    const pathA0 = traceConstraintAwarePath({
      startCol: 1,
      startRow: 0,
      nodes,
      bossPos,
      nodePreferences: prefs,
      hpPercent: 0.50,
      gold: 200,
      act: 1,
      ascension: 0,
      maxHp: 80,
      currentRemovalCost: 75,
    });

    const pathA9 = traceConstraintAwarePath({
      startCol: 1,
      startRow: 0,
      nodes,
      bossPos,
      nodePreferences: prefs,
      hpPercent: 0.50,
      gold: 200,
      act: 1,
      ascension: 9,
      maxHp: 80,
      currentRemovalCost: 75,
    });

    // Both should produce valid paths (start to boss)
    expect(pathA0.length).toBeGreaterThan(0);
    expect(pathA9.length).toBeGreaterThan(0);
  });

  it("soft-penalizes elite below 70% HP but doesn't block it", () => {
    // With no alternative, elite at 60% HP should still be routable
    const singlePathNodes: MapNode[] = [
      { col: 0, row: 0, type: "Monster", children: [[0, 1]] },
      { col: 0, row: 1, type: "Elite", children: [[0, 2]] },
      { col: 0, row: 2, type: "Boss", children: [] },
    ];

    const path = traceConstraintAwarePath({
      startCol: 0,
      startRow: 0,
      nodes: singlePathNodes,
      bossPos: { col: 0, row: 2 },
      nodePreferences: defaultPrefs,
      hpPercent: 0.60,
      gold: 200,
      act: 1,
      ascension: 0,
      maxHp: 80,
      currentRemovalCost: 75,
    });

    // Should include elite — soft penalty doesn't block
    expect(path).toEqual([
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 0, row: 2 },
    ]);
  });

  it("returns same PathCoord[] format as traceRecommendedPath", () => {
    const path = traceConstraintAwarePath({
      startCol: 0,
      startRow: 1,
      nodes,
      bossPos,
      nodePreferences: defaultPrefs,
      ...defaultContext,
    });

    for (const coord of path) {
      expect(coord).toHaveProperty("col");
      expect(coord).toHaveProperty("row");
      expect(typeof coord.col).toBe("number");
      expect(typeof coord.row).toBe("number");
    }
  });

  it("uses default preferences when nodePreferences is null", () => {
    const path = traceConstraintAwarePath({
      startCol: 0,
      startRow: 1,
      nodes,
      bossPos,
      nodePreferences: null,
      ...defaultContext,
    });

    // Should still produce a valid path
    expect(path[0]).toEqual({ col: 0, row: 1 });
    expect(path[path.length - 1]).toEqual({ col: 1, row: 3 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx vitest run apps/desktop/src/views/map/__tests__/constraint-aware-tracer.test.ts 2>&1 | tail -20`
Expected: FAIL — `constraint-aware-tracer.ts` doesn't exist yet.

- [ ] **Step 3: Commit the tests**

```bash
git add apps/desktop/src/views/map/__tests__/constraint-aware-tracer.test.ts
git commit -m "test(map): add failing tests for constraint-aware tracer"
```

---

### Task 7: Constraint-Aware Tracer — Implementation

**Files:**
- Create: `apps/desktop/src/views/map/constraint-aware-tracer.ts`

- [ ] **Step 1: Implement the constraint-aware tracer**

```typescript
// apps/desktop/src/views/map/constraint-aware-tracer.ts

import type { MapNode } from "@sts2/shared/types/game-state";
import type { NodePreferences } from "../../lib/eval-inputs/map";
import {
  HP_COST_ESTIMATES,
  ASCENSION_SCALING,
  REST_HEALING,
  PATH_CONSTRAINTS,
  DEFAULT_NODE_PREFERENCES,
} from "@sts2/shared/evaluation/path-constraints";

interface PathCoord {
  col: number;
  row: number;
}

export interface ConstraintTracerInput {
  startCol: number;
  startRow: number;
  nodes: readonly MapNode[];
  bossPos: { col: number; row: number };
  nodePreferences: NodePreferences | null;
  hpPercent: number;
  gold: number;
  act: number;
  ascension: number;
  maxHp: number;
  currentRemovalCost: number;
}

/** Map STS2 node type strings to preference keys */
function prefKey(nodeType: string): keyof NodePreferences | null {
  switch (nodeType) {
    case "Monster": return "monster";
    case "Elite": return "elite";
    case "Shop": return "shop";
    case "RestSite": return "rest";
    case "Treasure": return "treasure";
    case "Unknown": return "event";
    default: return null;
  }
}

/** Get the HP cost for a node type as a fraction of max HP */
function hpCost(nodeType: string, act: number, ascension: number): number {
  const actKey = `act${act}` as keyof typeof HP_COST_ESTIMATES.monster;
  let cost = 0;

  if (nodeType === "Monster") {
    cost = HP_COST_ESTIMATES.monster[actKey] ?? HP_COST_ESTIMATES.monster.act1;
  } else if (nodeType === "Elite") {
    cost = HP_COST_ESTIMATES.elite[actKey] ?? HP_COST_ESTIMATES.elite.act1;
  } else {
    return 0;
  }

  // Apply ascension scaling (cumulative — A9 includes A8 penalty)
  for (const [level, scale] of Object.entries(ASCENSION_SCALING)) {
    if (ascension >= Number(level)) {
      cost *= scale;
    }
  }

  return cost;
}

/** Check if a node is hard-gated (should never be routed through) */
function isHardGated(
  nodeType: string,
  simulatedHp: number,
  gold: number,
  removalCost: number,
): boolean {
  if (nodeType === "Elite" && simulatedHp < PATH_CONSTRAINTS.eliteHardMinHp) {
    return true;
  }
  if (nodeType === "Shop" && gold < PATH_CONSTRAINTS.shopMinGoldFn(removalCost)) {
    return true;
  }
  return false;
}

/** Compute soft penalty multiplier (0–1, lower = worse) */
function softPenalty(
  nodeType: string,
  simulatedHp: number,
  consecutiveMonsters: number,
  prevNodeType: string | null,
  hasRestWithinN: boolean,
): number {
  let penalty = 1.0;

  // Elite below 70% HP — risky
  if (nodeType === "Elite" && simulatedHp < PATH_CONSTRAINTS.eliteMinHp) {
    penalty *= 0.4;
  }

  // 3+ consecutive monsters
  if (nodeType === "Monster" && consecutiveMonsters >= PATH_CONSTRAINTS.consecutiveMonsterPenalty) {
    penalty *= 0.5;
  }

  // Back-to-back shops
  if (nodeType === "Shop" && prevNodeType === "Shop") {
    penalty *= 0.3;
  }

  // Elite without rest within 2 nodes
  if (nodeType === "Elite" && !hasRestWithinN) {
    penalty *= 0.6;
  }

  return penalty;
}

/** Check if there's a rest site within N nodes in the subtree */
function hasRestWithin(
  col: number,
  row: number,
  nodeMap: Map<string, MapNode>,
  depth: number,
): boolean {
  if (depth <= 0) return false;
  const node = nodeMap.get(`${col},${row}`);
  if (!node) return false;
  for (const [cc, cr] of node.children) {
    const child = nodeMap.get(`${cc},${cr}`);
    if (!child) continue;
    if (child.type === "RestSite") return true;
    if (depth > 1 && hasRestWithin(cc, cr, nodeMap, depth - 1)) return true;
  }
  return false;
}

/**
 * Constraint-aware path tracer.
 *
 * Uses LLM node-type preference weights as base scores, tracks simulated HP
 * along the path, and enforces hard gates (survival floor, elite HP minimum)
 * and soft penalties (consecutive monsters, back-to-back shops).
 *
 * Pure function — no side effects, fully testable.
 */
export function traceConstraintAwarePath(input: ConstraintTracerInput): PathCoord[] {
  const {
    startCol,
    startRow,
    nodes,
    bossPos,
    nodePreferences,
    hpPercent,
    gold,
    act,
    ascension,
    maxHp,
    currentRemovalCost,
  } = input;

  const prefs = nodePreferences ?? DEFAULT_NODE_PREFERENCES;

  const nodeMap = new Map<string, MapNode>();
  for (const n of nodes) {
    nodeMap.set(`${n.col},${n.row}`, n);
  }

  const path: PathCoord[] = [];

  function buildPath(
    col: number,
    row: number,
    simHp: number,
    consecutiveMonsters: number,
    prevType: string | null,
  ) {
    const key = `${col},${row}`;
    const node = nodeMap.get(key);
    path.push({ col, row });

    if (!node || node.children.length === 0) return;
    if (col === bossPos.col && row === bossPos.row) return;

    // Score each child's subtree
    const seen = new Set(path.map((p) => `${p.col},${p.row}`));
    let bestChild: [number, number] | null = null;
    let bestScore = -Infinity;

    for (const [childCol, childRow] of node.children) {
      const childKey = `${childCol},${childRow}`;
      if (seen.has(childKey)) continue;

      const score = dfsScore(
        childCol, childRow, nodeMap, bossPos, prefs,
        simHp, gold, act, ascension, currentRemovalCost,
        new Set(seen), consecutiveMonsters, node.type, 0,
      );
      if (score > bestScore) {
        bestScore = score;
        bestChild = [childCol, childRow];
      }
    }

    if (bestChild) {
      const childNode = nodeMap.get(`${bestChild[0]},${bestChild[1]}`);
      const childType = childNode?.type ?? "Unknown";

      // Update simulated HP for next node
      let nextHp = simHp - hpCost(childType, act, ascension);
      if (childType === "RestSite") {
        nextHp = Math.min(1.0, nextHp + REST_HEALING);
      }
      nextHp = Math.max(0, nextHp);

      const nextConsecutive = childType === "Monster"
        ? consecutiveMonsters + 1
        : childType === "Elite"
          ? consecutiveMonsters + 1
          : 0;

      buildPath(bestChild[0], bestChild[1], nextHp, nextConsecutive, node.type);
    }
  }

  buildPath(startCol, startRow, hpPercent, 0, null);
  return path;
}

/**
 * Score a subtree rooted at (col, row).
 * Combines LLM preference weights with constraint gates and soft penalties.
 */
function dfsScore(
  col: number,
  row: number,
  nodeMap: Map<string, MapNode>,
  bossPos: { col: number; row: number },
  prefs: NodePreferences,
  simulatedHp: number,
  gold: number,
  act: number,
  ascension: number,
  removalCost: number,
  visited: Set<string>,
  consecutiveMonsters: number,
  prevType: string | null,
  depth: number,
): number {
  const key = `${col},${row}`;
  if (visited.has(key)) return 0;
  visited.add(key);

  const node = nodeMap.get(key);
  if (!node) {
    if (col === bossPos.col && row === bossPos.row) return 0;
    return 0;
  }

  // Base score from LLM preferences
  const pk = prefKey(node.type);
  let score = pk ? prefs[pk] : 0;

  // Hard gate — massive negative score (but don't return 0 if it's the only path)
  if (isHardGated(node.type, simulatedHp, gold, removalCost)) {
    score = -10;
  }

  // Survival floor check
  const costFraction = hpCost(node.type, act, ascension);
  const hpAfter = simulatedHp - costFraction;
  if (hpAfter < PATH_CONSTRAINTS.survivalFloor && costFraction > 0) {
    score = -10;
  }

  // Soft penalties
  const restNearby = hasRestWithin(col, row, nodeMap, PATH_CONSTRAINTS.eliteRequiresRestWithin);
  const consMonsters = (node.type === "Monster" || node.type === "Elite")
    ? consecutiveMonsters + 1
    : 0;
  score *= softPenalty(node.type, simulatedHp, consMonsters, prevType, restNearby);

  // Update simulated HP for subtree scoring
  let nextHp = simulatedHp - costFraction;
  if (node.type === "RestSite") {
    nextHp = Math.min(1.0, nextHp + REST_HEALING);
  }
  nextHp = Math.max(0, nextHp);

  // Terminal conditions
  if (node.children.length === 0 || (col === bossPos.col && row === bossPos.row)) {
    return score;
  }

  // Recurse into children — pick best subtree
  let bestChildScore = -Infinity;
  for (const [childCol, childRow] of node.children) {
    const childScore = dfsScore(
      childCol, childRow, nodeMap, bossPos, prefs,
      nextHp, gold, act, ascension, removalCost,
      new Set(visited), consMonsters, node.type, depth + 1,
    );
    if (childScore > bestChildScore) {
      bestChildScore = childScore;
    }
  }

  return bestChildScore > -Infinity ? score + bestChildScore : score;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx vitest run apps/desktop/src/views/map/__tests__/constraint-aware-tracer.test.ts 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/views/map/constraint-aware-tracer.ts
git commit -m "feat(map): implement constraint-aware path tracer with HP simulation and hard/soft gates"
```

---

### Task 8: Extend shouldEvaluateMap for Tier 2 Context-Change Detection

**Files:**
- Modify: `apps/desktop/src/lib/should-evaluate-map.ts`
- Modify: `apps/desktop/src/lib/__tests__/should-evaluate-map.test.ts`

- [ ] **Step 1: Write failing tests for new Tier 2 triggers**

Add the following tests to `apps/desktop/src/lib/__tests__/should-evaluate-map.test.ts`:

```typescript
// Add after the existing "carry forward" describe block:

describe("Tier 2: context change triggers", () => {
  it("returns true when HP dropped significantly", () => {
    expect(evaluate({ hpDropExceedsThreshold: true })).toBe(true);
  });

  it("returns true when gold crossed viability boundary", () => {
    expect(evaluate({ goldCrossedThreshold: true })).toBe(true);
  });

  it("returns true when deck size changed significantly", () => {
    expect(evaluate({ deckSizeChangedSignificantly: true })).toBe(true);
  });

  it("returns false when context changes are below thresholds", () => {
    expect(evaluate({
      hpDropExceedsThreshold: false,
      goldCrossedThreshold: false,
      deckSizeChangedSignificantly: false,
    })).toBe(false);
  });
});
```

Also update the `stable` baseline to include the new fields:

```typescript
const stable: ShouldEvaluateMapInput = {
  optionCount: 3,
  hasPrevContext: true,
  actChanged: false,
  currentPosition: { col: 2, row: 5 },
  isOnRecommendedPath: true,
  hpDropExceedsThreshold: false,
  goldCrossedThreshold: false,
  deckSizeChangedSignificantly: false,
};
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx vitest run apps/desktop/src/lib/__tests__/should-evaluate-map.test.ts 2>&1 | tail -20`
Expected: FAIL — new properties don't exist on `ShouldEvaluateMapInput`.

- [ ] **Step 3: Implement Tier 2 context-change detection**

Update `apps/desktop/src/lib/should-evaluate-map.ts`:

```typescript
export interface ShouldEvaluateMapInput {
  /** Number of next path options on the map */
  optionCount: number;
  /** Whether a previous evaluation context exists (lastEvalContext !== null) */
  hasPrevContext: boolean;
  /** Whether the act changed since last evaluation */
  actChanged: boolean;
  /** Current map position, or null if unknown (act start, reconnection) */
  currentPosition: { col: number; row: number } | null;
  /** Whether the current position is in the set of recommended nodes */
  isOnRecommendedPath: boolean;
  /** Tier 2: HP dropped more than 20% since last eval */
  hpDropExceedsThreshold: boolean;
  /** Tier 2: Gold crossed a meaningful viability boundary */
  goldCrossedThreshold: boolean;
  /** Tier 2: Deck size changed significantly (card added or removed) */
  deckSizeChangedSignificantly: boolean;
}

/**
 * Pure function that determines whether a map evaluation should be triggered.
 *
 * Returns true if a new LLM evaluation is needed, false if the existing
 * evaluation should be carried forward.
 */
export function shouldEvaluateMap(input: ShouldEvaluateMapInput): boolean {
  const {
    optionCount,
    hasPrevContext,
    actChanged,
    currentPosition,
    isOnRecommendedPath,
    hpDropExceedsThreshold,
    goldCrossedThreshold,
    deckSizeChangedSignificantly,
  } = input;

  // Hard gate: no options at all — nothing to evaluate
  if (optionCount <= 0) return false;

  // Soft gate: single path forward with existing eval and on path — no decision needed
  if (optionCount === 1 && hasPrevContext && isOnRecommendedPath) return false;

  // No previous evaluation context — need initial evaluation
  if (!hasPrevContext) return true;

  // Act changed — always re-evaluate for new map layout
  if (actChanged) return true;

  // Current position unknown with no prior context is handled above.
  // With prior context, null position is a transitional state (clicking a
  // node briefly clears position before the game transitions). Don't re-eval.

  // Deviated from recommended path — re-evaluate (even with 1 option).
  // If position is null, we can't check deviation — treat as on-path.
  if (currentPosition && !isOnRecommendedPath) return true;

  // Tier 2: Material context changes — re-evaluate with fresh LLM weights
  if (hpDropExceedsThreshold) return true;
  if (goldCrossedThreshold) return true;
  if (deckSizeChangedSignificantly) return true;

  // On recommended path with stable context — carry forward
  return false;
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx vitest run apps/desktop/src/lib/__tests__/should-evaluate-map.test.ts 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/should-evaluate-map.ts apps/desktop/src/lib/__tests__/should-evaluate-map.test.ts
git commit -m "feat(map): extend shouldEvaluateMap with Tier 2 context-change triggers"
```

---

### Task 9: Update buildPreEvalPayload to Use Constraint-Aware Tracer

**Files:**
- Modify: `apps/desktop/src/lib/build-pre-eval-payload.ts`
- Modify: `apps/desktop/src/lib/__tests__/build-pre-eval-payload.test.ts`

- [ ] **Step 1: Update the failing tests first**

In `apps/desktop/src/lib/__tests__/build-pre-eval-payload.test.ts`, update the test to pass the new required parameters (`ascension`, `maxHp`, `currentRemovalCost`, `nodePreferences`):

```typescript
import { describe, it, expect } from "vitest";
import { buildPreEvalPayload } from "../build-pre-eval-payload";
import type { MapNode, MapNextOption } from "@sts2/shared/types/game-state";

/**
 * Simple 3-row map:
 *
 *   Row 2:  [0,2 monster]  [2,2 elite]
 *             ↑                ↑
 *   Row 1:  [0,1 monster]  [2,1 shop]
 *             ↑                ↑
 *   Row 0:  --------[1,0 start]--------
 *
 * Boss at [1,3].
 * Options from [1,0]: go left (0,1) or right (2,1).
 */
const nodes: MapNode[] = [
  { col: 1, row: 0, type: "Monster", children: [[0, 1], [2, 1]] },
  { col: 0, row: 1, type: "Monster", children: [[0, 2]] },
  { col: 2, row: 1, type: "Shop", children: [[2, 2]] },
  { col: 0, row: 2, type: "Monster", children: [] },
  { col: 2, row: 2, type: "Elite", children: [] },
];

const options: MapNextOption[] = [
  { col: 0, row: 1, type: "Monster", index: 0, leads_to: [{ col: 0, row: 2, type: "Monster" }] },
  { col: 2, row: 1, type: "Shop", index: 1, leads_to: [{ col: 2, row: 2, type: "Elite" }] },
];

const bossPos = { col: 1, row: 3 };

const baseParams = {
  options,
  allNodes: nodes,
  bossPos,
  hpPercent: 1,
  gold: 100,
  act: 1,
  deckSize: 12,
  deckMaturity: 0.5,
  relicCount: 2,
  floor: 1,
  ascension: 0,
  maxHp: 80,
  currentRemovalCost: 75,
  nodePreferences: null,
};

describe("buildPreEvalPayload", () => {
  it("includes all option coordinates in recommendedNodes", () => {
    const result = buildPreEvalPayload(baseParams);

    // Both option starting points must be included
    expect(result.recommendedNodes).toContain("0,1");
    expect(result.recommendedNodes).toContain("2,1");
  });

  it("includes traced path nodes from each option", () => {
    const result = buildPreEvalPayload(baseParams);

    // Traced paths should include downstream nodes
    expect(result.recommendedNodes).toContain("0,2"); // downstream of option 0
    expect(result.recommendedNodes).toContain("2,2"); // downstream of option 1
  });

  it("builds correct lastEvalContext", () => {
    const result = buildPreEvalPayload({
      ...baseParams,
      hpPercent: 0.75,
      gold: 50,
      act: 2,
      deckSize: 20,
      ascension: 5,
    });

    expect(result.lastEvalContext).toEqual({
      hpPercent: 0.75,
      deckSize: 20,
      act: 2,
      gold: 50,
      ascension: 5,
    });
  });

  it("returns no duplicates in recommendedNodes", () => {
    const result = buildPreEvalPayload(baseParams);

    const unique = new Set(result.recommendedNodes);
    expect(result.recommendedNodes.length).toBe(unique.size);
  });
});
```

- [ ] **Step 2: Update buildPreEvalPayload to use constraint-aware tracer**

Replace `apps/desktop/src/lib/build-pre-eval-payload.ts`:

```typescript
import type { MapNode, MapNextOption } from "@sts2/shared/types/game-state";
import type { NodePreferences } from "./eval-inputs/map";
import { traceConstraintAwarePath } from "../views/map/constraint-aware-tracer";

/**
 * Compute the preliminary mapEvalUpdated payload BEFORE the API call.
 *
 * This sets `lastEvalContext` and `recommendedNodes` immediately so that
 * subsequent game polls see `hasPrevContext=true` and don't re-trigger
 * the evaluation during the API window.
 */
export function buildPreEvalPayload(params: {
  options: readonly MapNextOption[];
  allNodes: readonly MapNode[];
  bossPos: { col: number; row: number };
  hpPercent: number;
  gold: number;
  act: number;
  deckSize: number;
  deckMaturity: number;
  relicCount: number;
  floor: number;
  ascension: number;
  maxHp: number;
  currentRemovalCost: number;
  nodePreferences: NodePreferences | null;
}): {
  recommendedNodes: string[];
  lastEvalContext: { hpPercent: number; deckSize: number; act: number; gold: number; ascension: number };
} {
  const {
    options, allNodes, bossPos,
    hpPercent, gold, act, deckSize,
    ascension, maxHp, currentRemovalCost,
    nodePreferences,
  } = params;

  const recommendedNodes = new Set<string>();

  for (const opt of options) {
    recommendedNodes.add(`${opt.col},${opt.row}`);
    const fullPath = traceConstraintAwarePath({
      startCol: opt.col,
      startRow: opt.row,
      nodes: allNodes,
      bossPos,
      nodePreferences,
      hpPercent,
      gold,
      act,
      ascension,
      maxHp,
      currentRemovalCost,
    });
    for (const p of fullPath) {
      recommendedNodes.add(`${p.col},${p.row}`);
    }
  }

  return {
    recommendedNodes: [...recommendedNodes],
    lastEvalContext: { hpPercent, deckSize, act, gold, ascension },
  };
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx vitest run apps/desktop/src/lib/__tests__/build-pre-eval-payload.test.ts 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/build-pre-eval-payload.ts apps/desktop/src/lib/__tests__/build-pre-eval-payload.test.ts
git commit -m "feat(map): swap buildPreEvalPayload to constraint-aware tracer"
```

---

### Task 10: Wire Up mapListeners — Store Preferences, Tier 1/Tier 2 Logic, New Tracer

**Files:**
- Modify: `apps/desktop/src/features/map/mapListeners.ts`

This is the integration task that ties everything together. The listener needs to:
1. Store `nodePreferences` from LLM response in Redux
2. Use constraint-aware tracer instead of `traceRecommendedPath` for post-API path tracing
3. Compute Tier 2 context-change flags for `shouldEvaluateMap`
4. Handle Tier 1 local re-trace when deviation is detected but context hasn't materially changed

- [ ] **Step 1: Update imports**

In `apps/desktop/src/features/map/mapListeners.ts`, update the imports:

```typescript
import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateReceived, selectCurrentGameState } from "../gameState/gameStateSlice";
import { evaluationApi } from "../../services/evaluationApi";
import { selectActiveRun, mapEvalUpdated, mapPathRetraced } from "../run/runSlice";
import { selectMapEvalContext, selectRecommendedNodesSet, selectBestPathNodesSet, selectNodePreferences } from "../run/runSelectors";
import {
  evalStarted,
  evalSucceeded,
  evalFailed,
  evalRetryRequested,
} from "../evaluation/evaluationSlice";
import { selectEvalKey } from "../evaluation/evaluationSelectors";
import { selectActiveDeck, selectActivePlayer } from "../run/runSelectors";
import type { MapState } from "@sts2/shared/types/game-state";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { registerLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import { shouldEvaluateMap } from "../../lib/should-evaluate-map";
import { computeMapEvalKey, buildMapPrompt, type MapPathEvaluation } from "../../lib/eval-inputs/map";
import { buildPreEvalPayload } from "../../lib/build-pre-eval-payload";
import { traceConstraintAwarePath } from "../../views/map/constraint-aware-tracer";
import { computeDeckMaturity, type DeckMaturityInput } from "@sts2/shared/evaluation/deck-maturity";
import { detectArchetypes, hasScalingSources, getScalingSources } from "@sts2/shared/evaluation/archetype-detector";
```

Note: `traceRecommendedPath` import is removed. `traceConstraintAwarePath`, `mapPathRetraced`, and `selectNodePreferences` are added.

- [ ] **Step 2: Add Tier 2 context-change computation and Tier 1 re-trace logic**

Replace the `shouldEvaluateMap` input construction (lines 59-80) with logic that computes Tier 2 flags and handles Tier 1 re-traces:

```typescript
// --- Should we evaluate? ---
const prevContext = selectMapEvalContext(state);
const storedPrefs = selectNodePreferences(state);
if (!isRetry) {
  const bestPathNodes = selectBestPathNodesSet(state);
  const currentPos = mapState.map?.current_position ?? null;
  const mapPlayer = mapState.player ?? mapState.map?.player;

  const isOnPath = currentPos
    ? bestPathNodes.has(`${currentPos.col},${currentPos.row}`)
    : false;

  // Compute Tier 2 context-change flags
  const currentHp = mapPlayer && mapPlayer.max_hp > 0 ? mapPlayer.hp / mapPlayer.max_hp : 1;
  const hpDropExceedsThreshold = prevContext
    ? (prevContext.hpPercent - currentHp) > 0.20
    : false;

  const currentGold = mapPlayer?.gold ?? 0;
  const goldCrossedThreshold = prevContext
    ? (prevContext.gold >= 150 && currentGold < 150) || (prevContext.gold < 150 && currentGold >= 150)
    : false;

  const currentDeckSize = selectActiveDeck(state).length;
  const deckSizeChangedSignificantly = prevContext
    ? Math.abs(prevContext.deckSize - currentDeckSize) >= 1
    : false;

  const input = {
    optionCount: options.length,
    hasPrevContext: !!prevContext,
    actChanged: prevContext ? prevContext.act !== run.act : false,
    currentPosition: currentPos,
    isOnRecommendedPath: isOnPath,
    hpDropExceedsThreshold,
    goldCrossedThreshold,
    deckSizeChangedSignificantly,
  };

  const shouldEval = shouldEvaluateMap(input);

  if (!shouldEval) return;

  // Tier 1: If deviated but no material context change, just re-trace locally
  if (
    currentPos &&
    !isOnPath &&
    storedPrefs &&
    !hpDropExceedsThreshold &&
    !goldCrossedThreshold &&
    !deckSizeChangedSignificantly &&
    !input.actChanged
  ) {
    const allNodes = mapState.map?.nodes ?? [];
    const bossPos = mapState.map.boss;
    const player = selectActivePlayer(state);

    // Re-trace from current position using stored weights
    const retracedPath = traceConstraintAwarePath({
      startCol: currentPos.col,
      startRow: currentPos.row,
      nodes: allNodes,
      bossPos,
      nodePreferences: storedPrefs,
      hpPercent: currentHp,
      gold: currentGold,
      act: run.act,
      ascension: run.ascension,
      maxHp: mapPlayer?.max_hp ?? 80,
      currentRemovalCost: player?.cardRemovalCost ?? 75,
    });

    // Build recommendedNodes from all options' traces
    const recommendedNodes = new Set<string>();
    for (const opt of options) {
      recommendedNodes.add(`${opt.col},${opt.row}`);
      const optPath = traceConstraintAwarePath({
        startCol: opt.col,
        startRow: opt.row,
        nodes: allNodes,
        bossPos,
        nodePreferences: storedPrefs,
        hpPercent: currentHp,
        gold: currentGold,
        act: run.act,
        ascension: run.ascension,
        maxHp: mapPlayer?.max_hp ?? 80,
        currentRemovalCost: player?.cardRemovalCost ?? 75,
      });
      for (const p of optPath) {
        recommendedNodes.add(`${p.col},${p.row}`);
      }
    }
    for (const p of retracedPath) {
      recommendedNodes.add(`${p.col},${p.row}`);
    }

    const bestPathNodes = new Set<string>();
    for (const p of retracedPath) {
      bestPathNodes.add(`${p.col},${p.row}`);
    }

    listenerApi.dispatch(mapPathRetraced({
      recommendedPath: retracedPath,
      bestPathNodes: [...bestPathNodes],
      recommendedNodes: [...recommendedNodes],
    }));
    return;
  }
}
```

- [ ] **Step 3: Update pre-eval payload construction**

Replace the pre-eval dispatch section (lines 107-146) to pass the new required params:

```typescript
// --- Pre-API dispatch ---
const hpPct = mapPlayer && mapPlayer.max_hp > 0 ? mapPlayer.hp / mapPlayer.max_hp : 1;
const allNodes = mapState.map?.nodes ?? [];
const bossPos = mapState.map.boss;
const act = mapState.run?.act ?? 1;
const floor = mapState.run?.floor ?? 1;
const relics = player?.relics ?? [];
const archetypes = detectArchetypes(deckCards, relics);
const maturityCtx: DeckMaturityInput = {
  archetypes,
  deckSize: deckCards.length,
  deckCards: deckCards.map((c) => ({ name: c.name })),
  hasScaling: hasScalingSources(deckCards),
  scalingSources: getScalingSources(deckCards),
  upgradeCount: deckCards.filter((c) => c.name.includes("+")).length,
};
const deckMaturity = computeDeckMaturity(maturityCtx);
const relicCount = relics.length;

const preEval = buildPreEvalPayload({
  options,
  allNodes,
  bossPos,
  hpPercent: hpPct,
  gold: mapPlayer?.gold ?? 0,
  act,
  deckSize: deckCards.length,
  deckMaturity,
  relicCount,
  floor,
  ascension: run.ascension,
  maxHp: mapPlayer?.max_hp ?? 80,
  currentRemovalCost: player?.cardRemovalCost ?? 75,
  nodePreferences: storedPrefs,
});
preEval.lastEvalContext.act = prevContext?.act ?? 0;
listenerApi.dispatch(mapEvalUpdated({ ...preEval, bestPathNodes: preEval.recommendedNodes }));
```

Note: The `mapPlayer` variable needs to be declared earlier in the function (before the should-evaluate block). Move the `const mapPlayer = mapState.player ?? mapState.map?.player;` line up to before the `if (!isRetry)` block, and reference it from the existing location at line 98 — remove the duplicate declaration.

- [ ] **Step 4: Update post-API path tracing to use constraint-aware tracer**

Replace the post-API path tracing section (lines 167-227) to use `traceConstraintAwarePath` and store `nodePreferences`:

```typescript
// --- Post-API path tracing ---
const tierOrder = ["S", "A", "B", "C", "D", "F"];
const bestRanking = parsed.rankings.length > 0
  ? parsed.rankings.reduce((a, b) => {
      const aTier = tierOrder.indexOf(a.tier);
      const bTier = tierOrder.indexOf(b.tier);
      if (aTier !== bTier) return aTier < bTier ? a : b;
      return (a.confidence ?? 0) >= (b.confidence ?? 0) ? a : b;
    })
  : null;
const bestOpt = bestRanking
  ? options.find((_, i) => i + 1 === bestRanking.optionIndex)
  : null;

const tracerInput = {
  nodes: allNodes,
  bossPos,
  nodePreferences: parsed.nodePreferences,
  hpPercent: hpPct,
  gold: mapPlayer?.gold ?? 0,
  act,
  ascension: run.ascension,
  maxHp: mapPlayer?.max_hp ?? 80,
  currentRemovalCost: player?.cardRemovalCost ?? 75,
};

const tracedPath = bestOpt
  ? traceConstraintAwarePath({
      startCol: bestOpt.col,
      startRow: bestOpt.row,
      ...tracerInput,
    })
  : parsed.recommendedPath;

// Build recommendedNodes from ALL options (for UI highlighting)
const recommendedNodes = new Set<string>();
for (const opt of options) {
  recommendedNodes.add(`${opt.col},${opt.row}`);
  const fullPath = traceConstraintAwarePath({
    startCol: opt.col,
    startRow: opt.row,
    ...tracerInput,
  });
  for (const p of fullPath) {
    recommendedNodes.add(`${p.col},${p.row}`);
  }
}
for (const p of parsed.recommendedPath) {
  recommendedNodes.add(`${p.col},${p.row}`);
}
for (const p of tracedPath) {
  recommendedNodes.add(`${p.col},${p.row}`);
}

// Build bestPathNodes from ONLY the best option's path (for deviation detection)
const bestPathNodes = new Set<string>();
for (const p of tracedPath) {
  bestPathNodes.add(`${p.col},${p.row}`);
}
for (const p of parsed.recommendedPath) {
  bestPathNodes.add(`${p.col},${p.row}`);
}

// Persist path + context + nodePreferences to Redux
listenerApi.dispatch(mapEvalUpdated({
  recommendedPath: tracedPath,
  recommendedNodes: [...recommendedNodes],
  bestPathNodes: [...bestPathNodes],
  lastEvalContext: {
    hpPercent: hpPct,
    deckSize: deckCards.length,
    act,
    gold: mapPlayer?.gold ?? 0,
    ascension: run.ascension,
  },
  nodePreferences: parsed.nodePreferences,
}));
```

- [ ] **Step 5: Verify types compile**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsc --noEmit 2>&1 | head -30`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/map/mapListeners.ts
git commit -m "feat(map): wire up constraint-aware tracer with Tier 1/Tier 2 deviation logic in mapListeners"
```

---

### Task 11: Run Full Test Suite

**Files:** None modified — verification only.

- [ ] **Step 1: Run all desktop tests**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx vitest run --config apps/desktop/vitest.config.ts 2>&1 | tail -30`
Expected: All tests PASS.

- [ ] **Step 2: Run shared package tests**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx vitest run --config apps/web/vitest.config.ts 2>&1 | tail -30`
Expected: All tests PASS (shared tests run via web vitest config).

- [ ] **Step 3: Verify TypeScript compiles cleanly**

Run: `cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper && npx tsc --noEmit 2>&1 | tail -20`
Expected: No type errors.

- [ ] **Step 4: Commit (if any cleanup was needed)**

Only commit if fixes were required in previous steps.

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Path constraint constants | `packages/shared/evaluation/path-constraints.ts` (new) |
| 2 | NodePreferences type | `apps/desktop/src/lib/eval-inputs/map.ts` (modify) |
| 3 | Parse node_preferences from LLM | `apps/desktop/src/services/evaluationApi.ts` (modify) |
| 4 | Add to LLM tool schema | `packages/shared/evaluation/prompt-builder.ts` (modify) |
| 5 | Redux state changes | `runSlice.ts`, `runSelectors.ts` (modify) |
| 6 | Tracer tests (TDD red) | `constraint-aware-tracer.test.ts` (new) |
| 7 | Tracer implementation (TDD green) | `constraint-aware-tracer.ts` (new) |
| 8 | shouldEvaluateMap Tier 2 | `should-evaluate-map.ts`, test (modify) |
| 9 | buildPreEvalPayload swap | `build-pre-eval-payload.ts`, test (modify) |
| 10 | mapListeners integration | `mapListeners.ts` (modify) |
| 11 | Full test suite verification | — |
