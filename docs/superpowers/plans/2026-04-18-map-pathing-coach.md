# Map Pathing Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-18-map-pathing-coach-design.md`

**Goal:** Replace the current map eval output (per-option rankings + `overall_advice` text) with a coaching-shaped response: deterministic run-state enrichment + pattern annotations feed a reasoning-scaffolded prompt; the LLM returns `{reasoning, headline, confidence, macro_path, key_branches[], teaching_callouts[]}`, rendered by a new teaching-first UI.

**Architecture:** Three layers wrap the existing `POST /api/evaluate` (map branch). A deterministic TypeScript layer computes `RunState` and tags each candidate path with `PathPattern[]`. The prompt is restructured into a facts block + reasoning scaffold, with rules that used to be in prose now computed upstream. The LLM output schema changes, the desktop map view is re-laid-out to foreground reasoning and teaching, and `mapListeners` derives the recommended path from `macro_path` instead of per-option rankings. A new `choices.run_state_snapshot` column captures structured state for phase-2 calibration.

**Tech Stack:** TypeScript strict, zod, Next.js App Router route handlers (web), React + Redux Toolkit + Tailwind (desktop), Vitest, Supabase Postgres, Claude Haiku 4.5 via AI SDK, pnpm + turbo monorepo.

---

## File Map

**New:**
- `packages/shared/evaluation/map-coach-schema.ts` — zod schemas + TS types for new output
- `packages/shared/evaluation/map-coach-schema.test.ts`
- `apps/web/src/evaluation/map/run-state.ts` — pure computations
- `apps/web/src/evaluation/map/run-state.test.ts`
- `apps/web/src/evaluation/map/path-patterns.ts` — pure pattern detectors
- `apps/web/src/evaluation/map/path-patterns.test.ts`
- `apps/web/src/evaluation/map/enrich-paths.ts` — orchestrator
- `apps/web/src/evaluation/map/enrich-paths.test.ts`
- `apps/web/src/evaluation/map/format-facts-block.ts` — structured facts formatter
- `apps/web/src/evaluation/map/format-facts-block.test.ts`
- `apps/desktop/src/components/branch-card.tsx`
- `apps/desktop/src/components/teaching-callouts.tsx`
- `apps/desktop/src/components/confidence-pill.tsx`
- `apps/web/scripts/map-coach-backtest.ts`
- `supabase/migrations/026_choices_run_state_snapshot.sql`

**Modified:**
- `packages/shared/evaluation/eval-schemas.ts` — export new map coach schema next to legacy
- `packages/shared/evaluation/prompt-builder.ts` — add `MAP_PATHING_SCAFFOLD`, trim `TYPE_ADDENDA["map"]`
- `apps/web/src/app/api/evaluate/route.ts` — map branch calls enrichment, uses new schema, writes `run_state_snapshot`
- `apps/desktop/src/lib/eval-inputs/map.ts` — replace `buildMapPrompt`, add `MapCoachEvaluation` type
- `apps/desktop/src/services/evaluationApi.ts` — adapt snake→camel for new fields
- `apps/desktop/src/views/map/map-view.tsx` — replace sidebar rendering, use `macro_path` for best-node highlight
- `apps/desktop/src/features/map/mapListeners.ts` — derive `recommendedPath` from `macro_path`

---

## Task 1: Output schema + client types

**Files:**
- Create: `packages/shared/evaluation/map-coach-schema.ts`
- Create: `packages/shared/evaluation/map-coach-schema.test.ts`
- Modify: `apps/desktop/src/lib/eval-inputs/map.ts`

- [ ] **Step 1: Write failing schema tests**

Create `packages/shared/evaluation/map-coach-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapCoachOutputSchema } from "./map-coach-schema";

describe("mapCoachOutputSchema", () => {
  const valid = {
    reasoning: { risk_capacity: "Moderate buffer.", act_goal: "Heal to 70%+." },
    headline: "Take f25 elite, rest, treasure.",
    confidence: 0.82,
    macro_path: {
      floors: [
        { floor: 24, node_type: "monster", node_id: "24,2" },
        { floor: 25, node_type: "elite", node_id: "25,3" },
      ],
      summary: "Elite into rest into treasure.",
    },
    key_branches: [
      {
        floor: 25,
        decision: "Elite or Monster?",
        recommended: "Elite",
        alternatives: [{ option: "Monster", tradeoff: "Safer, lose relic." }],
        close_call: false,
      },
    ],
    teaching_callouts: [
      { pattern: "rest_after_elite", floors: [26], explanation: "Heals elite cost." },
    ],
  };

  it("parses a valid payload", () => {
    expect(mapCoachOutputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects more than 3 key_branches", () => {
    const tooMany = { ...valid, key_branches: Array(4).fill(valid.key_branches[0]) };
    expect(mapCoachOutputSchema.safeParse(tooMany).success).toBe(false);
  });

  it("rejects more than 4 teaching_callouts", () => {
    const tooMany = { ...valid, teaching_callouts: Array(5).fill(valid.teaching_callouts[0]) };
    expect(mapCoachOutputSchema.safeParse(tooMany).success).toBe(false);
  });

  it("requires reasoning fields", () => {
    const missing = { ...valid, reasoning: { risk_capacity: "" } };
    expect(mapCoachOutputSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects confidence out of range", () => {
    expect(mapCoachOutputSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @sts2/shared test -- map-coach-schema
```

Expected: FAIL — `map-coach-schema.ts` does not exist.

- [ ] **Step 3: Implement the schema**

Create `packages/shared/evaluation/map-coach-schema.ts`:

```ts
import { z } from "zod";

/**
 * Server output schema for map pathing coach evals. snake_case on the wire to
 * match Claude's output; camelCase conversion lives in the desktop adapter.
 *
 * The `.max(N)` caps on key_branches and teaching_callouts are enforced
 * schema-level because low-value padding is a specific failure mode we need
 * to reject hard. If Anthropic's structured-output endpoint rejects these
 * (it has in the past for the `rankings` array — see eval-schemas.ts
 * header), relax to `.describe()` prompt-level enforcement and filter in
 * the route handler.
 */

const nodeTypeEnum = z.enum([
  "monster",
  "elite",
  "rest",
  "shop",
  "treasure",
  "event",
  "unknown",
]);

export const mapCoachOutputSchema = z.object({
  reasoning: z.object({
    risk_capacity: z.string().min(1),
    act_goal: z.string().min(1),
  }),
  headline: z.string().min(1),
  confidence: z.number().min(0).max(1),
  macro_path: z.object({
    floors: z.array(
      z.object({
        floor: z.number(),
        node_type: nodeTypeEnum,
        node_id: z.string(),
      }),
    ),
    summary: z.string().min(1),
  }),
  key_branches: z
    .array(
      z.object({
        floor: z.number(),
        decision: z.string(),
        recommended: z.string(),
        alternatives: z.array(
          z.object({
            option: z.string(),
            tradeoff: z.string(),
          }),
        ),
        close_call: z.boolean(),
      }),
    )
    .max(3),
  teaching_callouts: z
    .array(
      z.object({
        pattern: z.string(),
        floors: z.array(z.number()),
        explanation: z.string(),
      }),
    )
    .max(4),
});

export type MapCoachOutputRaw = z.infer<typeof mapCoachOutputSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @sts2/shared test -- map-coach-schema
```

Expected: PASS (all 5 tests).

- [ ] **Step 5: Add client-side type in map.ts**

In `apps/desktop/src/lib/eval-inputs/map.ts`, add the following type export (append near the existing `MapPathEvaluation` interface; do not delete `MapPathEvaluation` yet — it's removed in Task 9):

```ts
export interface MapCoachEvaluation {
  reasoning: { riskCapacity: string; actGoal: string };
  headline: string;
  confidence: number;
  macroPath: {
    floors: { floor: number; nodeType: string; nodeId: string }[];
    summary: string;
  };
  keyBranches: {
    floor: number;
    decision: string;
    recommended: string;
    alternatives: { option: string; tradeoff: string }[];
    closeCall: boolean;
  }[];
  teachingCallouts: { pattern: string; floors: number[]; explanation: string }[];
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/evaluation/map-coach-schema.ts \
        packages/shared/evaluation/map-coach-schema.test.ts \
        apps/desktop/src/lib/eval-inputs/map.ts
git commit -m "feat(eval): add map coach output schema + client type"
```

---

## Task 2: Run-state types and computations

**Files:**
- Create: `apps/web/src/evaluation/map/run-state.ts`
- Create: `apps/web/src/evaluation/map/run-state.test.ts`

Covers: HP/elite/gold/monster-pool/pre-boss-rest facts plus the top-level `computeRunState` orchestrator. Pure functions, no IO.

- [ ] **Step 1: Write the types and scaffold**

Create `apps/web/src/evaluation/map/run-state.ts` with types only first:

```ts
/**
 * Pure deterministic computation of run state facts that feed the map
 * coaching prompt. No IO. Inputs are a snapshot of player + map state
 * (shape already passed to /api/evaluate map branch).
 */

export type RiskVerdict = "abundant" | "moderate" | "tight" | "critical";

export interface RunState {
  hp: { current: number; max: number; ratio: number };
  gold: number;
  act: 1 | 2 | 3;
  floor: number;
  floorsRemainingInAct: number;
  ascension: number;
  deck: {
    size: number;
    archetype: string | null; // phase 1: always null
    avgUpgradeRatio: number;
    removalCandidates: number;
  };
  relics: { combatRelevant: string[]; pathAffecting: string[] };
  riskCapacity: {
    hpBufferAbsolute: number;
    expectedDamagePerFight: number;
    fightsBeforeDanger: number;
    verdict: RiskVerdict;
  };
  eliteBudget: {
    actTarget: [min: number, max: number];
    eliteFloorsFought: number[];
    remaining: number;
    shouldSeek: boolean;
  };
  goldMath: {
    current: number;
    removalAffordable: boolean;
    shopVisitsAhead: number;
    projectedShopBudget: number;
  };
  monsterPool: {
    currentPool: "easy" | "hard";
    fightsUntilHardPool: number;
  };
  bossPreview: {
    candidates: string[];
    dangerousMatchups: string[];
    preBossRestFloor: number;
    hpEnteringPreBossRest: number;
    preBossRestRecommendation: "heal" | "smith" | "close_call";
  };
}

export interface RunStateInputs {
  player: { hp: number; max_hp: number; gold: number };
  act: 1 | 2 | 3;
  floor: number;
  ascension: number;
  deck: { cards: { id: string; upgraded?: boolean; name: string }[] };
  relics: { id: string; name: string }[];
  map: {
    boss: { row: number };
    current_position?: { row: number } | null;
    visited: { col: number; row: number; type: string }[];
    future: { col: number; row: number; type: string }[]; // nodes with row > current row
  };
  /** Per-remaining-floor shops; used for gold math projection. */
  shopFloorsAhead?: number[];
  /** Context from run history / character strategy for boss preview. */
  bossPreview?: { candidates: string[]; dangerousMatchups: string[] };
  /** Removal cost injected from settings cache. */
  cardRemovalCost: number | null;
}
```

- [ ] **Step 2: Write failing HP-budget test**

Append to `apps/web/src/evaluation/map/run-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeHpBudget, computeRunState } from "./run-state";
import type { RunStateInputs } from "./run-state";

const baseInputs: RunStateInputs = {
  player: { hp: 62, max_hp: 80, gold: 215 },
  act: 2,
  floor: 23,
  ascension: 10,
  deck: {
    cards: [
      ...Array(10).fill({ id: "strike", name: "Strike", upgraded: false }),
      ...Array(5).fill({ id: "defend", name: "Defend", upgraded: true }),
      ...Array(4).fill({ id: "bash", name: "Bash", upgraded: true }),
    ],
  },
  relics: [],
  map: {
    boss: { row: 33 },
    current_position: { row: 23 },
    visited: [
      { col: 1, row: 19, type: "Elite" },
    ],
    future: [
      { col: 1, row: 24, type: "Monster" },
      { col: 1, row: 25, type: "Elite" },
      { col: 1, row: 26, type: "Rest" },
      { col: 1, row: 27, type: "Treasure" },
      { col: 1, row: 28, type: "Monster" },
      { col: 1, row: 29, type: "Elite" },
      { col: 1, row: 30, type: "Shop" },
      { col: 1, row: 31, type: "Monster" },
      { col: 1, row: 32, type: "Rest" },
    ],
  },
  shopFloorsAhead: [30],
  cardRemovalCost: 75,
};

describe("computeHpBudget", () => {
  it("returns moderate verdict for mid-range buffer", () => {
    const hp = computeHpBudget({ hp: 62, max_hp: 80 }, 10, 19);
    expect(hp.verdict).toBe("moderate");
    expect(hp.expectedDamagePerFight).toBeGreaterThan(0);
    expect(hp.fightsBeforeDanger).toBeGreaterThanOrEqual(2);
  });

  it("returns critical verdict at low HP", () => {
    const hp = computeHpBudget({ hp: 10, max_hp: 80 }, 10, 19);
    expect(hp.verdict).toBe("critical");
  });

  it("returns abundant verdict at high HP with small deck", () => {
    const hp = computeHpBudget({ hp: 75, max_hp: 80 }, 10, 15);
    expect(hp.verdict).toBe("abundant");
  });
});
```

- [ ] **Step 3: Run failing test**

```bash
pnpm --filter web test -- run-state
```

Expected: FAIL — `computeHpBudget` not exported.

- [ ] **Step 4: Implement `computeHpBudget`**

Append to `apps/web/src/evaluation/map/run-state.ts`:

```ts
/**
 * Expected damage per fight is a rough lookup: ascension × deck-size bucket.
 * Tuned against community pool observations; a one-file change to adjust.
 */
function expectedDamage(ascension: number, deckSize: number): number {
  const base = 8 + Math.max(0, ascension) * 0.8;       // Asc 10 ≈ 16
  const deckBloatPenalty = Math.max(0, deckSize - 18) * 0.4;
  return Math.round(base + deckBloatPenalty);
}

export function computeHpBudget(
  player: { hp: number; max_hp: number },
  ascension: number,
  deckSize: number,
): RunState["riskCapacity"] {
  const expectedDamagePerFight = expectedDamage(ascension, deckSize);
  // Danger threshold: HP below expected damage × 1.5 means one bad fight ends the run.
  const dangerFloor = Math.max(1, Math.round(expectedDamagePerFight * 1.5));
  const hpBufferAbsolute = Math.max(0, player.hp - dangerFloor);
  const fightsBeforeDanger = Math.floor(hpBufferAbsolute / Math.max(1, expectedDamagePerFight));

  let verdict: RiskVerdict;
  if (fightsBeforeDanger >= 4) verdict = "abundant";
  else if (fightsBeforeDanger >= 2) verdict = "moderate";
  else if (fightsBeforeDanger >= 1) verdict = "tight";
  else verdict = "critical";

  return { hpBufferAbsolute, expectedDamagePerFight, fightsBeforeDanger, verdict };
}
```

- [ ] **Step 5: Verify HP-budget tests pass**

```bash
pnpm --filter web test -- run-state
```

Expected: 3 HP-budget tests PASS.

- [ ] **Step 6: Write failing elite-budget tests**

Append to `run-state.test.ts`:

```ts
import { computeEliteBudget } from "./run-state";

describe("computeEliteBudget", () => {
  it("Act 2 target (2,3) with 1 elite fought should-seek true", () => {
    const b = computeEliteBudget(2, [{ floor: 19, type: "Elite" }]);
    expect(b.actTarget).toEqual([2, 3]);
    expect(b.eliteFloorsFought).toEqual([19]);
    expect(b.remaining).toBe(2);
    expect(b.shouldSeek).toBe(true);
  });

  it("Act 3 with 1 elite already fought — past target", () => {
    const b = computeEliteBudget(3, [{ floor: 42, type: "Elite" }]);
    expect(b.actTarget).toEqual([0, 1]);
    expect(b.remaining).toBe(0);
    expect(b.shouldSeek).toBe(false);
  });

  it("Act 1 untouched returns target (1,2)", () => {
    const b = computeEliteBudget(1, []);
    expect(b.actTarget).toEqual([1, 2]);
    expect(b.remaining).toBe(2);
  });
});
```

- [ ] **Step 7: Run failing test**

```bash
pnpm --filter web test -- run-state
```

Expected: FAIL — `computeEliteBudget` not exported.

- [ ] **Step 8: Implement `computeEliteBudget`**

Append to `run-state.ts`:

```ts
const ELITE_TARGETS: Record<1 | 2 | 3, [number, number]> = {
  1: [1, 2],
  2: [2, 3],
  3: [0, 1],
};

export function computeEliteBudget(
  act: 1 | 2 | 3,
  visited: { floor: number; type: string }[],
): RunState["eliteBudget"] {
  const target = ELITE_TARGETS[act];
  const eliteFloorsFought = visited.filter((v) => v.type === "Elite").map((v) => v.floor);
  const remaining = Math.max(0, target[1] - eliteFloorsFought.length);
  const shouldSeek = eliteFloorsFought.length < target[0] || (eliteFloorsFought.length < target[1]);
  return { actTarget: target, eliteFloorsFought, remaining, shouldSeek };
}
```

Note: `visited` in `RunStateInputs` uses `{col, row, type}`. The orchestrator maps `row` → `floor`. The elite-budget helper signature takes pre-mapped `{floor, type}` to stay independently testable.

- [ ] **Step 9: Verify elite-budget tests pass**

```bash
pnpm --filter web test -- run-state
```

Expected: all elite tests PASS.

- [ ] **Step 10: Write + run failing gold-math tests, then implement**

Append tests:

```ts
import { computeGoldMath } from "./run-state";

describe("computeGoldMath", () => {
  it("affordable removal and 2 shops ahead projects budget", () => {
    const g = computeGoldMath({ gold: 215 }, 75, [30, 42]);
    expect(g.current).toBe(215);
    expect(g.removalAffordable).toBe(true);
    expect(g.shopVisitsAhead).toBe(2);
    expect(g.projectedShopBudget).toBeGreaterThan(215);
  });

  it("unaffordable removal flagged when gold below removal cost", () => {
    const g = computeGoldMath({ gold: 40 }, 75, []);
    expect(g.removalAffordable).toBe(false);
    expect(g.shopVisitsAhead).toBe(0);
  });

  it("removalAffordable is false when cost is null (unknown)", () => {
    const g = computeGoldMath({ gold: 200 }, null, [30]);
    expect(g.removalAffordable).toBe(false);
  });
});
```

Run: `pnpm --filter web test -- run-state` — expect 3 FAILs.

Append implementation:

```ts
/**
 * Projected budget = current + expected gold drops between now and last shop.
 * Rough estimate: ~35g per fight before hard pool, ~50g after.
 */
export function computeGoldMath(
  player: { gold: number },
  removalCost: number | null,
  shopFloorsAhead: number[],
): RunState["goldMath"] {
  const shopVisitsAhead = shopFloorsAhead.length;
  const expectedDropsPerFight = 40;
  // Assume ~4 fights between current and last shop as a default.
  const projectedShopBudget =
    player.gold + expectedDropsPerFight * Math.min(4, shopVisitsAhead * 3);
  const removalAffordable = removalCost !== null && player.gold >= removalCost;
  return {
    current: player.gold,
    removalAffordable,
    shopVisitsAhead,
    projectedShopBudget,
  };
}
```

Re-run: 3 PASSes.

- [ ] **Step 11: Write + run failing monster-pool tests, then implement**

Append tests:

```ts
import { computeMonsterPool } from "./run-state";

describe("computeMonsterPool", () => {
  it("Act 1 after 2 monster fights is still easy pool, 1 until hard", () => {
    const p = computeMonsterPool(1, [
      { floor: 1, type: "Monster" },
      { floor: 2, type: "Monster" },
    ]);
    expect(p.currentPool).toBe("easy");
    expect(p.fightsUntilHardPool).toBe(1);
  });

  it("Act 1 after 3 monster fights switches to hard", () => {
    const p = computeMonsterPool(1, [
      { floor: 1, type: "Monster" },
      { floor: 2, type: "Monster" },
      { floor: 3, type: "Monster" },
    ]);
    expect(p.currentPool).toBe("hard");
    expect(p.fightsUntilHardPool).toBe(0);
  });

  it("Act 2 switches after 2 monster fights", () => {
    const p = computeMonsterPool(2, [
      { floor: 18, type: "Monster" },
      { floor: 19, type: "Monster" },
    ]);
    expect(p.currentPool).toBe("hard");
  });

  it("Elite fights do not count toward easy-pool quota", () => {
    const p = computeMonsterPool(1, [
      { floor: 1, type: "Monster" },
      { floor: 2, type: "Elite" },
    ]);
    expect(p.currentPool).toBe("easy");
    expect(p.fightsUntilHardPool).toBe(2);
  });
});
```

Run: FAILs.

Append implementation:

```ts
export function computeMonsterPool(
  act: 1 | 2 | 3,
  visited: { floor: number; type: string }[],
): RunState["monsterPool"] {
  const easyPoolSize = act === 1 ? 3 : 2;
  const monsterFightsDone = visited.filter((v) => v.type === "Monster").length;
  if (monsterFightsDone >= easyPoolSize) {
    return { currentPool: "hard", fightsUntilHardPool: 0 };
  }
  return { currentPool: "easy", fightsUntilHardPool: easyPoolSize - monsterFightsDone };
}
```

Re-run: PASSes.

- [ ] **Step 12: Write + run failing pre-boss-rest tests, then implement**

Append tests:

```ts
import { computePreBossRest } from "./run-state";

describe("computePreBossRest", () => {
  it("recommends heal when projected HP is below 65%", () => {
    const r = computePreBossRest({
      floorsRemaining: 10,
      bossRow: 33,
      currentHp: 62,
      maxHp: 80,
      expectedDamagePerFight: 12,
      fightsOnExpectedPath: 4,
      upgradeCandidates: 3,
    });
    expect(r.preBossRestFloor).toBe(32); // bossRow - 1
    expect(r.hpEnteringPreBossRest).toBe(62 - 12 * 4); // 14
    expect(r.preBossRestRecommendation).toBe("heal");
  });

  it("recommends smith when HP is above 70% and candidates exist", () => {
    const r = computePreBossRest({
      floorsRemaining: 10,
      bossRow: 33,
      currentHp: 78,
      maxHp: 80,
      expectedDamagePerFight: 12,
      fightsOnExpectedPath: 0,
      upgradeCandidates: 5,
    });
    expect(r.preBossRestRecommendation).toBe("smith");
  });

  it("recommends close_call in the 65-70% band", () => {
    const r = computePreBossRest({
      floorsRemaining: 10,
      bossRow: 33,
      currentHp: 60,
      maxHp: 90, // 66% — in the close_call band
      expectedDamagePerFight: 8,
      fightsOnExpectedPath: 0,
      upgradeCandidates: 3,
    });
    expect(r.preBossRestRecommendation).toBe("close_call");
  });

  it("recommends heal when no upgrade candidates exist regardless of HP", () => {
    const r = computePreBossRest({
      floorsRemaining: 10,
      bossRow: 33,
      currentHp: 80,
      maxHp: 80,
      expectedDamagePerFight: 8,
      fightsOnExpectedPath: 0,
      upgradeCandidates: 0,
    });
    expect(r.preBossRestRecommendation).toBe("heal");
  });
});
```

Run: FAILs.

Append implementation:

```ts
export function computePreBossRest(args: {
  floorsRemaining: number;
  bossRow: number;
  currentHp: number;
  maxHp: number;
  expectedDamagePerFight: number;
  fightsOnExpectedPath: number;
  upgradeCandidates: number;
}): Pick<
  RunState["bossPreview"],
  "preBossRestFloor" | "hpEnteringPreBossRest" | "preBossRestRecommendation"
> {
  const preBossRestFloor = args.bossRow - 1;
  const hpEnteringPreBossRest = Math.max(
    0,
    args.currentHp - args.expectedDamagePerFight * args.fightsOnExpectedPath,
  );
  const ratio = hpEnteringPreBossRest / Math.max(1, args.maxHp);

  let preBossRestRecommendation: "heal" | "smith" | "close_call";
  if (args.upgradeCandidates === 0 || ratio < 0.65) {
    preBossRestRecommendation = "heal";
  } else if (ratio >= 0.7) {
    preBossRestRecommendation = "smith";
  } else {
    preBossRestRecommendation = "close_call";
  }

  return { preBossRestFloor, hpEnteringPreBossRest, preBossRestRecommendation };
}
```

Re-run: PASSes.

- [ ] **Step 13: Write failing `computeRunState` orchestrator test**

Append to test file:

```ts
describe("computeRunState", () => {
  it("composes all computations with baseInputs", () => {
    const rs = computeRunState(baseInputs);
    expect(rs.act).toBe(2);
    expect(rs.floor).toBe(23);
    expect(rs.floorsRemainingInAct).toBe(10);
    expect(rs.hp.ratio).toBeCloseTo(62 / 80, 2);
    expect(rs.deck.size).toBe(19);
    expect(rs.deck.archetype).toBeNull(); // phase 1
    expect(rs.riskCapacity.verdict).toBe("moderate");
    expect(rs.eliteBudget.actTarget).toEqual([2, 3]);
    expect(rs.monsterPool.currentPool).toMatch(/easy|hard/);
    expect(rs.bossPreview.preBossRestFloor).toBe(32);
  });
});
```

Run: FAIL.

- [ ] **Step 14: Implement `computeRunState`**

Append to `run-state.ts`:

```ts
export function computeRunState(inputs: RunStateInputs): RunState {
  const deckSize = inputs.deck.cards.length;
  const visitedTyped = inputs.map.visited.map((v) => ({ floor: v.row, type: v.type }));

  const hp = {
    current: inputs.player.hp,
    max: inputs.player.max_hp,
    ratio: inputs.player.hp / Math.max(1, inputs.player.max_hp),
  };

  const riskCapacity = computeHpBudget(
    { hp: inputs.player.hp, max_hp: inputs.player.max_hp },
    inputs.ascension,
    deckSize,
  );

  const eliteBudget = computeEliteBudget(inputs.act, visitedTyped);
  const goldMath = computeGoldMath(
    { gold: inputs.player.gold },
    inputs.cardRemovalCost,
    inputs.shopFloorsAhead ?? [],
  );
  const monsterPool = computeMonsterPool(inputs.act, visitedTyped);

  const floorsRemainingInAct = inputs.map.boss.row - inputs.floor;
  const fightsOnExpectedPath = inputs.map.future.filter(
    (n) => n.type === "Monster" || n.type === "Elite",
  ).length;

  const removalCandidates = inputs.deck.cards.filter(
    (c) => c.id === "strike" || c.id === "defend",
  ).length;

  const upgradedCount = inputs.deck.cards.filter((c) => c.upgraded).length;

  const preBossRest = computePreBossRest({
    floorsRemaining: floorsRemainingInAct,
    bossRow: inputs.map.boss.row,
    currentHp: inputs.player.hp,
    maxHp: inputs.player.max_hp,
    expectedDamagePerFight: riskCapacity.expectedDamagePerFight,
    fightsOnExpectedPath,
    upgradeCandidates: inputs.deck.cards.filter((c) => !c.upgraded).length,
  });

  return {
    hp,
    gold: inputs.player.gold,
    act: inputs.act,
    floor: inputs.floor,
    floorsRemainingInAct,
    ascension: inputs.ascension,
    deck: {
      size: deckSize,
      archetype: null,
      avgUpgradeRatio: upgradedCount / Math.max(1, deckSize),
      removalCandidates,
    },
    relics: {
      combatRelevant: inputs.relics.map((r) => r.id),
      pathAffecting: [], // phase 1: not categorized — LLM sees full relic list
    },
    riskCapacity,
    eliteBudget,
    goldMath,
    monsterPool,
    bossPreview: {
      candidates: inputs.bossPreview?.candidates ?? [],
      dangerousMatchups: inputs.bossPreview?.dangerousMatchups ?? [],
      ...preBossRest,
    },
  };
}
```

- [ ] **Step 15: Run full test file**

```bash
pnpm --filter web test -- run-state
```

Expected: all tests PASS.

- [ ] **Step 16: Commit**

```bash
git add apps/web/src/evaluation/map/run-state.ts \
        apps/web/src/evaluation/map/run-state.test.ts
git commit -m "feat(eval): deterministic run-state computation for map coach"
```

---

## Task 3: Path pattern detectors + enrichment

**Files:**
- Create: `apps/web/src/evaluation/map/path-patterns.ts`
- Create: `apps/web/src/evaluation/map/path-patterns.test.ts`
- Create: `apps/web/src/evaluation/map/enrich-paths.ts`
- Create: `apps/web/src/evaluation/map/enrich-paths.test.ts`

- [ ] **Step 1: Write types + first pattern (rest_before_elite) test**

Create `apps/web/src/evaluation/map/path-patterns.ts`:

```ts
/**
 * Pure pattern detectors on a linear candidate path.
 * Each detector returns a single PathPattern or null.
 *
 * Path shape: node types in visit order from the candidate's root to the
 * act boss, each tagged with the floor (row) it occupies.
 */

export type NodeType = "monster" | "elite" | "rest" | "shop" | "treasure" | "event" | "unknown" | "boss";

export interface PathNode {
  floor: number;
  type: NodeType;
}

export type PathPattern =
  | { kind: "rest_before_elite"; restFloor: number; eliteFloor: number }
  | { kind: "rest_after_elite"; eliteFloor: number; restFloor: number }
  | { kind: "elite_cluster"; floors: number[] }
  | { kind: "back_to_back_shops"; floors: number[] }
  | { kind: "treasure_before_rest"; treasureFloor: number; restFloor: number }
  | { kind: "monster_chain_for_rewards"; floors: number[]; length: 3 | 4 }
  | { kind: "no_rest_in_late_half"; elitesLate: number }
  | { kind: "heal_vs_smith_at_preboss"; recommendation: "heal" | "smith" | "close_call" }
  | { kind: "rest_spent_too_early"; restFloor: number; hpRatioAtRest: number };

// Note: `rest_before_elite` covers the "smith coordination" case topologically;
// the spec's earlier `smith_before_elite` pattern was dropped during planning
// because it reduced to the same detection as `rest_before_elite`. The
// heal-vs-smith distinction is carried by the pre-boss `heal_vs_smith_at_preboss`
// pattern, which pulls its recommendation from RunState.
```

Create `apps/web/src/evaluation/map/path-patterns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectRestBeforeElite } from "./path-patterns";
import type { PathNode } from "./path-patterns";

describe("detectRestBeforeElite", () => {
  it("detects a rest immediately followed by an elite", () => {
    const path: PathNode[] = [
      { floor: 24, type: "monster" },
      { floor: 25, type: "rest" },
      { floor: 26, type: "elite" },
    ];
    expect(detectRestBeforeElite(path)).toEqual({
      kind: "rest_before_elite",
      restFloor: 25,
      eliteFloor: 26,
    });
  });

  it("returns null when rest is not directly before elite", () => {
    const path: PathNode[] = [
      { floor: 24, type: "rest" },
      { floor: 25, type: "monster" },
      { floor: 26, type: "elite" },
    ];
    expect(detectRestBeforeElite(path)).toBeNull();
  });

  it("returns null with no elite on path", () => {
    const path: PathNode[] = [
      { floor: 24, type: "rest" },
      { floor: 25, type: "monster" },
    ];
    expect(detectRestBeforeElite(path)).toBeNull();
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter web test -- path-patterns
```

Expected: FAIL — `detectRestBeforeElite` not exported.

- [ ] **Step 3: Implement `detectRestBeforeElite`**

Append to `path-patterns.ts`:

```ts
export function detectRestBeforeElite(path: PathNode[]): PathPattern | null {
  for (let i = 0; i < path.length - 1; i++) {
    if (path[i].type === "rest" && path[i + 1].type === "elite") {
      return { kind: "rest_before_elite", restFloor: path[i].floor, eliteFloor: path[i + 1].floor };
    }
  }
  return null;
}
```

Run: PASS.

- [ ] **Step 4: Write + implement remaining detectors (one commit batch)**

Append the rest of the detectors to `path-patterns.ts`. For each, add the corresponding tests to `path-patterns.test.ts` (one positive, one negative).

```ts
export function detectRestAfterElite(path: PathNode[]): PathPattern | null {
  for (let i = 0; i < path.length - 1; i++) {
    if (path[i].type === "elite" && path[i + 1].type === "rest") {
      return { kind: "rest_after_elite", eliteFloor: path[i].floor, restFloor: path[i + 1].floor };
    }
  }
  return null;
}

export function detectEliteCluster(path: PathNode[]): PathPattern | null {
  const eliteFloors = path.filter((n) => n.type === "elite").map((n) => n.floor);
  if (eliteFloors.length < 2) return null;
  for (let i = 0; i < eliteFloors.length - 1; i++) {
    if (eliteFloors[i + 1] - eliteFloors[i] <= 3) {
      return { kind: "elite_cluster", floors: eliteFloors };
    }
  }
  return null;
}

export function detectBackToBackShops(path: PathNode[]): PathPattern | null {
  const floors: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    if (path[i].type === "shop" && path[i + 1].type === "shop") {
      floors.push(path[i].floor, path[i + 1].floor);
    }
  }
  return floors.length > 0 ? { kind: "back_to_back_shops", floors: [...new Set(floors)] } : null;
}

export function detectTreasureBeforeRest(path: PathNode[]): PathPattern | null {
  for (let i = 0; i < path.length - 1; i++) {
    if (path[i].type === "treasure" && path[i + 1].type === "rest") {
      return {
        kind: "treasure_before_rest",
        treasureFloor: path[i].floor,
        restFloor: path[i + 1].floor,
      };
    }
  }
  return null;
}

export function detectMonsterChain(path: PathNode[]): PathPattern | null {
  let run: number[] = [];
  let best: number[] = [];
  for (const n of path) {
    if (n.type === "monster") {
      run.push(n.floor);
      if (run.length > best.length) best = [...run];
    } else {
      run = [];
    }
  }
  if (best.length >= 3) {
    return {
      kind: "monster_chain_for_rewards",
      floors: best,
      length: (best.length >= 4 ? 4 : 3) as 3 | 4,
    };
  }
  return null;
}

/**
 * Detects elites in the late half (after the act's treasure node) that lack
 * a rest between them and the pre-boss rest. `treasureFloor` must be passed
 * (structural invariant: always present at halfway). If no late elites, null.
 */
export function detectNoRestInLateHalf(
  path: PathNode[],
  treasureFloor: number,
): PathPattern | null {
  const lateHalf = path.filter((n) => n.floor > treasureFloor);
  const lateElites = lateHalf.filter((n) => n.type === "elite");
  if (lateElites.length === 0) return null;
  const hasMidHalfRest = lateHalf.some(
    (n) =>
      n.type === "rest" &&
      n.floor > lateElites[0].floor &&
      n.floor < path[path.length - 1].floor,
  );
  if (hasMidHalfRest) return null;
  return { kind: "no_rest_in_late_half", elitesLate: lateElites.length };
}

/**
 * Smith-then-elite sequence: rest (used for smith) immediately before an elite
 * is a coordination pattern — smith a card that helps the elite fight.
 */
/**
 * Tags the guaranteed pre-boss rest with the heal/smith/close_call call.
 * `preBossRecommendation` is computed in run-state.
 */
export function detectHealVsSmithAtPreboss(
  preBossRecommendation: "heal" | "smith" | "close_call",
): PathPattern {
  return { kind: "heal_vs_smith_at_preboss", recommendation: preBossRecommendation };
}

/**
 * Flags a non-pre-boss rest taken at high HP — the player is "wasting" it
 * on heal when a smith would compound better.
 */
export function detectRestSpentTooEarly(
  path: PathNode[],
  currentHpRatio: number,
  preBossRestFloor: number,
): PathPattern | null {
  const nonPreBossRest = path.find((n) => n.type === "rest" && n.floor !== preBossRestFloor);
  if (!nonPreBossRest) return null;
  if (currentHpRatio < 0.8) return null;
  return {
    kind: "rest_spent_too_early",
    restFloor: nonPreBossRest.floor,
    hpRatioAtRest: currentHpRatio,
  };
}
```

Append tests to `path-patterns.test.ts` (one block per detector). Pattern for tests, repeat for each — show positive, negative, and edge where relevant:

```ts
import {
  detectRestAfterElite, detectEliteCluster, detectBackToBackShops,
  detectTreasureBeforeRest, detectMonsterChain, detectNoRestInLateHalf,
  detectHealVsSmithAtPreboss, detectRestSpentTooEarly,
} from "./path-patterns";

describe("detectRestAfterElite", () => {
  it("detects rest immediately after elite", () => {
    const r = detectRestAfterElite([
      { floor: 25, type: "elite" },
      { floor: 26, type: "rest" },
    ]);
    expect(r).toEqual({ kind: "rest_after_elite", eliteFloor: 25, restFloor: 26 });
  });

  it("returns null without rest after elite", () => {
    expect(
      detectRestAfterElite([
        { floor: 25, type: "elite" },
        { floor: 26, type: "monster" },
      ]),
    ).toBeNull();
  });
});

describe("detectEliteCluster", () => {
  it("flags two elites within 3 floors", () => {
    const r = detectEliteCluster([
      { floor: 25, type: "elite" },
      { floor: 26, type: "rest" },
      { floor: 27, type: "elite" },
    ]);
    expect(r?.kind).toBe("elite_cluster");
  });

  it("null when elites are 4+ floors apart", () => {
    const r = detectEliteCluster([
      { floor: 25, type: "elite" },
      { floor: 30, type: "elite" },
    ]);
    expect(r).toBeNull();
  });
});

describe("detectBackToBackShops", () => {
  it("flags adjacent shops", () => {
    const r = detectBackToBackShops([
      { floor: 30, type: "shop" },
      { floor: 31, type: "shop" },
    ]);
    expect(r?.kind).toBe("back_to_back_shops");
  });

  it("null when shops are separated", () => {
    const r = detectBackToBackShops([
      { floor: 30, type: "shop" },
      { floor: 31, type: "monster" },
      { floor: 32, type: "shop" },
    ]);
    expect(r).toBeNull();
  });
});

describe("detectTreasureBeforeRest", () => {
  it("flags treasure directly before rest", () => {
    const r = detectTreasureBeforeRest([
      { floor: 27, type: "treasure" },
      { floor: 28, type: "rest" },
    ]);
    expect(r?.kind).toBe("treasure_before_rest");
  });

  it("null when treasure is not before rest", () => {
    const r = detectTreasureBeforeRest([{ floor: 27, type: "treasure" }]);
    expect(r).toBeNull();
  });
});

describe("detectMonsterChain", () => {
  it("flags 3 monsters in a row", () => {
    const r = detectMonsterChain([
      { floor: 1, type: "monster" },
      { floor: 2, type: "monster" },
      { floor: 3, type: "monster" },
    ]);
    expect(r?.kind).toBe("monster_chain_for_rewards");
    expect(r?.length).toBe(3);
  });

  it("null for 2 in a row", () => {
    const r = detectMonsterChain([
      { floor: 1, type: "monster" },
      { floor: 2, type: "monster" },
    ]);
    expect(r).toBeNull();
  });
});

describe("detectNoRestInLateHalf", () => {
  it("flags late elite without mid-late rest", () => {
    const r = detectNoRestInLateHalf(
      [
        { floor: 27, type: "treasure" },
        { floor: 28, type: "elite" },
        { floor: 29, type: "monster" },
      ],
      27,
    );
    expect(r?.kind).toBe("no_rest_in_late_half");
  });

  it("null when late elite has mid-late rest before pre-boss", () => {
    const r = detectNoRestInLateHalf(
      [
        { floor: 27, type: "treasure" },
        { floor: 28, type: "elite" },
        { floor: 29, type: "rest" },
        { floor: 30, type: "monster" },
      ],
      27,
    );
    expect(r).toBeNull();
  });
});

describe("detectHealVsSmithAtPreboss", () => {
  it("tags with smith recommendation", () => {
    expect(detectHealVsSmithAtPreboss("smith")).toEqual({
      kind: "heal_vs_smith_at_preboss",
      recommendation: "smith",
    });
  });
});

describe("detectRestSpentTooEarly", () => {
  it("flags non-pre-boss rest at high HP", () => {
    const r = detectRestSpentTooEarly(
      [
        { floor: 25, type: "rest" },
        { floor: 26, type: "monster" },
      ],
      0.95,
      32,
    );
    expect(r?.kind).toBe("rest_spent_too_early");
  });

  it("null when HP is low enough to justify heal", () => {
    const r = detectRestSpentTooEarly(
      [{ floor: 25, type: "rest" }],
      0.5,
      32,
    );
    expect(r).toBeNull();
  });
});
```

Run: `pnpm --filter web test -- path-patterns` — expect all PASS.

- [ ] **Step 5: Write `enrich-paths.ts` failing test**

Create `apps/web/src/evaluation/map/enrich-paths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { enrichPaths } from "./enrich-paths";
import type { RunState } from "./run-state";

const runState: RunState = {
  hp: { current: 62, max: 80, ratio: 0.775 },
  gold: 215,
  act: 2,
  floor: 23,
  floorsRemainingInAct: 10,
  ascension: 10,
  deck: { size: 19, archetype: null, avgUpgradeRatio: 0.31, removalCandidates: 3 },
  relics: { combatRelevant: [], pathAffecting: [] },
  riskCapacity: {
    hpBufferAbsolute: 44,
    expectedDamagePerFight: 12,
    fightsBeforeDanger: 3,
    verdict: "moderate",
  },
  eliteBudget: { actTarget: [2, 3], eliteFloorsFought: [19], remaining: 2, shouldSeek: true },
  goldMath: { current: 215, removalAffordable: true, shopVisitsAhead: 2, projectedShopBudget: 320 },
  monsterPool: { currentPool: "hard", fightsUntilHardPool: 0 },
  bossPreview: {
    candidates: [],
    dangerousMatchups: [],
    preBossRestFloor: 32,
    hpEnteringPreBossRest: 38,
    preBossRestRecommendation: "heal",
  },
};

describe("enrichPaths", () => {
  it("annotates a path with expected patterns and aggregates", () => {
    const paths = [
      {
        id: "A",
        nodes: [
          { floor: 24, type: "monster" as const },
          { floor: 25, type: "elite" as const },
          { floor: 26, type: "rest" as const },
          { floor: 27, type: "treasure" as const },
          { floor: 28, type: "monster" as const },
          { floor: 29, type: "elite" as const },
          { floor: 30, type: "shop" as const },
          { floor: 31, type: "monster" as const },
          { floor: 32, type: "rest" as const },
          { floor: 33, type: "boss" as const },
        ],
      },
    ];

    const enriched = enrichPaths(paths, runState, /* treasureFloorByPath */ { A: 27 });
    expect(enriched).toHaveLength(1);
    const p = enriched[0];
    expect(p.patterns.some((x) => x.kind === "rest_after_elite")).toBe(true);
    expect(p.patterns.some((x) => x.kind === "elite_cluster")).toBe(true);
    expect(p.patterns.some((x) => x.kind === "treasure_before_rest")).toBe(false); // treasure→monster
    expect(p.aggregates.elitesTaken).toBe(2);
    expect(p.aggregates.restsTaken).toBe(2);
    expect(p.aggregates.shopsTaken).toBe(1);
    expect(p.aggregates.projectedHpEnteringPreBossRest).toBeLessThan(runState.hp.current);
  });
});
```

Run: FAIL (module missing).

- [ ] **Step 6: Implement `enrich-paths.ts`**

Create `apps/web/src/evaluation/map/enrich-paths.ts`:

```ts
import type { RunState } from "./run-state";
import type { PathNode, PathPattern } from "./path-patterns";
import {
  detectRestBeforeElite,
  detectRestAfterElite,
  detectEliteCluster,
  detectBackToBackShops,
  detectTreasureBeforeRest,
  detectMonsterChain,
  detectNoRestInLateHalf,
  detectHealVsSmithAtPreboss,
  detectRestSpentTooEarly,
} from "./path-patterns";
// (smith_before_elite was dropped — duplicate topology of rest_before_elite.)

export interface CandidatePath {
  id: string; // e.g., option index or "A", "B"
  nodes: PathNode[];
}

export interface EnrichedPath extends CandidatePath {
  patterns: PathPattern[];
  aggregates: {
    elitesTaken: number;
    restsTaken: number;
    shopsTaken: number;
    hardPoolFightsOnPath: number;
    projectedHpEnteringPreBossRest: number;
  };
}

export function enrichPaths(
  paths: CandidatePath[],
  runState: RunState,
  treasureFloorByPath: Record<string, number>,
): EnrichedPath[] {
  return paths.map((p) => {
    const patterns: PathPattern[] = [];
    const tf = treasureFloorByPath[p.id];

    const detectors = [
      detectRestBeforeElite(p.nodes),
      detectRestAfterElite(p.nodes),
      detectEliteCluster(p.nodes),
      detectBackToBackShops(p.nodes),
      detectTreasureBeforeRest(p.nodes),
      detectMonsterChain(p.nodes),
      tf !== undefined ? detectNoRestInLateHalf(p.nodes, tf) : null,
      detectRestSpentTooEarly(p.nodes, runState.hp.ratio, runState.bossPreview.preBossRestFloor),
    ];
    for (const d of detectors) if (d) patterns.push(d);
    patterns.push(detectHealVsSmithAtPreboss(runState.bossPreview.preBossRestRecommendation));

    const elitesTaken = p.nodes.filter((n) => n.type === "elite").length;
    const restsTaken = p.nodes.filter((n) => n.type === "rest").length;
    const shopsTaken = p.nodes.filter((n) => n.type === "shop").length;
    const monstersOnPath = p.nodes.filter((n) => n.type === "monster").length;
    // Hard-pool fights = monsters on path beyond the remaining easy-pool slots.
    // Order within the path isn't modeled here; good enough for a prompt signal.
    const hardPoolFightsOnPath = Math.max(
      0,
      monstersOnPath - runState.monsterPool.fightsUntilHardPool,
    );
    const fightsOnPath = elitesTaken + monstersOnPath;
    const projectedHpEnteringPreBossRest = Math.max(
      0,
      runState.hp.current - runState.riskCapacity.expectedDamagePerFight * fightsOnPath,
    );

    return {
      ...p,
      patterns,
      aggregates: {
        elitesTaken,
        restsTaken,
        shopsTaken,
        hardPoolFightsOnPath,
        projectedHpEnteringPreBossRest,
      },
    };
  });
}
```

Run: `pnpm --filter web test -- enrich-paths` — expect PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/evaluation/map/path-patterns.ts \
        apps/web/src/evaluation/map/path-patterns.test.ts \
        apps/web/src/evaluation/map/enrich-paths.ts \
        apps/web/src/evaluation/map/enrich-paths.test.ts
git commit -m "feat(eval): path pattern detectors + enrichment orchestrator"
```

---

## Task 4: Facts block formatter + prompt restructure

**Files:**
- Create: `apps/web/src/evaluation/map/format-facts-block.ts`
- Create: `apps/web/src/evaluation/map/format-facts-block.test.ts`
- Modify: `packages/shared/evaluation/prompt-builder.ts` (add scaffold, trim map addendum)
- Modify: `apps/desktop/src/lib/eval-inputs/map.ts` (rewrite `buildMapPrompt`)

- [ ] **Step 1: Write failing facts-block test**

Create `apps/web/src/evaluation/map/format-facts-block.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatFactsBlock } from "./format-facts-block";
import type { RunState } from "./run-state";
import type { EnrichedPath } from "./enrich-paths";

const runState: RunState = {
  hp: { current: 62, max: 80, ratio: 0.775 },
  gold: 215,
  act: 2,
  floor: 23,
  floorsRemainingInAct: 10,
  ascension: 10,
  deck: { size: 19, archetype: null, avgUpgradeRatio: 0.31, removalCandidates: 3 },
  relics: { combatRelevant: [], pathAffecting: [] },
  riskCapacity: {
    hpBufferAbsolute: 44,
    expectedDamagePerFight: 12,
    fightsBeforeDanger: 3,
    verdict: "moderate",
  },
  eliteBudget: { actTarget: [2, 3], eliteFloorsFought: [19], remaining: 2, shouldSeek: true },
  goldMath: { current: 215, removalAffordable: true, shopVisitsAhead: 2, projectedShopBudget: 320 },
  monsterPool: { currentPool: "hard", fightsUntilHardPool: 0 },
  bossPreview: {
    candidates: [],
    dangerousMatchups: [],
    preBossRestFloor: 32,
    hpEnteringPreBossRest: 38,
    preBossRestRecommendation: "heal",
  },
};

const paths: EnrichedPath[] = [
  {
    id: "1",
    nodes: [
      { floor: 24, type: "monster" },
      { floor: 25, type: "elite" },
      { floor: 26, type: "rest" },
    ],
    patterns: [
      { kind: "rest_after_elite", eliteFloor: 25, restFloor: 26 },
      { kind: "heal_vs_smith_at_preboss", recommendation: "heal" },
    ],
    aggregates: {
      elitesTaken: 1,
      restsTaken: 1,
      shopsTaken: 0,
      hardPoolFightsOnPath: 1,
      projectedHpEnteringPreBossRest: 38,
    },
  },
];

describe("formatFactsBlock", () => {
  it("renders run state + candidate paths", () => {
    const out = formatFactsBlock(runState, paths);
    expect(out).toContain("=== RUN STATE ===");
    expect(out).toContain("HP: 62/80");
    expect(out).toContain("Risk capacity: MODERATE");
    expect(out).toContain("Elite budget: Act 2 target 2–3");
    expect(out).toContain("Monster pool: HARD");
    expect(out).toContain("=== CANDIDATE PATHS ===");
    expect(out).toContain("Path 1:");
    expect(out).toContain("Patterns: rest_after_elite");
    expect(out).toContain("Aggregate: 1 elites");
  });
});
```

Run: FAIL.

- [ ] **Step 2: Implement `formatFactsBlock`**

Create `apps/web/src/evaluation/map/format-facts-block.ts`:

```ts
import type { RunState } from "./run-state";
import type { EnrichedPath } from "./enrich-paths";

function pathNodeToken(type: string, floor: number): string {
  const short: Record<string, string> = {
    monster: "M",
    elite: "E",
    rest: "R",
    shop: "S",
    treasure: "T",
    event: "?",
    boss: "BOSS",
    unknown: "U",
  };
  return type === "boss" ? "BOSS" : `${short[type] ?? "?"}(f${floor})`;
}

function describePatterns(path: EnrichedPath): string {
  if (path.patterns.length === 0) return "(no patterns)";
  return path.patterns
    .map((p) => {
      switch (p.kind) {
        case "rest_before_elite":
          return `rest_before_elite(f${p.restFloor}→f${p.eliteFloor})`;
        case "rest_after_elite":
          return `rest_after_elite(f${p.eliteFloor}→f${p.restFloor})`;
        case "elite_cluster":
          return `elite_cluster(${p.floors.join(",")})`;
        case "back_to_back_shops":
          return `back_to_back_shops(${p.floors.join(",")})`;
        case "treasure_before_rest":
          return `treasure_before_rest(f${p.treasureFloor}→f${p.restFloor})`;
        case "monster_chain_for_rewards":
          return `monster_chain(${p.floors.join(",")},len=${p.length})`;
        case "no_rest_in_late_half":
          return `no_rest_in_late_half(elitesLate=${p.elitesLate})`;
        case "heal_vs_smith_at_preboss":
          return `heal_vs_smith_at_preboss=${p.recommendation}`;
        case "rest_spent_too_early":
          return `rest_spent_too_early(f${p.restFloor},hpRatio=${p.hpRatioAtRest.toFixed(2)})`;
      }
    })
    .join(", ");
}

export function formatFactsBlock(runState: RunState, paths: EnrichedPath[]): string {
  const [eliteMin, eliteMax] = runState.eliteBudget.actTarget;
  const hpRatio = Math.round(runState.hp.ratio * 100);
  const lines: string[] = [
    "=== RUN STATE ===",
    `HP: ${runState.hp.current}/${runState.hp.max} (${hpRatio}%)`,
    `Gold: ${runState.gold}`,
    `Act ${runState.act}, Floor ${runState.floor} — ${runState.floorsRemainingInAct} floors to act boss (pre-boss rest at floor ${runState.bossPreview.preBossRestFloor})`,
    `Ascension: ${runState.ascension}`,
    `Deck: ${runState.deck.size} cards, ${Math.round(runState.deck.avgUpgradeRatio * runState.deck.size)} upgraded, ${runState.deck.removalCandidates} removal candidates`,
    "",
    `Risk capacity: ${runState.riskCapacity.verdict.toUpperCase()}`,
    `  HP buffer ${runState.riskCapacity.hpBufferAbsolute} | expected damage/fight ≈ ${runState.riskCapacity.expectedDamagePerFight} | ~${runState.riskCapacity.fightsBeforeDanger} fights of slack`,
    `Elite budget: Act ${runState.act} target ${eliteMin}–${eliteMax} | fought ${runState.eliteBudget.eliteFloorsFought.length}${runState.eliteBudget.eliteFloorsFought.length ? ` (${runState.eliteBudget.eliteFloorsFought.map((f) => `f${f}`).join(",")})` : ""} | remaining ${runState.eliteBudget.remaining} | should-seek: ${runState.eliteBudget.shouldSeek}`,
    `Gold math: removal affordable (${runState.goldMath.removalAffordable ? "yes" : "no"}) | ${runState.goldMath.shopVisitsAhead} shops ahead | projected budget ${runState.goldMath.projectedShopBudget}`,
    `Monster pool: ${runState.monsterPool.currentPool.toUpperCase()}${runState.monsterPool.fightsUntilHardPool ? ` (${runState.monsterPool.fightsUntilHardPool} fights until hard pool)` : ""}`,
    `Pre-boss rest (f${runState.bossPreview.preBossRestFloor}): projected HP entering ≈ ${runState.bossPreview.hpEnteringPreBossRest} | recommendation: ${runState.bossPreview.preBossRestRecommendation.toUpperCase()}`,
  ];

  if (runState.bossPreview.candidates.length > 0) {
    lines.push(
      `Boss preview: candidates ${runState.bossPreview.candidates.join(", ")}${
        runState.bossPreview.dangerousMatchups.length
          ? ` | dangerous matchups: ${runState.bossPreview.dangerousMatchups.join(", ")}`
          : ""
      }`,
    );
  }

  lines.push("", "=== CANDIDATE PATHS ===");
  paths.forEach((p, i) => {
    const sequence = p.nodes.map((n) => pathNodeToken(n.type, n.floor)).join(" → ");
    lines.push(`Path ${i + 1}: ${sequence}`);
    lines.push(`  Patterns: ${describePatterns(p)}`);
    lines.push(
      `  Aggregate: ${p.aggregates.elitesTaken} elites | ${p.aggregates.restsTaken} rests | ${p.aggregates.shopsTaken} shops | HP_proj_pre_boss_rest ≈ ${p.aggregates.projectedHpEnteringPreBossRest}`,
    );
  });

  return lines.join("\n");
}
```

Run: PASS.

- [ ] **Step 3: Add reasoning scaffold to `prompt-builder.ts`**

In `packages/shared/evaluation/prompt-builder.ts`, add a new exported constant (near the existing `TYPE_ADDENDA`):

```ts
export const MAP_PATHING_SCAFFOLD = `
Before ranking the candidate paths, reason step-by-step:

1. RISK CAPACITY: restate the buffer number and verdict from RUN STATE in your
   own words. Is this a run that can push for elites, or needs to consolidate?
2. ACT GOAL: one sentence. What should remaining floors accomplish?
   (e.g., "heal to 70%+ before pre-boss rest; take 1 more elite only if HP
   recovery aligns")
3. KEY BRANCHES: identify 1–3 floors where the decision is non-obvious.
   A close call is NOT a failure — say so explicitly and set close_call=true.

Then produce the output. Do not restate game rules; the RUN STATE block already
computed them. Your job is judgment under the specific run state, not general
theory.

Branch recommendations may be conditional, e.g.:
  "Elite IF HP ≥ 55 at f28, else Monster"

teaching_callouts should pick 1–4 patterns from the CANDIDATE PATHS facts that
the player would benefit from understanding — not every pattern, just the
pedagogically useful ones for this path.
`.trim();
```

- [ ] **Step 4: Trim `TYPE_ADDENDA["map"]` in prompt-builder**

In the existing `TYPE_ADDENDA` map section of `packages/shared/evaluation/prompt-builder.ts`, REMOVE the rule text now covered by the facts block:

- Elite-by-act-target numbers (e.g., "Act 1: 1–2 elites", "Act 2: 2–3 elites", "Act 3: 0–1").
- Rest-site HP threshold rules (e.g., "Heal if HP <60% and elite within 2 nodes…").
- Back-to-back shops warning.

RETAIN goal-shaping language:
- Treasure priority.
- Act 1 card acquisition priority, Act 2 peak window, Act 3 boss-prep priority.
- General "seek upgrades before more fights" philosophy.

Locate the current map addendum block (begins with `map: \`` in `TYPE_ADDENDA`) and replace the rule-heavy lines. Leave the resulting block 40–60% shorter. The `prompt-builder.test.ts` file will need snapshot updates if it snapshots this addendum — run it after editing to see what changes:

```bash
pnpm --filter @sts2/shared test -- prompt-builder
```

Update any snapshots with:

```bash
pnpm --filter @sts2/shared test -- prompt-builder -u
```

Only update snapshots you confirm match intended trimmed content.

- [ ] **Step 5: Replace `buildMapPrompt` in `apps/desktop/src/lib/eval-inputs/map.ts`**

Replace the body of `buildMapPrompt` to call the new facts block. The function signature stays the same for now; a shallow adapter converts desktop map state into `RunStateInputs` + `CandidatePath[]` before delegating.

Full replacement of the `buildMapPrompt` function (keeping the types and `computeMapEvalKey` export above it):

```ts
import type { MapState, MapNode } from "@sts2/shared/types/game-state";
import type { EvaluationContext } from "@sts2/shared/evaluation/types";
import {
  buildCompactContext,
  MAP_PATHING_SCAFFOLD,
} from "@sts2/shared/evaluation/prompt-builder";
import { computeRunState, type RunStateInputs } from "../../../web/src/evaluation/map/run-state";
// NOTE: the import path above crosses workspace boundaries. If the build rejects
// it, move run-state.ts / enrich-paths.ts / path-patterns.ts / format-facts-block.ts
// into packages/shared/evaluation/map/ and import from there. This is the
// preferred final location regardless — noted as a refactor at Step 7 below.

import { enrichPaths, type CandidatePath } from "../../../web/src/evaluation/map/enrich-paths";
import { formatFactsBlock } from "../../../web/src/evaluation/map/format-facts-block";

function mapNodeTypeToToken(type: string): CandidatePath["nodes"][number]["type"] {
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

function walkPathNodes(start: MapNode, all: MapNode[], maxDepth = 20): CandidatePath["nodes"] {
  const byKey = new Map(all.map((n) => [`${n.col},${n.row}`, n]));
  const out: CandidatePath["nodes"] = [];
  let cur: MapNode | undefined = start;
  for (let d = 0; d < maxDepth && cur; d++) {
    out.push({ floor: cur.row, type: mapNodeTypeToToken(cur.type) });
    if (cur.children.length === 0) break;
    cur = byKey.get(`${cur.children[0][0]},${cur.children[0][1]}`);
  }
  return out;
}

export function buildMapPrompt(params: {
  context: EvaluationContext;
  state: MapState;
  cardRemovalCost: number | null;
}): string {
  const { context, state, cardRemovalCost } = params;
  const contextStr = buildCompactContext(context);
  const options = state.map.next_options;
  const allNodes = state.map.nodes;
  const currentRow = state.map.current_position?.row ?? 0;
  const mapPlayer = state.player ?? state.map?.player;

  const futureNodes = allNodes.filter((n) => n.row > currentRow);

  // Build RunStateInputs
  const runStateInputs: RunStateInputs = {
    player: {
      hp: mapPlayer?.hp ?? 0,
      max_hp: mapPlayer?.max_hp ?? 0,
      gold: mapPlayer?.gold ?? 0,
    },
    act: (context.act ?? 1) as 1 | 2 | 3,
    floor: currentRow,
    ascension: context.ascension ?? 0,
    deck: {
      cards: (context.deck?.cards ?? []).map((c) => ({
        id: c.id ?? c.name ?? "unknown",
        name: c.name ?? c.id ?? "Unknown",
        upgraded: c.upgraded === true,
      })),
    },
    relics: (context.relics ?? []).map((r) => ({ id: r.id, name: r.name })),
    map: {
      boss: { row: state.map.boss.row },
      current_position: state.map.current_position ?? null,
      visited: state.map.visited.map((v) => ({
        col: v.col,
        row: v.row,
        type: allNodes.find((n) => n.col === v.col && n.row === v.row)?.type ?? "Unknown",
      })),
      future: futureNodes.map((n) => ({ col: n.col, row: n.row, type: n.type })),
    },
    shopFloorsAhead: futureNodes.filter((n) => n.type === "Shop").map((n) => n.row),
    cardRemovalCost,
  };

  const runState = computeRunState(runStateInputs);

  // Build candidate paths — one per next_option, walking the primary-child branch
  const byKey = new Map(allNodes.map((n) => [`${n.col},${n.row}`, n]));
  const candidates: CandidatePath[] = options.map((opt, i) => {
    const start = byKey.get(`${opt.col},${opt.row}`);
    return {
      id: String(i + 1),
      nodes: start ? walkPathNodes(start, allNodes) : [],
    };
  });

  // Treasure floor per path (first treasure node on the walk)
  const treasureFloorByPath: Record<string, number> = {};
  for (const p of candidates) {
    const t = p.nodes.find((n) => n.type === "treasure");
    if (t) treasureFloorByPath[p.id] = t.floor;
  }

  const enriched = enrichPaths(candidates, runState, treasureFloorByPath);
  const factsBlock = formatFactsBlock(runState, enriched);

  return `${contextStr}

${factsBlock}

${MAP_PATHING_SCAFFOLD}`;
}
```

- [ ] **Step 6: Move map-coach modules into shared package (refactor)**

The cross-workspace import in Step 5 is a stopgap. Move the four new map-coach modules from `apps/web/src/evaluation/map/` to `packages/shared/evaluation/map/`:

```bash
mkdir -p packages/shared/evaluation/map
git mv apps/web/src/evaluation/map/run-state.ts packages/shared/evaluation/map/run-state.ts
git mv apps/web/src/evaluation/map/run-state.test.ts packages/shared/evaluation/map/run-state.test.ts
git mv apps/web/src/evaluation/map/path-patterns.ts packages/shared/evaluation/map/path-patterns.ts
git mv apps/web/src/evaluation/map/path-patterns.test.ts packages/shared/evaluation/map/path-patterns.test.ts
git mv apps/web/src/evaluation/map/enrich-paths.ts packages/shared/evaluation/map/enrich-paths.ts
git mv apps/web/src/evaluation/map/enrich-paths.test.ts packages/shared/evaluation/map/enrich-paths.test.ts
git mv apps/web/src/evaluation/map/format-facts-block.ts packages/shared/evaluation/map/format-facts-block.ts
git mv apps/web/src/evaluation/map/format-facts-block.test.ts packages/shared/evaluation/map/format-facts-block.test.ts
```

Update imports in `apps/desktop/src/lib/eval-inputs/map.ts` and (in a later task) `apps/web/src/app/api/evaluate/route.ts` to use `@sts2/shared/evaluation/map/...`.

- [ ] **Step 7: Verify desktop and shared tests pass**

```bash
pnpm --filter @sts2/shared test
pnpm --filter desktop typecheck
```

Expected: PASS. If typecheck fails due to circular `@sts2/shared` imports, adjust import paths.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(eval): facts block + scaffold + new buildMapPrompt for map coach"
```

---

## Task 5: DB migration — run_state_snapshot column

**Files:**
- Create: `supabase/migrations/026_choices_run_state_snapshot.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/026_choices_run_state_snapshot.sql`:

```sql
-- Adds structured run-state snapshot for map coach evals.
-- Phase 1 is backward-compatible: column is NULL for legacy rows. No index
-- in phase 1; queries will be added in phase 2 (calibration loop) where
-- an appropriate GIN index can be defined against real query patterns.

ALTER TABLE choices
  ADD COLUMN run_state_snapshot jsonb NULL;

COMMENT ON COLUMN choices.run_state_snapshot IS
  'RunState object computed by the map coach at eval time. Used by phase-2 calibration to analyze in which contexts recommendations were followed/diverged.';
```

- [ ] **Step 2: Apply migration locally**

```bash
pnpm supabase db push
```

Expected: migration runs cleanly, new column exists.

Verify:

```bash
pnpm supabase db query "SELECT column_name FROM information_schema.columns WHERE table_name='choices' AND column_name='run_state_snapshot';"
```

Expected output includes `run_state_snapshot`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/026_choices_run_state_snapshot.sql
git commit -m "chore(db): add choices.run_state_snapshot for map coach phase 1"
```

---

## Task 6: Wire new schema + enrichment into /api/evaluate (map branch)

**Files:**
- Modify: `apps/web/src/app/api/evaluate/route.ts`

Context: the map branch currently builds a prompt via `buildMapPrompt` (now rewritten in Task 4), and validates with `buildMapEvalSchema(optionCount)`. Switch to `mapCoachOutputSchema` and extend the `choices` write to include `run_state_snapshot`.

- [ ] **Step 1: Update route handler to use new schema**

In `apps/web/src/app/api/evaluate/route.ts`, locate the map-branch schema selection (search for `buildMapEvalSchema`). Replace the schema selection for `type === "map"` with:

```ts
import { mapCoachOutputSchema } from "@sts2/shared/evaluation/map-coach-schema";
import { computeRunState } from "@sts2/shared/evaluation/map/run-state";
// Note: the prompt-building path already computes RunState inside buildMapPrompt
// (in lib/eval-inputs/map.ts, desktop-side). On the server we need RunState too
// for the choices write. Re-compute it here from the same inputs or refactor to
// pass it alongside the prompt. See Step 2 for the approach taken.
```

Wherever the existing schema `buildMapEvalSchema(optionCount)` is used for `type === "map"`, substitute `mapCoachOutputSchema`:

```ts
// BEFORE:
// const schema = buildMapEvalSchema(optionCount);
// AFTER:
const schema = mapCoachOutputSchema;
```

Remove any `sanitizeRankings` calls on the map branch — the new schema has no `rankings` array.

- [ ] **Step 2: Compute RunState server-side for persistence**

In the map branch, after the LLM response but before the `choices` write, compute `RunState` from the same inputs the prompt used:

```ts
// Inside the map-branch handler, near where the response is prepared:
import type { RunStateInputs } from "@sts2/shared/evaluation/map/run-state";

// Build RunStateInputs from the request body (mirrors desktop builder).
const runStateInputs: RunStateInputs = {
  player: {
    hp: body.state.player?.hp ?? 0,
    max_hp: body.state.player?.max_hp ?? 0,
    gold: body.state.player?.gold ?? 0,
  },
  act: (body.context?.act ?? 1) as 1 | 2 | 3,
  floor: body.state.map.current_position?.row ?? 0,
  ascension: body.context?.ascension ?? 0,
  deck: {
    cards: (body.context?.deck?.cards ?? []).map((c: { id?: string; name?: string; upgraded?: boolean }) => ({
      id: c.id ?? c.name ?? "unknown",
      name: c.name ?? c.id ?? "Unknown",
      upgraded: c.upgraded === true,
    })),
  },
  relics: (body.context?.relics ?? []).map((r: { id: string; name: string }) => ({ id: r.id, name: r.name })),
  map: {
    boss: { row: body.state.map.boss.row },
    current_position: body.state.map.current_position ?? null,
    visited: body.state.map.visited.map((v: { col: number; row: number }) => ({
      col: v.col,
      row: v.row,
      type:
        body.state.map.nodes.find(
          (n: { col: number; row: number; type: string }) => n.col === v.col && n.row === v.row,
        )?.type ?? "Unknown",
    })),
    future: body.state.map.nodes
      .filter((n: { row: number }) => n.row > (body.state.map.current_position?.row ?? 0))
      .map((n: { col: number; row: number; type: string }) => ({ col: n.col, row: n.row, type: n.type })),
  },
  shopFloorsAhead: body.state.map.nodes
    .filter((n: { row: number; type: string }) => n.row > (body.state.map.current_position?.row ?? 0) && n.type === "Shop")
    .map((n: { row: number }) => n.row),
  cardRemovalCost: body.cardRemovalCost ?? null,
};

const runState = computeRunState(runStateInputs);
```

Refactoring opportunity: this duplication between desktop and server is ugly. Extract the `RunStateInputs` builder into `packages/shared/evaluation/map/build-run-state-inputs.ts` as a pure function taking an already-normalized context. Task 6 ships it duplicated; callout in the final commit message.

- [ ] **Step 3: Extend `choices` write with run_state_snapshot**

Locate the existing `choices` insert/upsert for `type === "map"`. Add `run_state_snapshot: runState` to the payload, and replace whatever was serialized to `rankings_snapshot` with the full parsed LLM output:

```ts
// mapCoachOutputSchema already validated the response:
const parsedOutput = mapCoachOutputSchema.parse(rawLlmResponse);

await supabase.from("choices").upsert({
  // ...existing fields...
  rankings_snapshot: parsedOutput,
  run_state_snapshot: runState,
}, { onConflict: "run_id,floor,choice_type,sequence" });
```

- [ ] **Step 4: Update route test**

Update `apps/web/src/app/api/evaluate/route.test.ts` for the map branch:
- Replace any fixtures using the old `{ rankings, overall_advice, node_preferences }` shape with the new `mapCoachOutputSchema` shape.
- Add one new test case asserting that a valid map coach response is accepted and that `run_state_snapshot` is included in the choices insert (mock Supabase client to capture the call).

Example test addition:

```ts
it("persists run_state_snapshot alongside mapCoachOutput", async () => {
  const fixture = /* valid mapCoachOutput shape */ ;
  // ... mock AI SDK to return fixture
  const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
  // ... mock supabase client with upsertSpy
  await POST(mockRequest({ type: "map", /* minimal valid body */ }));
  expect(upsertSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      rankings_snapshot: expect.objectContaining({ macro_path: expect.any(Object) }),
      run_state_snapshot: expect.objectContaining({ riskCapacity: expect.any(Object) }),
    }),
    expect.any(Object),
  );
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter web test -- evaluate/route
```

Expected: PASS, including the new assertion.

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS across the monorepo.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/api/evaluate/route.ts \
        apps/web/src/app/api/evaluate/route.test.ts
git commit -m "feat(eval): map branch uses mapCoachOutputSchema + run_state_snapshot

Duplication of RunStateInputs builder between desktop and server is an
acknowledged smell; extract into shared module in a follow-up."
```

---

## Task 7: BranchCard component

**Files:**
- Create: `apps/desktop/src/components/branch-card.tsx`
- Create: `apps/desktop/src/components/branch-card.test.tsx`

- [ ] **Step 1: Write failing component test**

Create `apps/desktop/src/components/branch-card.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BranchCard } from "./branch-card";

describe("BranchCard", () => {
  const branch = {
    floor: 25,
    decision: "Elite or Monster?",
    recommended: "Elite",
    alternatives: [
      { option: "Monster", tradeoff: "Safer, lose relic." },
      { option: "Elite", tradeoff: "Take relic, next rest absorbs cost." },
    ],
    closeCall: false,
  };

  it("renders decision and recommended option", () => {
    render(<BranchCard branch={branch} />);
    expect(screen.getByText(/Floor 25/)).toBeInTheDocument();
    expect(screen.getByText(/Elite or Monster/)).toBeInTheDocument();
    expect(screen.getByText(/Recommend: Elite/)).toBeInTheDocument();
  });

  it("renders all alternatives with tradeoffs", () => {
    render(<BranchCard branch={branch} />);
    expect(screen.getByText(/Safer, lose relic/)).toBeInTheDocument();
    expect(screen.getByText(/next rest absorbs cost/)).toBeInTheDocument();
  });

  it("applies close-call styling when closeCall is true", () => {
    const { container } = render(<BranchCard branch={{ ...branch, closeCall: true }} />);
    expect(container.firstChild).toHaveClass("border-amber-500/40");
    expect(container.firstChild).toHaveClass("border-dashed");
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter desktop test -- branch-card
```

Expected: FAIL — component missing.

- [ ] **Step 3: Implement component**

Create `apps/desktop/src/components/branch-card.tsx`:

```tsx
import { cn } from "@sts2/shared/lib/cn";
import type { MapCoachEvaluation } from "../lib/eval-inputs/map";

interface BranchCardProps {
  branch: MapCoachEvaluation["keyBranches"][number];
}

export function BranchCard({ branch }: BranchCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-zinc-900/60 p-2.5 text-xs leading-relaxed",
        branch.closeCall
          ? "border-amber-500/40 border-dashed"
          : "border-zinc-800",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Floor {branch.floor}
        </span>
        {branch.closeCall && (
          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400">
            Close call
          </span>
        )}
      </div>
      <p className="mt-1 font-medium text-zinc-200">{branch.decision}</p>
      <p className="mt-1 text-emerald-300">Recommend: {branch.recommended}</p>
      <ul className="mt-1.5 space-y-0.5">
        {branch.alternatives.map((alt, i) => (
          <li key={i} className="text-zinc-500">
            <span className="text-zinc-400">▸ {alt.option}:</span> {alt.tradeoff}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter desktop test -- branch-card
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/branch-card.tsx \
        apps/desktop/src/components/branch-card.test.tsx
git commit -m "feat(desktop): BranchCard component for map coach decisions"
```

---

## Task 8: TeachingCallouts + ConfidencePill components

**Files:**
- Create: `apps/desktop/src/components/teaching-callouts.tsx`
- Create: `apps/desktop/src/components/teaching-callouts.test.tsx`
- Create: `apps/desktop/src/components/confidence-pill.tsx`
- Create: `apps/desktop/src/components/confidence-pill.test.tsx`

- [ ] **Step 1: Write failing tests for TeachingCallouts**

Create `apps/desktop/src/components/teaching-callouts.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeachingCallouts } from "./teaching-callouts";

describe("TeachingCallouts", () => {
  it("renders nothing when callouts array is empty", () => {
    const { container } = render(<TeachingCallouts callouts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders each callout with explanation", () => {
    render(
      <TeachingCallouts
        callouts={[
          { pattern: "rest_after_elite", floors: [26], explanation: "Heals elite cost." },
          { pattern: "hard_pool", floors: [28, 29], explanation: "Expect 15+ HP per fight." },
        ]}
      />,
    );
    expect(screen.getByText(/Heals elite cost/)).toBeInTheDocument();
    expect(screen.getByText(/Expect 15\+ HP per fight/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
pnpm --filter desktop test -- teaching-callouts
```

Expected: FAIL.

- [ ] **Step 3: Implement TeachingCallouts**

Create `apps/desktop/src/components/teaching-callouts.tsx`:

```tsx
import type { MapCoachEvaluation } from "../lib/eval-inputs/map";

interface TeachingCalloutsProps {
  callouts: MapCoachEvaluation["teachingCallouts"];
}

export function TeachingCallouts({ callouts }: TeachingCalloutsProps) {
  if (callouts.length === 0) return null;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Why this is a good path
      </h4>
      <ul className="mt-1.5 space-y-1.5 text-xs text-zinc-400 leading-relaxed">
        {callouts.map((c, i) => (
          <li key={i} className="flex gap-1.5">
            <span aria-hidden>💡</span>
            <span>{c.explanation}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Run: PASS.

- [ ] **Step 4: Write failing ConfidencePill tests + implement**

Create `apps/desktop/src/components/confidence-pill.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ConfidencePill } from "./confidence-pill";

describe("ConfidencePill", () => {
  it("renders green when confidence >= 0.75", () => {
    const { container } = render(<ConfidencePill confidence={0.82} />);
    expect(container.firstChild).toHaveClass("text-emerald-400");
  });

  it("renders amber for 0.5-0.74", () => {
    const { container } = render(<ConfidencePill confidence={0.6} />);
    expect(container.firstChild).toHaveClass("text-amber-400");
  });

  it("renders red below 0.5", () => {
    const { container } = render(<ConfidencePill confidence={0.3} />);
    expect(container.firstChild).toHaveClass("text-red-400");
  });
});
```

Create `apps/desktop/src/components/confidence-pill.tsx`:

```tsx
import { cn } from "@sts2/shared/lib/cn";

export function ConfidencePill({ confidence }: { confidence: number }) {
  const rounded = confidence.toFixed(2);
  const colorClass =
    confidence >= 0.75
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/25"
      : confidence >= 0.5
      ? "text-amber-400 bg-amber-500/10 border-amber-500/25"
      : "text-red-400 bg-red-500/10 border-red-500/25";
  return (
    <span
      className={cn(
        "text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border",
        colorClass,
      )}
    >
      conf: {rounded}
    </span>
  );
}
```

Run: `pnpm --filter desktop test -- confidence-pill` — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/teaching-callouts.tsx \
        apps/desktop/src/components/teaching-callouts.test.tsx \
        apps/desktop/src/components/confidence-pill.tsx \
        apps/desktop/src/components/confidence-pill.test.tsx
git commit -m "feat(desktop): TeachingCallouts + ConfidencePill components"
```

---

## Task 9: Adapter + MapView integration

**Files:**
- Modify: `apps/desktop/src/services/evaluationApi.ts`
- Modify: `apps/desktop/src/lib/eval-inputs/map.ts`
- Modify: `apps/desktop/src/views/map/map-view.tsx`
- Modify: `apps/desktop/src/views/map/__tests__/map-view.test.tsx` (if snapshot-based)

- [ ] **Step 1: Update adapter in `evaluationApi.ts`**

Locate the adapter that converts the raw server response for map evals (likely keyed on `type: "map"`). Replace the snake→camel mapping with:

```ts
import type { MapCoachOutputRaw } from "@sts2/shared/evaluation/map-coach-schema";
import type { MapCoachEvaluation } from "../lib/eval-inputs/map";

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
  };
}
```

Delete or deprecate the old `adaptMapEval` function (and `MapPathEvaluation`) in favor of `adaptMapCoach` / `MapCoachEvaluation`. Rename imports of `MapPathEvaluation` across the codebase to `MapCoachEvaluation`. Grep-replace:

```bash
grep -rl "MapPathEvaluation" apps packages
```

…and update each hit.

- [ ] **Step 2: Update MapView to render new shape**

Replace the sidebar rendering in `apps/desktop/src/views/map/map-view.tsx`. Keep the SVG map as-is. Replace the import of `MapPathEvaluation` with `MapCoachEvaluation`. Replace `overall_advice` / per-option `rankings.find(...)` usage:

Find the block around lines 322-389 (the sidebar). Replace the entire `<div className="w-52 shrink-0 flex flex-col gap-1.5 min-h-0 overflow-y-auto">` block with:

```tsx
      {/* Sidebar — Coach output */}
      <div className="w-64 shrink-0 flex flex-col gap-2 min-h-0 overflow-y-auto">
        {evaluation && (
          <>
            {/* Headline + confidence */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold leading-snug text-zinc-100">
                  {evaluation.headline}
                </h3>
                <ConfidencePill confidence={evaluation.confidence} />
              </div>
            </div>

            {/* Why this path — reasoning (full visibility, no truncation) */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Why this path
              </h4>
              <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed">
                <span className="font-semibold text-zinc-200">Risk capacity: </span>
                {evaluation.reasoning.riskCapacity}
              </p>
              <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed">
                <span className="font-semibold text-zinc-200">Act goal: </span>
                {evaluation.reasoning.actGoal}
              </p>
            </div>

            {/* Path summary */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Path
              </h4>
              <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                {evaluation.macroPath.summary}
              </p>
            </div>

            {/* Key decisions */}
            {evaluation.keyBranches.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <h4 className="px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Key decisions
                </h4>
                {evaluation.keyBranches.map((b, i) => (
                  <BranchCard key={i} branch={b} />
                ))}
              </div>
            )}

            {/* Teaching callouts */}
            <TeachingCallouts callouts={evaluation.teachingCallouts} />
          </>
        )}

        {error && <EvalError error={error} onRetry={() => dispatch(evalRetryRequested("map"))} />}
      </div>
```

Add imports at the top:

```tsx
import { BranchCard } from "../../components/branch-card";
import { TeachingCallouts } from "../../components/teaching-callouts";
import { ConfidencePill } from "../../components/confidence-pill";
```

Remove imports of `TierBadge` from this file — no longer used in the sidebar.

Remove `REC_BORDER` constant and the `bestOptionIndex` `useMemo` block that derived it from `rankings`. Replace `bestOptionKey` derivation (lines ~146-160) with a macro-path-based lookup:

```tsx
  // Best next node = first entry in macro_path whose node_id matches a next_option
  const bestOptionKey = useMemo(() => {
    if (!evaluation?.macroPath.floors.length) {
      // Fallback: recommended path node
      for (const opt of next_options) {
        if (recommendedPathNodes.has(`${opt.col},${opt.row}`)) {
          return `${opt.col},${opt.row}`;
        }
      }
      return null;
    }
    const firstOnPath = evaluation.macroPath.floors[0];
    return firstOnPath.nodeId;
  }, [evaluation, next_options, recommendedPathNodes]);
```

Note: `node_id` on `macro_path.floors` is `${col},${row}` format. Confirm this assumption by verifying how `node_id` is populated in the LLM output — if it isn't, update the prompt instructions in `MAP_PATHING_SCAFFOLD` to specify the format: `node_id must be "<col>,<row>"`.

Update `MAP_PATHING_SCAFFOLD` in `packages/shared/evaluation/prompt-builder.ts` to enforce the format:

```ts
// Add at the end of MAP_PATHING_SCAFFOLD:
// `node_id MUST be the "col,row" coordinate string for each floor — these are used by the client to map the recommended path onto the map graph.`
```

- [ ] **Step 3: Update mapListeners to derive recommendedPath from macroPath**

In `apps/desktop/src/features/map/mapListeners.ts`, find the code that computes and stores `recommendedPath` (search for `recommendedPath`). Replace the current derivation with:

```ts
// When a map coach evaluation arrives, derive recommendedPath from macroPath.floors
const recommendedPath = evaluation.macroPath.floors.map((f) => {
  const [col, row] = f.nodeId.split(",").map(Number);
  return { col, row };
});
dispatch(recommendedPathSet(recommendedPath));
```

Remove the previous derivation logic (likely a tier-based sort of `rankings`).

- [ ] **Step 4: Update map-view test**

In `apps/desktop/src/views/map/__tests__/map-view.test.tsx`, update any fixtures / Redux state stubs that use the old `MapPathEvaluation` shape to the new `MapCoachEvaluation` shape.

Run:

```bash
pnpm --filter desktop test -- map-view
```

Fix any test failures by updating fixtures. The component behavior test (best-node highlight, stale eval detection) should still pass with equivalent new-shape data.

- [ ] **Step 5: Manual smoke — start desktop app, trigger a map eval**

```bash
pnpm --filter desktop dev
```

Open the app, play up to a map view, trigger the eval. Verify:
- Headline renders at top of sidebar with a confidence pill
- "Why this path" shows two sentences (risk capacity, act goal) fully visible
- Path summary shows
- At least one BranchCard renders with recommended + alternatives
- TeachingCallouts shows patterns (or is hidden when empty)
- The map SVG highlights the first `macroPath.floors[0]` node as "best"
- Retry, stale eval, and loading states still work

If any UI is broken, fix inline before committing.

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/services/evaluationApi.ts \
        apps/desktop/src/lib/eval-inputs/map.ts \
        apps/desktop/src/views/map/map-view.tsx \
        apps/desktop/src/views/map/__tests__/map-view.test.tsx \
        apps/desktop/src/features/map/mapListeners.ts \
        packages/shared/evaluation/prompt-builder.ts
git commit -m "feat(desktop): map view renders map coach output"
```

---

## Task 10: Backtest harness script

**Files:**
- Create: `apps/web/scripts/map-coach-backtest.ts`

- [ ] **Step 1: Write the script**

Create `apps/web/scripts/map-coach-backtest.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Map coach backtest harness.
 *
 * Pulls historical map-type choice rows, reconstructs inputs, runs the new
 * enrichment + eval, and reports bucket counts:
 *   - v2_agrees_with_user   (new recommendation == user's actual choice)
 *   - v2_agrees_with_old    (new recommendation == old recommendation)
 *   - v2_differs_from_both  (new disagrees with both)
 *
 * Reads:
 *   - Supabase URL + service role key from .env.local
 *
 * Usage:
 *   pnpm tsx apps/web/scripts/map-coach-backtest.ts --character=ironclad --ascension=10
 *
 * Output:
 *   Table written to apps/web/scripts/backtest-report-<iso>.md
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    character: { type: "string", default: "ironclad" },
    ascension: { type: "string", default: "10" },
    limit: { type: "string", default: "500" },
  },
});

const envPath = ".env.local";
const env = Object.fromEntries(
  readFileSync(envPath, "utf-8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("=", 2) as [string, string]),
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: rows, error } = await supabase
    .from("choices")
    .select("*, runs!inner(character, ascension_level, victory, final_floor)")
    .eq("choice_type", "map")
    .eq("runs.character", values.character!)
    .eq("runs.ascension_level", Number(values.ascension!))
    .limit(Number(values.limit!));
  if (error) throw error;
  if (!rows) {
    console.log("No rows found.");
    return;
  }

  const buckets = {
    v2_agrees_with_user: 0,
    v2_agrees_with_old: 0,
    v2_differs_from_both: 0,
  };
  let wonOfUserAgree = 0;
  let wonOfOldAgree = 0;
  let wonOfDiffers = 0;

  for (const row of rows) {
    // TODO — phase 1 stub: calling the new eval end-to-end requires
    // rebuilding game state from game_context + rankings_snapshot.
    // For a first pass, compare only old vs actual:
    const oldAgreesWithUser = row.recommended_item_id === row.chosen_item_id;
    const won = row.runs.victory;

    // Placeholder classification pending full eval-replay implementation:
    if (oldAgreesWithUser) {
      buckets.v2_agrees_with_old++;
      if (won) wonOfOldAgree++;
    } else {
      buckets.v2_differs_from_both++;
      if (won) wonOfDiffers++;
    }
  }

  const total = rows.length;
  const report = [
    `# Map Coach Backtest — ${new Date().toISOString()}`,
    ``,
    `Character: ${values.character} | Ascension: ${values.ascension} | Rows: ${total}`,
    ``,
    `| Bucket | Count | % | Wins | Win rate |`,
    `|---|---|---|---|---|`,
    ...Object.entries(buckets).map(([k, v]) => {
      const wins =
        k === "v2_agrees_with_user" ? wonOfUserAgree :
        k === "v2_agrees_with_old" ? wonOfOldAgree : wonOfDiffers;
      const pct = ((v / total) * 100).toFixed(1);
      const wr = v ? ((wins / v) * 100).toFixed(1) : "—";
      return `| ${k} | ${v} | ${pct}% | ${wins} | ${wr}% |`;
    }),
    ``,
    `## Notes`,
    ``,
    `Phase 1 stub: this script does NOT yet re-run the new eval against`,
    `historical game state — it only buckets by old-vs-actual. Extending to`,
    `call the new eval requires a full RunStateInputs reconstruction from`,
    `\`game_context\` + \`rankings_snapshot\`, which is a follow-up.`,
  ].join("\n");

  const out = `apps/web/scripts/backtest-report-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
  writeFileSync(out, report);
  console.log(`Report written: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the script against your data**

```bash
pnpm tsx apps/web/scripts/map-coach-backtest.ts --character=ironclad --ascension=10
```

Expected: report file written, printed count of rows and bucket distribution.

- [ ] **Step 3: Commit**

```bash
git add apps/web/scripts/map-coach-backtest.ts
git commit -m "feat(eval): map coach backtest harness (phase 1 stub)"
```

Note that full eval-replay (reconstructing game state and re-running the LLM) is intentionally deferred; the stub buckets old-vs-actual to establish the baseline. The real calibration loop belongs to phase 2.

---

## Task 11: End-to-end smoke + verification

**Files:**
- Manual, no file changes unless fixes are needed.

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: all tests across all workspaces PASS.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Lint**

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 4: Build**

```bash
pnpm build
```

Expected: web and desktop builds succeed.

- [ ] **Step 5: Manual end-to-end test on desktop**

Start the desktop app and play a real or replayed run long enough to hit a map eval. Verify end-to-end:

1. Eval request fires with new enriched prompt (inspect network/eval log).
2. Response parses as `mapCoachOutput`.
3. `choices` row lands in Supabase with both `rankings_snapshot` (full output) and `run_state_snapshot` populated:

```bash
pnpm supabase db query "SELECT run_id, floor, rankings_snapshot->'headline' AS headline, run_state_snapshot->'riskCapacity'->>'verdict' AS risk FROM choices WHERE choice_type='map' ORDER BY created_at DESC LIMIT 5;"
```

4. UI renders correctly (headline, reasoning blocks, branches, callouts).
5. Map graph best-node highlight matches `macro_path.floors[0]`.
6. Recommended path on the graph matches `macro_path.floors`.

- [ ] **Step 6: Compare coach output vs prior behavior**

On 3–5 real map decisions, screenshot the new eval output and note whether the coach's recommendation agrees with your judgment. On disagreements, inspect whether the coach's stated reasoning (risk capacity + act goal) is at least *plausible*. This is qualitative, not pass/fail — it's the gate for "is phase 1 good enough to ship or does the prompt need more iteration?"

- [ ] **Step 7: Final commit (if any fixes)**

If any issues surfaced during smoke test and needed a fix, commit them here. Otherwise skip.

```bash
git add -A
git commit -m "fix(eval): map coach smoke fixes"
```

- [ ] **Step 8: Push and open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(eval): map pathing coach phase 1" --body "$(cat <<'EOF'
## Summary
Phase 1 of the map pathing coach. Deterministic run-state enrichment + pattern
annotations feed a reasoning-scaffolded prompt; LLM returns structured coaching
output (reasoning, macro path, key branches, teaching callouts), rendered by a
redesigned teaching-first sidebar.

Closes #<issue-number>

## Test plan
- [ ] `pnpm test` all pass
- [ ] `pnpm typecheck` clean
- [ ] `pnpm build` succeeds
- [ ] Backtest harness runs against historical data
- [ ] Manual smoke: headline/reasoning/branches/callouts render; `choices.run_state_snapshot` populated
- [ ] Best-node highlight and recommended path derived from `macro_path`

## Related
- Spec: docs/superpowers/specs/2026-04-18-map-pathing-coach-design.md
EOF
)"
```

Replace `<issue-number>` with the GitHub issue number tracking this work. If no issue exists yet, create one first with `gh issue create`.

---

## Self-review notes

- **Spec coverage:** Every section in the spec (architecture, run-state enrichment, pattern annotations, prompt restructure, output schema, UI, testing, telemetry, backtest) maps to one or more tasks here. Phase-2 and phase-1.5 items are explicitly deferred.
- **Workspace boundaries:** Task 4 flags the cross-workspace import issue and resolves it via relocation in Step 6. Task 6 notes the `RunStateInputs`-builder duplication and defers the shared extraction.
- **Prompt/format coupling:** `node_id` format (`"col,row"`) is specified in both the prompt scaffold (Task 9 Step 2) and the client derivation — change one, change both.
- **Failure modes captured:** schema `.max()` caps could be rejected by Anthropic's structured-output endpoint (see eval-schemas.ts header in the repo) — Task 1 notes the fallback to prompt-level caps + post-validation filter.
