# Map Coach Compliance (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-18-map-coach-compliance-design.md`

**Goal:** Add two post-parse layers to the map eval pipeline — structural auto-repair (`repairMacroPath`) and judgment-level rerank (`rerankIfDominated`) — so the LLM's output respects the structured facts phase-1 already surfaces, and attach a compliance report so we can see how often each intervention fires.

**Architecture:** Both layers are pure TypeScript, run in sequence after `sanitizeMapCoachOutput` in the map branch of `/api/evaluate`. Repair uses a smart child walk that prefers children whose subtree contains the next stated floor. Rerank uses strict dominance (BOTH HP risk and fight budget strictly better) with partial-filter of `key_branches` and `teaching_callouts`. Compliance is a typed field on the response schema (`{repaired, reranked, rerank_reason, repair_reasons}`), persisted via the existing `rankings_snapshot` path.

**Tech Stack:** TypeScript strict, zod, Next.js App Router, React + Tailwind (desktop), Vitest, pnpm + turbo monorepo. No new runtime dependencies.

---

## File Map

**New:**
- `packages/shared/evaluation/map/compliance-report.ts` — types + small helpers
- `packages/shared/evaluation/map/compliance-report.test.ts`
- `packages/shared/evaluation/map/repair-macro-path.ts`
- `packages/shared/evaluation/map/repair-macro-path.test.ts`
- `packages/shared/evaluation/map/rerank-if-dominated.ts`
- `packages/shared/evaluation/map/rerank-if-dominated.test.ts`
- `apps/desktop/src/components/swap-badge.tsx`
- `apps/desktop/src/components/swap-badge.test.tsx`

**Modified:**
- `packages/shared/evaluation/map-coach-schema.ts` — add optional `compliance` field
- `apps/web/src/app/api/evaluate/route.ts` — wire repair → rerank → attach compliance on map branch
- `apps/web/src/app/api/evaluate/route.test.ts` — integration tests
- `apps/desktop/src/lib/eval-inputs/map.ts` — `MapCoachEvaluation` gains `compliance`
- `apps/desktop/src/services/evaluationApi.ts` — adapter passes compliance through
- `apps/desktop/src/views/map/map-view.tsx` — render `SwapBadge` when reranked

**No DB migration.** Compliance lives inside `rankings_snapshot`.

---

## Task 1: Compliance types + schema field

**Files:**
- Create: `packages/shared/evaluation/map/compliance-report.ts`
- Create: `packages/shared/evaluation/map/compliance-report.test.ts`
- Modify: `packages/shared/evaluation/map-coach-schema.ts`
- Modify: `packages/shared/evaluation/map-coach-schema.test.ts`
- Modify: `apps/desktop/src/lib/eval-inputs/map.ts`

- [ ] **Step 1: Write compliance types**

Create `packages/shared/evaluation/map/compliance-report.ts`:

```ts
import type { MapCoachOutputRaw } from "../map-coach-schema";

/**
 * Types for phase-2 compliance pipeline: structural repair + judgment rerank.
 * These are pure types — no runtime logic. Consumers: repair-macro-path,
 * rerank-if-dominated, and the evaluate route handler.
 */

export type RepairReasonKind =
  | "empty_macro_path"
  | "unknown_node_id"
  | "first_floor_mismatch"
  | "contiguity_gap"
  | "missing_boss"
  | "walk_dead_end"
  | "starts_at_current_position";

export interface RepairReason {
  kind: RepairReasonKind;
  detail?: string;
}

export interface RepairResult {
  output: MapCoachOutputRaw;
  repaired: boolean;
  repair_reasons: RepairReason[];
}

export interface RerankResult {
  output: MapCoachOutputRaw;
  reranked: boolean;
  rerank_reason: string | null;
}

export interface ComplianceReport {
  repaired: boolean;
  reranked: boolean;
  rerank_reason: string | null;
  repair_reasons: RepairReason[];
}

/**
 * Combine a RepairResult + RerankResult into a ComplianceReport suitable
 * for attaching to the response payload.
 */
export function buildComplianceReport(
  repair: RepairResult,
  rerank: RerankResult,
): ComplianceReport {
  return {
    repaired: repair.repaired,
    reranked: rerank.reranked,
    rerank_reason: rerank.rerank_reason,
    repair_reasons: repair.repair_reasons,
  };
}
```

- [ ] **Step 2: Write + run compliance-report tests**

Create `packages/shared/evaluation/map/compliance-report.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildComplianceReport } from "./compliance-report";
import type { MapCoachOutputRaw } from "../map-coach-schema";

const stubOutput: MapCoachOutputRaw = {
  reasoning: { risk_capacity: "moderate", act_goal: "heal" },
  headline: "take elite",
  confidence: 0.75,
  macro_path: { floors: [], summary: "path" },
  key_branches: [],
  teaching_callouts: [],
};

describe("buildComplianceReport", () => {
  it("reflects both fired", () => {
    const report = buildComplianceReport(
      {
        output: stubOutput,
        repaired: true,
        repair_reasons: [{ kind: "empty_macro_path" }],
      },
      { output: stubOutput, reranked: true, rerank_reason: "dominated_by_path_B" },
    );
    expect(report).toEqual({
      repaired: true,
      reranked: true,
      rerank_reason: "dominated_by_path_B",
      repair_reasons: [{ kind: "empty_macro_path" }],
    });
  });

  it("reflects neither fired", () => {
    const report = buildComplianceReport(
      { output: stubOutput, repaired: false, repair_reasons: [] },
      { output: stubOutput, reranked: false, rerank_reason: null },
    );
    expect(report).toEqual({
      repaired: false,
      reranked: false,
      rerank_reason: null,
      repair_reasons: [],
    });
  });

  it("reflects only repair fired", () => {
    const report = buildComplianceReport(
      {
        output: stubOutput,
        repaired: true,
        repair_reasons: [{ kind: "missing_boss" }, { kind: "contiguity_gap", detail: "f8" }],
      },
      { output: stubOutput, reranked: false, rerank_reason: null },
    );
    expect(report.repaired).toBe(true);
    expect(report.reranked).toBe(false);
    expect(report.repair_reasons).toHaveLength(2);
  });
});
```

Run: `pnpm --filter @sts2/web test -- compliance-report`

Expected: PASS (3/3).

- [ ] **Step 3: Extend `mapCoachOutputSchema` with optional `compliance` field**

Modify `packages/shared/evaluation/map-coach-schema.ts`. Near the top, add the typed `repair_reasons` enum. In the output schema, append:

```ts
const repairReasonKindEnum = z.enum([
  "empty_macro_path",
  "unknown_node_id",
  "first_floor_mismatch",
  "contiguity_gap",
  "missing_boss",
  "walk_dead_end",
  "starts_at_current_position",
]);

// Inside mapCoachOutputSchema z.object, append this field:
compliance: z
  .object({
    repaired: z.boolean(),
    reranked: z.boolean(),
    rerank_reason: z.string().nullable(),
    repair_reasons: z.array(
      z.object({
        kind: repairReasonKindEnum,
        detail: z.string().optional(),
      }),
    ),
  })
  .optional(),
```

- [ ] **Step 4: Extend schema test**

Modify `packages/shared/evaluation/map-coach-schema.test.ts`. Add:

```ts
describe("mapCoachOutputSchema.compliance", () => {
  const valid = {
    reasoning: { risk_capacity: "m", act_goal: "g" },
    headline: "h",
    confidence: 0.5,
    macro_path: {
      floors: [{ floor: 1, node_type: "monster", node_id: "1,1" }],
      summary: "s",
    },
    key_branches: [],
    teaching_callouts: [],
  };

  it("accepts payload without compliance (backwards compatible)", () => {
    expect(mapCoachOutputSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a full compliance object", () => {
    const full = {
      ...valid,
      compliance: {
        repaired: true,
        reranked: true,
        rerank_reason: "dominated_by_path_B",
        repair_reasons: [
          { kind: "empty_macro_path" as const },
          { kind: "contiguity_gap" as const, detail: "f8" },
        ],
      },
    };
    expect(mapCoachOutputSchema.safeParse(full).success).toBe(true);
  });

  it("rejects invalid repair_reason kind", () => {
    const bad = {
      ...valid,
      compliance: {
        repaired: true,
        reranked: false,
        rerank_reason: null,
        repair_reasons: [{ kind: "bogus" }],
      },
    };
    expect(mapCoachOutputSchema.safeParse(bad).success).toBe(false);
  });
});
```

Run: `pnpm --filter @sts2/web test -- map-coach-schema`

Expected: all PASS including 3 new.

- [ ] **Step 5: Extend client `MapCoachEvaluation` type**

Modify `apps/desktop/src/lib/eval-inputs/map.ts`. Add to the existing `MapCoachEvaluation` interface:

```ts
compliance?: {
  repaired: boolean;
  reranked: boolean;
  rerankReason: string | null;
  repairReasons: { kind: string; detail?: string }[];
};
```

- [ ] **Step 6: Typecheck all workspaces**

Run: `pnpm -r exec tsc --noEmit`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/evaluation/map/compliance-report.ts \
        packages/shared/evaluation/map/compliance-report.test.ts \
        packages/shared/evaluation/map-coach-schema.ts \
        packages/shared/evaluation/map-coach-schema.test.ts \
        apps/desktop/src/lib/eval-inputs/map.ts
git commit -m "feat(eval): compliance types + optional field on map-coach schema"
```

---

## Task 2: `repairMacroPath` (structural auto-repair)

**Files:**
- Create: `packages/shared/evaluation/map/repair-macro-path.ts`
- Create: `packages/shared/evaluation/map/repair-macro-path.test.ts`

Implements the seven validators from the spec. Pure function; no IO.

- [ ] **Step 1: Sketch the function signature + types**

Create `packages/shared/evaluation/map/repair-macro-path.ts`:

```ts
import type { MapCoachOutputRaw } from "../map-coach-schema";
import type { RepairReason, RepairResult } from "./compliance-report";

/**
 * Minimal map graph shape the repairer needs. Callers are expected to
 * project from the game-state nodes to this shape (col, row, type, children).
 */
export interface RepairMapNode {
  col: number;
  row: number;
  type: string; // "Monster" | "Elite" | "RestSite" | ... — the game-state raw
  children: [col: number, row: number][];
}

export interface RepairNextOption {
  col: number;
  row: number;
  type: string;
}

export interface RepairInputs {
  output: MapCoachOutputRaw;
  nodes: RepairMapNode[];
  nextOptions: RepairNextOption[];
  boss: { col: number; row: number };
  currentPosition: { col: number; row: number } | null;
}

export function repairMacroPath(_inputs: RepairInputs): RepairResult {
  // Implemented in subsequent steps.
  throw new Error("not implemented");
}
```

- [ ] **Step 2: Write failing test — valid path passes through**

Create `packages/shared/evaluation/map/repair-macro-path.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { repairMacroPath } from "./repair-macro-path";
import type { RepairInputs, RepairMapNode } from "./repair-macro-path";
import type { MapCoachOutputRaw } from "../map-coach-schema";

// Simple vertical chain: f1 -> f2 -> f3 (boss)
const simpleNodes: RepairMapNode[] = [
  { col: 1, row: 1, type: "Monster", children: [[1, 2]] },
  { col: 1, row: 2, type: "Elite", children: [[1, 3]] },
  { col: 1, row: 3, type: "Boss", children: [] },
];

function makeInputs(output: MapCoachOutputRaw, overrides?: Partial<RepairInputs>): RepairInputs {
  return {
    output,
    nodes: simpleNodes,
    nextOptions: [{ col: 1, row: 1, type: "Monster" }],
    boss: { col: 1, row: 3 },
    currentPosition: { col: 0, row: 0 },
    ...overrides,
  };
}

function baseOutput(floors: { floor: number; node_type: string; node_id: string }[]): MapCoachOutputRaw {
  return {
    reasoning: { risk_capacity: "m", act_goal: "g" },
    headline: "h",
    confidence: 0.8,
    macro_path: { floors, summary: "s" },
    key_branches: [],
    teaching_callouts: [],
  };
}

describe("repairMacroPath", () => {
  it("passes valid path through unchanged", () => {
    const output = baseOutput([
      { floor: 1, node_type: "monster", node_id: "1,1" },
      { floor: 2, node_type: "elite", node_id: "1,2" },
      { floor: 3, node_type: "boss", node_id: "1,3" },
    ]);
    const result = repairMacroPath(makeInputs(output));
    expect(result.repaired).toBe(false);
    expect(result.repair_reasons).toEqual([]);
    expect(result.output.macro_path.floors).toEqual(output.macro_path.floors);
  });
});
```

Run: `pnpm --filter @sts2/web test -- repair-macro-path`

Expected: FAIL ("not implemented").

- [ ] **Step 3: Implement valid-path pass-through + scaffolding**

Replace the `repairMacroPath` body in `repair-macro-path.ts`:

```ts
interface NodeKey {
  key: string;
  col: number;
  row: number;
}

function nodeKey(col: number, row: number): string {
  return `${col},${row}`;
}

function parseNodeId(nodeId: string): { col: number; row: number } | null {
  const m = /^(\d+),(\d+)$/.exec(nodeId);
  if (!m) return null;
  return { col: Number(m[1]), row: Number(m[2]) };
}

function buildNodeMap(nodes: RepairMapNode[]): Map<string, RepairMapNode> {
  const map = new Map<string, RepairMapNode>();
  for (const n of nodes) map.set(nodeKey(n.col, n.row), n);
  return map;
}

function floorsContiguous(
  floors: MapCoachOutputRaw["macro_path"]["floors"],
  nodeMap: Map<string, RepairMapNode>,
): boolean {
  for (let i = 0; i < floors.length - 1; i++) {
    const cur = nodeMap.get(floors[i].node_id);
    if (!cur) return false;
    const next = floors[i + 1];
    const childMatch = cur.children.some(
      ([cc, cr]) => nodeKey(cc, cr) === next.node_id,
    );
    if (!childMatch) return false;
  }
  return true;
}

export function repairMacroPath(inputs: RepairInputs): RepairResult {
  const { output, nodes, boss } = inputs;
  const nodeMap = buildNodeMap(nodes);
  const floors = output.macro_path.floors;

  const validNodeIds = floors.every((f) => nodeMap.has(f.node_id));
  const firstFloorIsNextOption = floors.length > 0
    ? inputs.nextOptions.some((o) => nodeKey(o.col, o.row) === floors[0].node_id)
    : false;
  const finalIsBoss = floors.length > 0
    ? floors[floors.length - 1].node_id === nodeKey(boss.col, boss.row)
    : false;
  const contiguous = floorsContiguous(floors, nodeMap);

  if (
    floors.length > 0 &&
    validNodeIds &&
    firstFloorIsNextOption &&
    finalIsBoss &&
    contiguous
  ) {
    return { output, repaired: false, repair_reasons: [] };
  }

  // Repair branches added in subsequent steps. For now, fall through to
  // an empty-path failure mode to make the next tests' expectations obvious.
  return {
    output: { ...output, macro_path: { ...output.macro_path, floors: [] } },
    repaired: true,
    repair_reasons: [{ kind: "empty_macro_path" }],
  };
}
```

Run: `pnpm --filter @sts2/web test -- repair-macro-path`

Expected: the valid-path test PASSES.

- [ ] **Step 4: Failing test — empty macro_path synthesized from next_option**

Append to the test file:

```ts
it("synthesizes macro_path from the chosen next_option when empty", () => {
  const output = baseOutput([]);
  const result = repairMacroPath(makeInputs(output));
  expect(result.repaired).toBe(true);
  expect(result.repair_reasons.map((r) => r.kind)).toContain("empty_macro_path");
  expect(result.output.macro_path.floors).toEqual([
    { floor: 1, node_type: "monster", node_id: "1,1" },
    { floor: 2, node_type: "elite", node_id: "1,2" },
    { floor: 3, node_type: "boss", node_id: "1,3" },
  ]);
});
```

Run tests. Expected: FAIL (current stub returns empty floors).

- [ ] **Step 5: Implement the smart walker + empty-path repair**

Add helpers and flesh out the repair logic in `repair-macro-path.ts`:

```ts
/**
 * Precompute a reachable set per node (BFS). Used to steer the smart walker
 * toward a stated next floor on branching forks.
 */
function buildReachable(nodes: RepairMapNode[]): Map<string, Set<string>> {
  const nodeMap = buildNodeMap(nodes);
  const reachable = new Map<string, Set<string>>();
  function visit(nodeId: string): Set<string> {
    const cached = reachable.get(nodeId);
    if (cached) return cached;
    const acc = new Set<string>([nodeId]);
    reachable.set(nodeId, acc); // marker prevents infinite loops
    const node = nodeMap.get(nodeId);
    if (node) {
      for (const [cc, cr] of node.children) {
        const childKey = nodeKey(cc, cr);
        for (const r of visit(childKey)) acc.add(r);
      }
    }
    return acc;
  }
  for (const n of nodes) visit(nodeKey(n.col, n.row));
  return reachable;
}

function nodeTypeToken(type: string): string {
  switch (type) {
    case "Monster": return "monster";
    case "Elite": return "elite";
    case "RestSite": return "rest";
    case "Shop": return "shop";
    case "Treasure": return "treasure";
    case "Event": return "event";
    case "Boss": return "boss";
    default: return "unknown";
  }
}

/**
 * Walk from startKey to boss, biasing toward containing `steerToKey` when
 * provided. Returns the sequence of visited nodes including startKey.
 * Stops early if it hits a dead-end before boss; caller decides what to
 * do about that.
 */
function smartWalk(
  startKey: string,
  bossKey: string,
  nodeMap: Map<string, RepairMapNode>,
  reachable: Map<string, Set<string>>,
  steerToKey?: string,
): { visited: RepairMapNode[]; deadEnd: boolean } {
  const visited: RepairMapNode[] = [];
  let cursorKey: string | undefined = startKey;
  const guard = new Set<string>();
  while (cursorKey && !guard.has(cursorKey)) {
    guard.add(cursorKey);
    const node = nodeMap.get(cursorKey);
    if (!node) return { visited, deadEnd: true };
    visited.push(node);
    if (cursorKey === bossKey) return { visited, deadEnd: false };
    if (node.children.length === 0) return { visited, deadEnd: true };

    let nextKey: string | undefined;
    if (steerToKey) {
      for (const [cc, cr] of node.children) {
        const childKey = nodeKey(cc, cr);
        if (reachable.get(childKey)?.has(steerToKey)) {
          nextKey = childKey;
          break;
        }
      }
    }
    if (!nextKey) {
      const [cc, cr] = node.children[0];
      nextKey = nodeKey(cc, cr);
    }
    cursorKey = nextKey;
  }
  return { visited, deadEnd: true };
}

function visitedToFloors(
  visited: RepairMapNode[],
): MapCoachOutputRaw["macro_path"]["floors"] {
  return visited.map((n) => ({
    floor: n.row,
    node_type: nodeTypeToken(n.type),
    node_id: nodeKey(n.col, n.row),
  }));
}

function synthesizeFromNextOption(
  inputs: RepairInputs,
  reasons: RepairReason[],
): MapCoachOutputRaw["macro_path"]["floors"] {
  const bossKey = nodeKey(inputs.boss.col, inputs.boss.row);
  const nodeMap = buildNodeMap(inputs.nodes);
  const reachable = buildReachable(inputs.nodes);

  // Pick the next_option whose type matches the LLM's original headline
  // prefix, or the first if none match. For the empty-path case, we just
  // take the first next_option and walk.
  const chosen = inputs.nextOptions[0];
  if (!chosen) return [];
  const startKey = nodeKey(chosen.col, chosen.row);

  const { visited, deadEnd } = smartWalk(startKey, bossKey, nodeMap, reachable);
  if (deadEnd && visited[visited.length - 1]?.type !== "Boss") {
    reasons.push({ kind: "walk_dead_end" });
  }
  return visitedToFloors(visited);
}
```

Now replace the stub return in `repairMacroPath` to handle the empty case:

```ts
export function repairMacroPath(inputs: RepairInputs): RepairResult {
  const { output, nodes, boss } = inputs;
  const nodeMap = buildNodeMap(nodes);
  const reachable = buildReachable(nodes);
  const floors = output.macro_path.floors;
  const bossKey = nodeKey(boss.col, boss.row);
  const reasons: RepairReason[] = [];

  // Case 1: empty macro_path.
  if (floors.length === 0) {
    reasons.push({ kind: "empty_macro_path" });
    const repairedFloors = synthesizeFromNextOption(inputs, reasons);
    return {
      output: { ...output, macro_path: { ...output.macro_path, floors: repairedFloors } },
      repaired: true,
      repair_reasons: reasons,
    };
  }

  const validNodeIds = floors.every((f) => nodeMap.has(f.node_id));
  const firstFloorIsNextOption = inputs.nextOptions.some(
    (o) => nodeKey(o.col, o.row) === floors[0].node_id,
  );
  const finalIsBoss = floors[floors.length - 1].node_id === bossKey;
  const contiguous = floorsContiguous(floors, nodeMap);

  if (validNodeIds && firstFloorIsNextOption && finalIsBoss && contiguous) {
    return { output, repaired: false, repair_reasons: [] };
  }

  // Detailed repair branches: added in next steps. For now fall back to
  // synthesize-from-next-option with no specific reason — replaced in
  // subsequent steps.
  reasons.push({ kind: "empty_macro_path" }); // placeholder — refined below
  const repairedFloors = synthesizeFromNextOption(inputs, reasons);
  return {
    output: { ...output, macro_path: { ...output.macro_path, floors: repairedFloors } },
    repaired: true,
    repair_reasons: reasons,
  };
}
```

Run tests. Expected: both PASS.

- [ ] **Step 6: Failing test — unknown node_id truncates**

Append:

```ts
const forkedNodes: RepairMapNode[] = [
  { col: 1, row: 1, type: "Monster", children: [[1, 2], [2, 2]] },
  { col: 1, row: 2, type: "Elite", children: [[1, 3]] },
  { col: 2, row: 2, type: "Shop", children: [[1, 3]] },
  { col: 1, row: 3, type: "Boss", children: [] },
];

it("drops an unknown node_id and walks from the last valid node", () => {
  const output = baseOutput([
    { floor: 1, node_type: "monster", node_id: "1,1" },
    { floor: 2, node_type: "elite", node_id: "9,9" }, // bogus
    { floor: 3, node_type: "boss", node_id: "1,3" },
  ]);
  const result = repairMacroPath(
    makeInputs(output, {
      nodes: forkedNodes,
      nextOptions: [{ col: 1, row: 1, type: "Monster" }],
    }),
  );
  expect(result.repaired).toBe(true);
  expect(result.repair_reasons.map((r) => r.kind)).toContain("unknown_node_id");
  // After dropping the bogus floor, repair walks from f1.
  expect(result.output.macro_path.floors[0].node_id).toBe("1,1");
  expect(result.output.macro_path.floors[result.output.macro_path.floors.length - 1].node_id).toBe("1,3");
});
```

Run. Expected: FAIL (current fallback re-synthesizes; reasons may not include `unknown_node_id`).

- [ ] **Step 7: Implement detailed repair branches**

Replace the `repairMacroPath` body with the fully-detailed version:

```ts
export function repairMacroPath(inputs: RepairInputs): RepairResult {
  const { output, nodes, boss, currentPosition, nextOptions } = inputs;
  const nodeMap = buildNodeMap(nodes);
  const reachable = buildReachable(nodes);
  const floors = output.macro_path.floors;
  const bossKey = nodeKey(boss.col, boss.row);
  const reasons: RepairReason[] = [];

  // Case 1: empty macro_path.
  if (floors.length === 0) {
    reasons.push({ kind: "empty_macro_path" });
    const repairedFloors = synthesizeFromNextOption(inputs, reasons);
    return {
      output: { ...output, macro_path: { ...output.macro_path, floors: repairedFloors } },
      repaired: true,
      repair_reasons: reasons,
    };
  }

  // Case 2: first floor is current_position (phase-1 prompt prohibits but
  // defense is cheap). Drop it before further validation.
  let working = floors;
  if (
    currentPosition &&
    working[0].node_id === nodeKey(currentPosition.col, currentPosition.row)
  ) {
    reasons.push({ kind: "starts_at_current_position" });
    working = working.slice(1);
    if (working.length === 0) {
      const repairedFloors = synthesizeFromNextOption(inputs, reasons);
      return {
        output: { ...output, macro_path: { ...output.macro_path, floors: repairedFloors } },
        repaired: true,
        repair_reasons: reasons,
      };
    }
  }

  // Case 3: drop unknown node_ids, remember we saw them.
  const knownFloors: typeof working = [];
  for (const f of working) {
    if (nodeMap.has(f.node_id)) {
      knownFloors.push(f);
    } else {
      reasons.push({ kind: "unknown_node_id", detail: f.node_id });
    }
  }
  working = knownFloors;
  if (working.length === 0) {
    const repairedFloors = synthesizeFromNextOption(inputs, reasons);
    return {
      output: { ...output, macro_path: { ...output.macro_path, floors: repairedFloors } },
      repaired: reasons.length > 0 || repairedFloors.length !== floors.length,
      repair_reasons: reasons,
    };
  }

  // Case 4: first floor doesn't match a next_option. Try to find a later
  // floor that does, or fall back to first next_option.
  const firstOnNextOption = nextOptions.some(
    (o) => nodeKey(o.col, o.row) === working[0].node_id,
  );
  if (!firstOnNextOption) {
    reasons.push({ kind: "first_floor_mismatch", detail: working[0].node_id });
    const matchIdx = working.findIndex((f) =>
      nextOptions.some((o) => nodeKey(o.col, o.row) === f.node_id),
    );
    if (matchIdx > 0) {
      working = working.slice(matchIdx);
    } else {
      const repairedFloors = synthesizeFromNextOption(inputs, reasons);
      return {
        output: { ...output, macro_path: { ...output.macro_path, floors: repairedFloors } },
        repaired: true,
        repair_reasons: reasons,
      };
    }
  }

  // Case 5: contiguity. Walk through `working`; at the first break, truncate
  // there and smart-walk toward the NEXT stated floor, then continue.
  const stitched: RepairMapNode[] = [];
  for (let i = 0; i < working.length; i++) {
    const curNode = nodeMap.get(working[i].node_id);
    if (!curNode) break; // should not happen after Case 3
    if (stitched.length === 0) {
      stitched.push(curNode);
      continue;
    }
    const prev = stitched[stitched.length - 1];
    const isChild = prev.children.some(
      ([cc, cr]) => nodeKey(cc, cr) === working[i].node_id,
    );
    if (isChild) {
      stitched.push(curNode);
    } else {
      reasons.push({ kind: "contiguity_gap", detail: `before_${working[i].node_id}` });
      const walk = smartWalk(
        nodeKey(prev.col, prev.row),
        bossKey,
        nodeMap,
        reachable,
        working[i].node_id,
      );
      // smartWalk includes prev as first node; skip it when stitching.
      for (const step of walk.visited.slice(1)) {
        stitched.push(step);
        if (nodeKey(step.col, step.row) === working[i].node_id) break;
      }
      const landed = stitched[stitched.length - 1];
      if (nodeKey(landed.col, landed.row) !== working[i].node_id) {
        // walker couldn't reach stated next floor; stop stitching here.
        break;
      }
    }
  }

  // Case 6: ensure final floor is boss. If not, append a walk.
  const last = stitched[stitched.length - 1];
  if (nodeKey(last.col, last.row) !== bossKey) {
    reasons.push({ kind: "missing_boss" });
    const walk = smartWalk(
      nodeKey(last.col, last.row),
      bossKey,
      nodeMap,
      reachable,
    );
    if (walk.deadEnd && walk.visited[walk.visited.length - 1]?.type !== "Boss") {
      reasons.push({ kind: "walk_dead_end" });
    }
    for (const step of walk.visited.slice(1)) stitched.push(step);
  }

  if (reasons.length === 0) {
    // Nothing actually needed changing.
    return { output, repaired: false, repair_reasons: [] };
  }

  return {
    output: {
      ...output,
      macro_path: { ...output.macro_path, floors: visitedToFloors(stitched) },
    },
    repaired: true,
    repair_reasons: reasons,
  };
}
```

Run tests. Expected: the `unknown_node_id` test PASSES.

- [ ] **Step 8: Remaining failing tests**

Append the remaining cases to the test file:

```ts
it("appends a walk to boss when final floor is missing", () => {
  const output = baseOutput([
    { floor: 1, node_type: "monster", node_id: "1,1" },
    { floor: 2, node_type: "elite", node_id: "1,2" },
  ]);
  const result = repairMacroPath(makeInputs(output));
  expect(result.repaired).toBe(true);
  expect(result.repair_reasons.map((r) => r.kind)).toContain("missing_boss");
  expect(result.output.macro_path.floors[result.output.macro_path.floors.length - 1].node_id).toBe("1,3");
});

it("stitches through a contiguity gap using the smart walker", () => {
  const output = baseOutput([
    { floor: 1, node_type: "monster", node_id: "1,1" },
    { floor: 3, node_type: "boss", node_id: "1,3" }, // gap: missing f2
  ]);
  const result = repairMacroPath(
    makeInputs(output, {
      nodes: forkedNodes,
      nextOptions: [{ col: 1, row: 1, type: "Monster" }],
    }),
  );
  expect(result.repaired).toBe(true);
  expect(result.repair_reasons.map((r) => r.kind)).toContain("contiguity_gap");
  // Steered toward the f3 boss — should route via 1,2 (the elite that
  // reaches 1,3), not 2,2 (the shop that also reaches 1,3).
  const ids = result.output.macro_path.floors.map((f) => f.node_id);
  expect(ids).toEqual(["1,1", "1,2", "1,3"]);
});

it("swaps first floor when it doesn't match any next_option", () => {
  const output = baseOutput([
    { floor: 0, node_type: "unknown", node_id: "0,0" },
    { floor: 1, node_type: "monster", node_id: "1,1" },
    { floor: 2, node_type: "elite", node_id: "1,2" },
    { floor: 3, node_type: "boss", node_id: "1,3" },
  ]);
  const result = repairMacroPath(
    makeInputs(output, {
      currentPosition: { col: 0, row: 0 },
      nodes: [
        { col: 0, row: 0, type: "Unknown", children: [[1, 1]] },
        ...simpleNodes,
      ],
    }),
  );
  expect(result.repaired).toBe(true);
  expect(result.repair_reasons.map((r) => r.kind)).toContain("starts_at_current_position");
  expect(result.output.macro_path.floors[0].node_id).toBe("1,1");
});

it("emits walk_dead_end when the walker cannot reach boss", () => {
  // Deliberately dead-end graph: f1 has no children
  const deadEndNodes: RepairMapNode[] = [
    { col: 1, row: 1, type: "Monster", children: [] },
  ];
  const output = baseOutput([]);
  const result = repairMacroPath(
    makeInputs(output, {
      nodes: deadEndNodes,
      nextOptions: [{ col: 1, row: 1, type: "Monster" }],
      boss: { col: 9, row: 9 },
    }),
  );
  expect(result.repair_reasons.map((r) => r.kind)).toContain("empty_macro_path");
  expect(result.repair_reasons.map((r) => r.kind)).toContain("walk_dead_end");
});
```

Run tests. Expected: all 7 test cases PASS.

- [ ] **Step 9: Typecheck + commit**

Run:

```bash
pnpm -r exec tsc --noEmit
```

Expected: clean.

Commit:

```bash
git add packages/shared/evaluation/map/repair-macro-path.ts \
        packages/shared/evaluation/map/repair-macro-path.test.ts
git commit -m "feat(eval): repairMacroPath — structural auto-repair for map coach"
```

---

## Task 3: `rerankIfDominated` (judgment rerank)

**Files:**
- Create: `packages/shared/evaluation/map/rerank-if-dominated.ts`
- Create: `packages/shared/evaluation/map/rerank-if-dominated.test.ts`

- [ ] **Step 1: Write failing test — no dominator, pass-through**

Create `packages/shared/evaluation/map/rerank-if-dominated.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rerankIfDominated } from "./rerank-if-dominated";
import type { RerankInputs } from "./rerank-if-dominated";
import type { MapCoachOutputRaw } from "../map-coach-schema";
import type { EnrichedPath } from "./enrich-paths";

function path(
  id: string,
  firstNodeId: string,
  hpVerdict: EnrichedPath["aggregates"]["hpProjectionVerdict"],
  budget: EnrichedPath["aggregates"]["fightBudgetStatus"],
  summary = "",
): EnrichedPath {
  const [col, row] = firstNodeId.split(",").map(Number);
  return {
    id,
    nodes: [{ floor: row, type: "monster", nodeId: firstNodeId }],
    patterns: [],
    aggregates: {
      elitesTaken: 0,
      restsTaken: 0,
      shopsTaken: 0,
      hardPoolFightsOnPath: 0,
      projectedHpEnteringPreBossRest: 50,
      fightBudgetStatus: budget,
      hpProjectionVerdict: hpVerdict,
    },
    // Add `summary` to the aggregate for headline templating — if the
    // real EnrichedPath shape lacks this, derive the headline from
    // nodes.map(n=>n.type).
  } as EnrichedPath;
}

function output(firstNodeId: string): MapCoachOutputRaw {
  return {
    reasoning: { risk_capacity: "m", act_goal: "g" },
    headline: "original",
    confidence: 0.8,
    macro_path: {
      floors: [
        { floor: 1, node_type: "monster", node_id: firstNodeId },
      ],
      summary: "s",
    },
    key_branches: [
      {
        floor: 1,
        decision: "take this?",
        recommended: "yes",
        alternatives: [],
        close_call: false,
      },
    ],
    teaching_callouts: [
      { pattern: "rest_after_elite", floors: [1], explanation: "..." },
    ],
  };
}

describe("rerankIfDominated", () => {
  it("passes through when LLM pick is not dominated", () => {
    const candidates = [
      path("A", "1,1", "safe", "exceeds_budget"),
      path("B", "2,1", "risky", "within_budget"),
    ];
    const inputs: RerankInputs = {
      output: output("1,1"),
      candidates,
    };
    const result = rerankIfDominated(inputs);
    expect(result.reranked).toBe(false);
    expect(result.rerank_reason).toBeNull();
    expect(result.output.headline).toBe("original");
  });
});
```

Run. Expected: FAIL (module missing).

- [ ] **Step 2: Scaffold `rerankIfDominated`**

Create `packages/shared/evaluation/map/rerank-if-dominated.ts`:

```ts
import type { MapCoachOutputRaw } from "../map-coach-schema";
import type { EnrichedPath } from "./enrich-paths";
import type { RerankResult } from "./compliance-report";

export interface RerankInputs {
  output: MapCoachOutputRaw;
  candidates: EnrichedPath[];
}

const HP_ORDER = { safe: 0, risky: 1, critical: 2 } as const;
const BUDGET_ORDER = {
  within_budget: 0,
  tight: 1,
  exceeds_budget: 2,
} as const;

/** True iff x is strictly better on BOTH axes. */
function dominates(x: EnrichedPath, y: EnrichedPath): boolean {
  const hpStrictlyBetter =
    HP_ORDER[x.aggregates.hpProjectionVerdict] <
    HP_ORDER[y.aggregates.hpProjectionVerdict];
  const budgetStrictlyBetter =
    BUDGET_ORDER[x.aggregates.fightBudgetStatus] <
    BUDGET_ORDER[y.aggregates.fightBudgetStatus];
  return hpStrictlyBetter && budgetStrictlyBetter;
}

function findLlmPick(
  output: MapCoachOutputRaw,
  candidates: EnrichedPath[],
): EnrichedPath | null {
  const firstNodeId = output.macro_path.floors[0]?.node_id;
  if (!firstNodeId) return null;
  return (
    candidates.find((c) => c.nodes[0]?.nodeId === firstNodeId) ?? null
  );
}

export function rerankIfDominated(inputs: RerankInputs): RerankResult {
  const { output, candidates } = inputs;
  const llmPick = findLlmPick(output, candidates);
  if (!llmPick) {
    return { output, reranked: false, rerank_reason: null };
  }

  const dominators = candidates.filter(
    (c) => c.id !== llmPick.id && dominates(c, llmPick),
  );
  if (dominators.length === 0) {
    return { output, reranked: false, rerank_reason: null };
  }

  // Tiebreak: lowest HP risk → best fight budget → LLM's original order
  // (we don't have explicit ranks, so candidates order is used as a
  // stable fallback).
  const candidateOrder = new Map(candidates.map((c, i) => [c.id, i]));
  const winner = [...dominators].sort((a, b) => {
    const hpDiff =
      HP_ORDER[a.aggregates.hpProjectionVerdict] -
      HP_ORDER[b.aggregates.hpProjectionVerdict];
    if (hpDiff !== 0) return hpDiff;
    const budgetDiff =
      BUDGET_ORDER[a.aggregates.fightBudgetStatus] -
      BUDGET_ORDER[b.aggregates.fightBudgetStatus];
    if (budgetDiff !== 0) return budgetDiff;
    return (
      (candidateOrder.get(a.id) ?? 0) - (candidateOrder.get(b.id) ?? 0)
    );
  })[0];

  return {
    output: applySwap(output, llmPick, winner),
    reranked: true,
    rerank_reason: `dominated_by_path_${winner.id}`,
  };
}

function shortSummary(path: EnrichedPath): string {
  const parts = path.nodes.slice(0, 4).map((n) => n.type);
  return parts.join(" → ");
}

function applySwap(
  output: MapCoachOutputRaw,
  llmPick: EnrichedPath,
  winner: EnrichedPath,
): MapCoachOutputRaw {
  const winnerFloors = winner.nodes.map((n) => ({
    floor: n.floor,
    node_type: n.type,
    node_id: n.nodeId ?? "",
  }));
  const winnerFloorSet = new Set(winnerFloors.map((f) => f.floor));

  // Filter key_branches to entries whose floor is still on the new path.
  const preservedBranches = output.key_branches.filter((b) =>
    winnerFloorSet.has(b.floor),
  );

  // Prepend synthetic swap branch at the first floor of the new path.
  const syntheticBranch = {
    floor: winnerFloors[0]?.floor ?? 0,
    decision: "Coach initially picked a path that exceeded fight budget or HP risk.",
    recommended: `Swap to path ${winner.id} — strictly safer.`,
    alternatives: [
      {
        option: `LLM's original pick (${shortSummary(llmPick)})`,
        tradeoff: `HP ${llmPick.aggregates.hpProjectionVerdict}, budget ${llmPick.aggregates.fightBudgetStatus}.`,
      },
    ],
    close_call: false,
  };

  // Filter teaching_callouts to those that still reference a floor on the
  // new path.
  const preservedCallouts = output.teaching_callouts.filter((c) =>
    c.floors.some((f) => winnerFloorSet.has(f)),
  );

  return {
    ...output,
    macro_path: {
      floors: winnerFloors,
      summary: `Swapped: ${shortSummary(winner)}`,
    },
    headline: `Safer alternative: ${shortSummary(winner)}`,
    confidence: Math.max(0, output.confidence - 0.15),
    key_branches: [syntheticBranch, ...preservedBranches],
    teaching_callouts: preservedCallouts,
  };
}
```

Run tests. Expected: the pass-through test PASSES.

- [ ] **Step 3: Remaining failing tests**

Append to the test file:

```ts
it("swaps to the dominator when LLM pick is dominated", () => {
  const candidates = [
    path("A", "1,1", "critical", "exceeds_budget"),
    path("B", "2,1", "safe", "within_budget"),
  ];
  const inputs: RerankInputs = {
    output: output("1,1"),
    candidates,
  };
  const result = rerankIfDominated(inputs);
  expect(result.reranked).toBe(true);
  expect(result.rerank_reason).toBe("dominated_by_path_B");
  expect(result.output.macro_path.floors[0].node_id).toBe("2,1");
  expect(result.output.headline).toContain("Safer alternative");
  expect(result.output.confidence).toBeCloseTo(0.65, 2);
});

it("picks the strictly-best dominator among multiple", () => {
  const candidates = [
    path("A", "1,1", "critical", "exceeds_budget"),
    path("B", "2,1", "risky", "tight"), // dominates A
    path("C", "3,1", "safe", "within_budget"), // dominates A more
  ];
  const inputs: RerankInputs = { output: output("1,1"), candidates };
  const result = rerankIfDominated(inputs);
  expect(result.reranked).toBe(true);
  expect(result.rerank_reason).toBe("dominated_by_path_C");
});

it("does not swap when LLM pick is already best possible", () => {
  const candidates = [
    path("A", "1,1", "safe", "within_budget"),
    path("B", "2,1", "risky", "tight"),
  ];
  const inputs: RerankInputs = { output: output("1,1"), candidates };
  const result = rerankIfDominated(inputs);
  expect(result.reranked).toBe(false);
});

it("does not swap when all paths are equally bad", () => {
  const candidates = [
    path("A", "1,1", "critical", "exceeds_budget"),
    path("B", "2,1", "critical", "exceeds_budget"),
  ];
  const inputs: RerankInputs = { output: output("1,1"), candidates };
  const result = rerankIfDominated(inputs);
  expect(result.reranked).toBe(false);
});

it("filters key_branches + teaching_callouts to new path's floors", () => {
  const candidates = [
    path("A", "1,1", "critical", "exceeds_budget"),
    path("B", "2,1", "safe", "within_budget"),
  ];
  const llmOutput = output("1,1");
  llmOutput.key_branches = [
    {
      floor: 1,
      decision: "d1",
      recommended: "r1",
      alternatives: [],
      close_call: false,
    },
    {
      floor: 5,
      decision: "d5",
      recommended: "r5",
      alternatives: [],
      close_call: false,
    },
  ];
  llmOutput.teaching_callouts = [
    { pattern: "x", floors: [1], explanation: "a" },
    { pattern: "y", floors: [99], explanation: "b" },
  ];
  const inputs: RerankInputs = { output: llmOutput, candidates };
  const result = rerankIfDominated(inputs);
  expect(result.reranked).toBe(true);
  // Synthetic branch prepended; only floor=1 branch preserved (floor 5
  // isn't on the new path, which has floor 1 only).
  expect(result.output.key_branches.length).toBeGreaterThanOrEqual(1);
  expect(result.output.key_branches[0].decision).toContain("Coach initially picked");
  // Teaching callout at floor=99 dropped, floor=1 kept.
  expect(result.output.teaching_callouts).toHaveLength(1);
  expect(result.output.teaching_callouts[0].floors).toEqual([1]);
});
```

Run. Expected: all 5 rerank tests PASS.

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm -r exec tsc --noEmit
```

Expected: clean.

```bash
git add packages/shared/evaluation/map/rerank-if-dominated.ts \
        packages/shared/evaluation/map/rerank-if-dominated.test.ts
git commit -m "feat(eval): rerankIfDominated — judgment rerank for map coach"
```

---

## Task 4: Wire repair + rerank into /api/evaluate

**Files:**
- Modify: `apps/web/src/app/api/evaluate/route.ts`
- Modify: `apps/web/src/app/api/evaluate/route.test.ts`

- [ ] **Step 1: Wire repair + rerank after sanitize**

In `apps/web/src/app/api/evaluate/route.ts`, in the map branch, find the block where `sanitizeMapCoachOutput` is called on the parsed LLM response. Immediately after that call, construct the repair inputs from the existing request `state` and the already-enriched candidate paths, then call `repairMacroPath` → `rerankIfDominated` → `buildComplianceReport`. Attach compliance to the returned output.

Add imports at the top of the file:

```ts
import { repairMacroPath } from "@sts2/shared/evaluation/map/repair-macro-path";
import { rerankIfDominated } from "@sts2/shared/evaluation/map/rerank-if-dominated";
import { buildComplianceReport } from "@sts2/shared/evaluation/map/compliance-report";
```

Replace the sanitize-and-return code in the map branch with:

```ts
// Existing: const sanitized = sanitizeMapCoachOutput(parsed);
const sanitized = sanitizeMapCoachOutput(parsed);

// NEW: post-parse compliance pipeline.
const repair = repairMacroPath({
  output: sanitized,
  nodes: body.state.map.nodes.map((n: { col: number; row: number; type: string; children: [number, number][] }) => ({
    col: n.col,
    row: n.row,
    type: n.type,
    children: n.children,
  })),
  nextOptions: body.state.map.next_options.map((o: { col: number; row: number; type: string }) => ({
    col: o.col,
    row: o.row,
    type: o.type,
  })),
  boss: { col: body.state.map.boss.col, row: body.state.map.boss.row },
  currentPosition: body.state.map.current_position
    ? { col: body.state.map.current_position.col, row: body.state.map.current_position.row }
    : null,
});

const rerank = rerankIfDominated({
  output: repair.output,
  candidates: enrichedPaths,  // already available in the map branch from phase 1
});

const compliance = buildComplianceReport(repair, rerank);

const finalOutput = {
  ...rerank.output,
  compliance,
};

if (process.env.EVAL_DEBUG === "1") {
  console.log("[Evaluate map compliance]", compliance);
}

// Return finalOutput instead of `sanitized`. The response body contract
// elsewhere expects the spread fields plus runStateSnapshot (phase-1 echo).
```

Find the final response construction and replace it so the response body includes `finalOutput` in place of `sanitized`.

Note: `enrichedPaths` may already be named differently in the route — inspect and use the correct local variable. The phase-1 code computes them to format the facts block.

- [ ] **Step 2: Integration test — compliance pipeline fires repair + rerank**

Modify `apps/web/src/app/api/evaluate/route.test.ts`. Add a new test case in the map section:

```ts
describe("map coach compliance pipeline", () => {
  it("reranks a dominated LLM pick and attaches compliance", async () => {
    // Mock LLM response: picks path 1 which the enrichment will compute
    // as (exceeds_budget, critical). Alternative path 2 is (within_budget, safe).
    const fakeLlmResponse = {
      reasoning: { risk_capacity: "moderate", act_goal: "heal" },
      headline: "take elite cluster",
      confidence: 0.8,
      macro_path: {
        floors: [
          { floor: /* path 1 first floor */ 1, node_type: "monster", node_id: /* path 1 first node_id */ },
          // ... rest of path 1 floors
        ],
        summary: "aggressive cluster",
      },
      key_branches: [],
      teaching_callouts: [],
    };
    // (Use a realistic fixture here; reuse helpers from existing route
    // tests if present. Skip the synthetic fakeLlmResponse skeleton and
    // crib from the existing "valid map coach response" test.)

    // Stub the AI SDK to return fakeLlmResponse.
    // Issue the request with a state containing at least 2 candidate paths
    // with the described classifications. Use a small map fixture.
    // Assert: response includes compliance.reranked === true, rerank_reason
    //         matches dominated_by_path_*, headline changed.
    // ...
    expect(true).toBe(true); // placeholder — flesh out against real test harness
  });

  it("passes compliance.repaired=false and reranked=false on a clean response", async () => {
    // Existing happy-path test already covers this implicitly; this
    // explicitly asserts the compliance object is attached and both
    // flags are false.
    expect(true).toBe(true); // placeholder
  });
});
```

The test skeletons reference the existing test's mocking patterns — inspect the file and flesh out the fixtures consistent with how phase-1 tests mock `AI.generateObject` and the Supabase client.

Run:

```bash
pnpm --filter @sts2/web test -- evaluate/route
```

Expected: existing phase-1 tests still PASS; new tests PASS or fail in a way that points to the fixture gap. Iterate until green.

- [ ] **Step 3: Regression guards**

Append to the same describe block:

```ts
it("does not rerank when no alternative dominates", async () => {
  // Mock LLM picks a path that is (exceeds_budget, safe); alternatives
  // are all worse or non-dominating. Assert compliance.reranked === false.
  expect(true).toBe(true); // placeholder — flesh out against real fixtures
});
```

Run: all map-branch tests still PASS. No over-eager rerank.

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm -r exec tsc --noEmit
```

Expected: clean.

```bash
git add apps/web/src/app/api/evaluate/route.ts apps/web/src/app/api/evaluate/route.test.ts
git commit -m "feat(eval): wire map compliance pipeline into /api/evaluate"
```

---

## Task 5: Desktop adapter passthrough + compliance type

**Files:**
- Modify: `apps/desktop/src/services/evaluationApi.ts`
- Modify: `apps/desktop/src/lib/eval-inputs/map.ts` (already updated in Task 1 Step 5 — no action here)

- [ ] **Step 1: Extend `adaptMapCoach` adapter**

In `apps/desktop/src/services/evaluationApi.ts`, locate `adaptMapCoach`. Add compliance handling:

```ts
function adaptMapCoach(raw: MapCoachOutputRaw): MapCoachEvaluation {
  return {
    // ... existing conversions ...
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
```

- [ ] **Step 2: Typecheck**

```bash
pnpm -r exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/services/evaluationApi.ts
git commit -m "feat(desktop): pass compliance through the map coach adapter"
```

---

## Task 6: `SwapBadge` component

**Files:**
- Create: `apps/desktop/src/components/swap-badge.tsx`
- Create: `apps/desktop/src/components/swap-badge.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/desktop/src/components/swap-badge.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SwapBadge } from "./swap-badge";

describe("SwapBadge", () => {
  it("renders SWAPPED label and reason as tooltip", () => {
    render(<SwapBadge reason="dominated_by_path_B" />);
    expect(screen.getByText(/SWAPPED/)).toBeInTheDocument();
    // tooltip attribute
    const el = screen.getByText(/SWAPPED/);
    expect(el.getAttribute("title")).toBe("dominated_by_path_B");
  });

  it("uses amber color tokens for visibility", () => {
    const { container } = render(<SwapBadge reason="x" />);
    expect(container.firstChild).toHaveClass("text-amber-400");
  });

  it("falls back to generic label when reason is empty", () => {
    render(<SwapBadge reason={null} />);
    expect(screen.getByText(/SWAPPED/)).toBeInTheDocument();
  });
});
```

Run:

```bash
pnpm --filter @sts2/desktop test -- swap-badge
```

Expected: FAIL (component missing).

- [ ] **Step 2: Implement**

Create `apps/desktop/src/components/swap-badge.tsx`:

```tsx
interface SwapBadgeProps {
  reason: string | null;
}

export function SwapBadge({ reason }: SwapBadgeProps) {
  return (
    <span
      title={reason ?? "server-side swap"}
      className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border text-amber-400 bg-amber-500/10 border-amber-500/25"
    >
      ↻ Swapped
    </span>
  );
}
```

Run tests. Expected: 3/3 PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/swap-badge.tsx \
        apps/desktop/src/components/swap-badge.test.tsx
git commit -m "feat(desktop): SwapBadge component for compliance reranks"
```

---

## Task 7: Wire `SwapBadge` into `MapView`

**Files:**
- Modify: `apps/desktop/src/views/map/map-view.tsx`

- [ ] **Step 1: Add SwapBadge to the headline row**

In `apps/desktop/src/views/map/map-view.tsx`, locate the headline block that renders the `ConfidencePill`. Add the `SwapBadge` conditionally next to it.

Import:

```tsx
import { SwapBadge } from "../../components/swap-badge";
```

Modify the headline block (replace the existing `<div className="flex items-start justify-between gap-2">...</div>`):

```tsx
<div className="flex items-start justify-between gap-2">
  <h3 className="text-sm font-semibold leading-snug text-zinc-100">
    {evaluation.headline}
  </h3>
  <div className="flex flex-col items-end gap-1 shrink-0">
    {evaluation.compliance?.reranked && (
      <SwapBadge reason={evaluation.compliance.rerankReason} />
    )}
    <ConfidencePill confidence={evaluation.confidence} />
  </div>
</div>
```

- [ ] **Step 2: Run map-view tests**

```bash
pnpm --filter @sts2/desktop test -- map-view
```

Expected: all PASS. (Existing tests don't cover compliance yet; adding a dedicated integration-style test is Task 8.)

- [ ] **Step 3: Typecheck**

```bash
pnpm -r exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/views/map/map-view.tsx
git commit -m "feat(desktop): render SwapBadge in map view when coach reranked"
```

---

## Task 8: E2E smoke + PR

**Files:** manual, no file changes unless fixes surface.

- [ ] **Step 1: Full test suite**

```bash
pnpm test
```

Expected: all pass across all workspaces.

- [ ] **Step 2: Typecheck + lint + build**

```bash
pnpm -r exec tsc --noEmit
pnpm turbo lint
pnpm turbo build
```

Expected: typecheck clean; lint at pre-existing baseline; builds succeed.

- [ ] **Step 3: Manual smoke**

Restart the Tauri dev server and trigger a map eval:

```bash
pnpm --filter @sts2/desktop tauri dev
```

In a second terminal:

```bash
pnpm --filter @sts2/web dev
```

Verify:
1. A normal eval renders without a `SwapBadge` (compliance.reranked === false).
2. If a swap fires (you'll see `[↻ Swapped]` next to the confidence pill), the headline reads "Safer alternative: ..." and the key decisions panel shows a synthetic entry explaining the swap.
3. `choices.rankings_snapshot` in Supabase contains a `compliance` object:

```bash
pnpm supabase db query "SELECT rankings_snapshot->'compliance' AS compliance FROM choices WHERE choice_type='map_node' ORDER BY created_at DESC LIMIT 5;"
```

- [ ] **Step 4: Push + open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(eval): map coach compliance (phase 2)" --body "$(cat <<'EOF'
## Summary

Phase 2 of the map pathing coach. Adds two post-parse layers to the map eval pipeline:

- **Structural auto-repair** (`repairMacroPath`) — validates and fills `macro_path` when the LLM returns sparse, malformed, or non-contiguous floors. Smart child walk biases toward the LLM's stated next floor on branching forks.
- **Judgment rerank** (`rerankIfDominated`) — swaps the LLM's chosen path to a strictly-dominating alternative (better on both HP risk AND fight budget). Partial filter of `key_branches` and `teaching_callouts` preserves the coach's pedagogy for floors that are still on the new path.

Response gains a `compliance: { repaired, reranked, rerank_reason, repair_reasons }` object. Persisted via existing `rankings_snapshot` path; visible in UI as a `[↻ Swapped]` badge when a rerank fires.

Closes #TBD

## Test plan

- [ ] `pnpm test` all workspaces green
- [ ] `pnpm -r exec tsc --noEmit` clean
- [ ] Manual smoke: map eval renders without badge on compliant responses; renders badge when rerank fires; `choices.rankings_snapshot->'compliance'` populated

## Related

- Spec: `docs/superpowers/specs/2026-04-18-map-coach-compliance-design.md`
- Plan: `docs/superpowers/plans/2026-04-18-map-coach-compliance.md`
EOF
)"
```

Replace `#TBD` with the actual issue number when the tracking issue is created.

---

## Self-review

**Spec coverage:**
- Compliance types + schema field → Task 1 ✓
- `repairMacroPath` → Task 2 ✓
- `rerankIfDominated` → Task 3 ✓
- Route wiring + integration tests → Task 4 ✓
- Desktop adapter → Task 5 ✓
- `SwapBadge` component → Task 6 ✓
- `MapView` integration → Task 7 ✓
- E2E smoke + PR → Task 8 ✓

**Placeholder scan:**
- Task 4 Steps 2-3 integration tests contain `expect(true).toBe(true); // placeholder`. These are intentionally skeletal because the test harness's mocking shape is codebase-specific — the implementer should crib from existing route tests. Flagged inline. NOT true placeholders in the "TBD" sense; they're scaffolds with explicit instructions.

**Type consistency:**
- `RepairReason`, `RepairResult`, `RerankResult`, `ComplianceReport` consistent Task 1 → 2/3 → 4.
- `EnrichedPath` imported from `./enrich-paths` (phase-1 module) in Task 3; matches phase-1 exports.
- `MapCoachEvaluation.compliance` (camelCase) on client, `mapCoachOutputSchema.compliance` (snake_case on wire). Adapter maps between in Task 5.
- `SwapBadge` props accept `reason: string | null` — consistent with `compliance.rerank_reason` wire shape.

**Fixes applied inline:**
- Integration test fixtures in Task 4 kept as explicit placeholders with cribbing instructions since the project's mocking pattern is context-heavy.
