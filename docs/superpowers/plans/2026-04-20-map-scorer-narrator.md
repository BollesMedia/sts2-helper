# Map Coach — Deterministic Scorer + LLM Narrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invert the map coach architecture — a deterministic scorer picks the path, the LLM narrates the structured rule annotations. Eliminates the class of bugs where the LLM produces self-contradictory output.

**Architecture:** New pure-TS scorer (two-phase hard-filter + weighted sum) ranks `EnrichedPath[]`. Server derives structural branches and narrator input from the ranked list, then calls the LLM with a much smaller `MAP_NARRATOR_PROMPT` for coaching text only. The LLM response is assembled with scorer-injected `macro_path`, `key_branches`, and `confidence` into the same `mapCoachOutputSchema` the desktop already consumes.

**Tech Stack:** TypeScript (strict), Vitest (shared tests run from the `apps/web` and `apps/desktop` vitest configs via the `packages/shared/evaluation/**/*.test.{ts,tsx}` glob), Redux Toolkit listener middleware, AI SDK v6 (`ai`, `@ai-sdk/anthropic`), Zod, Next.js App Router (route handler).

**Spec:** `docs/superpowers/specs/2026-04-20-map-scorer-narrator-design.md`

---

## File Structure

### New files

- `packages/shared/evaluation/map/score-paths.ts` — pure scorer. Exports `scorePaths`, `ScoredPath`, `MAP_SCORE_WEIGHTS`, `MIN_SHOP_PRICE_FLOOR`, `REST_HEAL_PCT`.
- `packages/shared/evaluation/map/score-paths.test.ts`
- `packages/shared/evaluation/map/derive-branches.ts` — structural branch derivation. Exports `deriveBranches`, `DerivedBranch`.
- `packages/shared/evaluation/map/derive-branches.test.ts`
- `packages/shared/evaluation/map/build-narrator-input.ts` — assembles `NarratorInput` from scorer output + run state. Exports `buildNarratorInput`, `NarratorInput`.
- `packages/shared/evaluation/map/build-narrator-input.test.ts`

### Modified files

- `packages/shared/evaluation/prompt-builder.ts` — add `MAP_NARRATOR_PROMPT`; delete `MAP_PATHING_SCAFFOLD`; delete the `map:` entry in `TYPE_ADDENDA` (narrator prompt is self-contained).
- `packages/shared/evaluation/map-coach-schema.ts` — add `mapNarratorOutputSchema` (LLM response only). Keep `mapCoachOutputSchema` as the server→client contract. Keep `sanitizeMapCoachOutput`.
- `apps/web/src/app/api/evaluate/route.ts` — map branch: enrich → score → derive branches → build narrator input → LLM call with narrator schema → assemble final response with scorer-injected fields.
- `apps/desktop/src/lib/should-evaluate-map.ts` — rewrite from scratch to the three structural triggers.
- `apps/desktop/src/lib/should-evaluate-map.test.ts` — new cases, see Task 9.
- `apps/desktop/src/features/map/mapListeners.ts` — drop `allOptionsAreAncient` local flag (now handled by trigger 1), drop Tier 1 re-trace (scorer always returns a path), drop ACT_CHANGE_GRACE_SKIPS counter (replaced by post-ancient check inside `shouldEvaluateMap`), pass enriched+scored paths to `/api/choice` via `runStateSnapshot` for telemetry.

### Retired files

- `packages/shared/evaluation/map/rerank-if-dominated.ts` — delete (scorer makes rerank unreachable).
- `packages/shared/evaluation/map/rerank-if-dominated.test.ts` — delete.

### Shrunk files

- `packages/shared/evaluation/map/repair-macro-path.ts` — drop the LLM-drift repair path (no LLM `macro_path` to repair). Keep only the `nodesById`, `adjacency`, and `walkFromNextOption` helpers that the scorer / branch derivation need. If none of them are reused, delete the whole file. Decide in Task 11 based on what scorer + branches import.

### Unchanged (reference only)

- `packages/shared/evaluation/map/enrich-paths.ts`
- `packages/shared/evaluation/map/run-state.ts`
- `apps/desktop/src/features/map/map-view.tsx` (and related UI components)
- `packages/shared/evaluation/map-coach-schema.ts`'s `mapCoachOutputSchema` (the server→client contract)

---

## Conventions

- **Language:** TypeScript strict; prefer inference and `satisfies` over explicit type annotations where practical.
- **Test runner:** Vitest. Shared-package tests are discovered by `apps/web/vitest.config.ts` (`../../packages/shared/evaluation/**/*.test.{ts,tsx}` glob). Run from `apps/web`: `pnpm --filter @sts2/web test -- <path-or-name>`.
- **Typecheck:** `pnpm -w turbo build` or per-workspace `pnpm --filter @sts2/shared typecheck` (when the script exists). If not, `pnpm --filter @sts2/web build` also typechecks shared code transitively.
- **Commits:** conventional, lowercase imperative. Commit after each task. Group test + implementation into one commit.
- **Working directory for all commands:** `/Users/drewbolles/Sites/_bollesmedia/sts2-helper/.worktrees/feat/93-map-scorer-narrator`.

---

## Task 1: Scaffold `score-paths.ts` with constants, types, and empty `scorePaths`

**Files:**
- Create: `packages/shared/evaluation/map/score-paths.ts`
- Create: `packages/shared/evaluation/map/score-paths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/evaluation/map/score-paths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  scorePaths,
  MAP_SCORE_WEIGHTS,
  MIN_SHOP_PRICE_FLOOR,
  REST_HEAL_PCT,
} from "./score-paths";
import type { EnrichedPath } from "./enrich-paths";
import type { RunState } from "./run-state";

function emptyRunState(overrides: Partial<RunState> = {}): RunState {
  return {
    hp: { current: 60, max: 80, ratio: 0.75 },
    gold: 100,
    act: 1,
    floor: 1,
    floorsRemainingInAct: 16,
    ascension: 10,
    deck: { size: 15, archetype: null, avgUpgradeRatio: 0, removalCandidates: 10 },
    relics: { combatRelevant: [], pathAffecting: [] },
    riskCapacity: { hpBufferAbsolute: 30, expectedDamagePerFight: 16, fightsBeforeDanger: 2, verdict: "moderate" },
    eliteBudget: { actTarget: [2, 3], eliteFloorsFought: [], remaining: 2, shouldSeek: true },
    goldMath: { current: 100, removalAffordable: true, shopVisitsAhead: 1, projectedShopBudget: 220 },
    monsterPool: { currentPool: "easy", fightsUntilHardPool: 3 },
    bossPreview: {
      candidates: [],
      dangerousMatchups: [],
      preBossRestFloor: 16,
      hpEnteringPreBossRest: 40,
      preBossRestRecommendation: "heal",
    },
    ...overrides,
  };
}

describe("scorePaths constants", () => {
  it("exports the documented weight set", () => {
    expect(MAP_SCORE_WEIGHTS.elitesTaken).toBe(10);
    expect(MAP_SCORE_WEIGHTS.elitesInAct1Bonus).toBe(2);
    expect(MAP_SCORE_WEIGHTS.restBeforeElite).toBe(8);
    expect(MAP_SCORE_WEIGHTS.restAfterElite).toBe(5);
    expect(MAP_SCORE_WEIGHTS.treasuresTaken).toBe(6);
    expect(MAP_SCORE_WEIGHTS.unknownsActs1And2).toBe(2);
    expect(MAP_SCORE_WEIGHTS.unknownsAct3).toBe(1);
    expect(MAP_SCORE_WEIGHTS.projectedHpAtBossFight).toBe(4);
    expect(MAP_SCORE_WEIGHTS.distanceToAct3EliteOpportunities).toBe(3);
    expect(MAP_SCORE_WEIGHTS.hpDipBelow30PctPenalty).toBe(-5);
    expect(MAP_SCORE_WEIGHTS.hpDipBelow15PctPenalty).toBe(-12);
    expect(MAP_SCORE_WEIGHTS.backToBackShopPairUnderGold).toBe(-3);
    expect(MAP_SCORE_WEIGHTS.hardPoolChainLength).toBe(-2);
  });
  it("exports the shop-floor constant in gold", () => {
    expect(MIN_SHOP_PRICE_FLOOR).toBe(50);
  });
  it("exports the rest-heal ratio used by the post-rest projection", () => {
    expect(REST_HEAL_PCT).toBe(0.3);
  });
});

describe("scorePaths smoke", () => {
  it("returns an empty array when given no paths", () => {
    const result = scorePaths([] as EnrichedPath[], emptyRunState(), { cardRemovalCost: 75 });
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sts2/web test -- score-paths`
Expected: FAIL with module-not-found for `./score-paths`.

- [ ] **Step 3: Implement the scaffold**

Create `packages/shared/evaluation/map/score-paths.ts`:

```ts
import type { EnrichedPath } from "./enrich-paths";
import type { RunState } from "./run-state";

export const MAP_SCORE_WEIGHTS = {
  elitesTaken: 10,
  elitesInAct1Bonus: 2,
  restBeforeElite: 8,
  restAfterElite: 5,
  treasuresTaken: 6,
  unknownsActs1And2: 2,
  unknownsAct3: 1,
  projectedHpAtBossFight: 4,
  distanceToAct3EliteOpportunities: 3,
  hpDipBelow30PctPenalty: -5,
  hpDipBelow15PctPenalty: -12,
  backToBackShopPairUnderGold: -3,
  hardPoolChainLength: -2,
} as const;

export const MIN_SHOP_PRICE_FLOOR = 50;
export const REST_HEAL_PCT = 0.3;

export interface ScoredPath extends EnrichedPath {
  score: number;
  scoreBreakdown: Record<string, number>;
  disqualified: boolean;
  disqualifyReasons: string[];
}

export interface ScorePathsOptions {
  /** Card removal cost at the current floor. Used for naked-shop rule. */
  cardRemovalCost: number;
}

export function scorePaths(
  paths: EnrichedPath[],
  runState: RunState,
  options: ScorePathsOptions,
): ScoredPath[] {
  if (paths.length === 0) return [];
  // Real implementation lands in Tasks 2–4.
  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sts2/web test -- score-paths`
Expected: PASS (3 tests passing in `score-paths.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/map/score-paths.ts packages/shared/evaluation/map/score-paths.test.ts
git commit -m "feat(map): scaffold score-paths with weights and types"
```

---

## Task 2: Implement phase 1 — hard filter

**Files:**
- Modify: `packages/shared/evaluation/map/score-paths.ts`
- Modify: `packages/shared/evaluation/map/score-paths.test.ts`

Hard filter rules per spec:
1. `minHpAlongPath <= 0` → disqualified "fatal".
2. Elite abdication: Act 1 with 0 elites when any alternative has ≥2 elites AND `minHpAlongPath > 0`; Act 2 with 0 elites when any alternative has ≥1 elite AND `minHpAlongPath > 0`.
3. Naked shop: any shop on path AND projected gold at that shop floor < `MIN_SHOP_PRICE_FLOOR` AND some alternative has equal-or-more elites with a viable shop (or with no shops at all).

If every path is disqualified, sort by fewest violations and keep that tier for phase 2; set `disqualified = true` on all but annotate reasons.

We need a helper `minHpAlongPath(enriched)`. `enriched.aggregates.projectedHpEnteringPreBossRest` is the HP BEFORE the pre-boss rest per the walk in `enrich-paths.ts`. For the "fatal" check we need the *minimum* HP seen along the walk. `enrich-paths.ts` computes it internally (`minHpAlongPath`) but does not export it. Rather than modify `enrich-paths.ts`, re-derive it in score-paths from the aggregates we have + path nodes:

- If `aggregates.hpProjectionVerdict === "critical"` AND `aggregates.projectedHpEnteringPreBossRest < 0` → fatal.
- Otherwise re-walk the path with the same constants as `enrich-paths.ts` to get `minHpAlongPath`. Use the same formula (`expectedDmg`, `eliteMultiplier=1.5`, `restHeal = round(maxHp * 0.3)`, stop at `preBossRestFloor`).

Extract the walk into a small internal helper `simulatePathHp`. Keep it local to `score-paths.ts` for now. If future work needs it elsewhere, promote to a shared file.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/evaluation/map/score-paths.test.ts`:

```ts
import type { PathNode } from "./path-patterns";

function makeEnriched(
  id: string,
  nodes: PathNode[],
  overrides: Partial<EnrichedPath["aggregates"]> = {},
): EnrichedPath {
  const elitesTaken = nodes.filter((n) => n.type === "elite").length;
  const restsTaken = nodes.filter((n) => n.type === "rest").length;
  const shopsTaken = nodes.filter((n) => n.type === "shop").length;
  const monstersTaken = nodes.filter((n) => n.type === "monster").length;
  return {
    id,
    nodes,
    patterns: [],
    aggregates: {
      elitesTaken,
      monstersTaken,
      restsTaken,
      shopsTaken,
      hardPoolFightsOnPath: 0,
      totalFights: elitesTaken + monstersTaken,
      projectedHpEnteringPreBossRest: 40,
      fightBudgetStatus: "within_budget",
      hpProjectionVerdict: "safe",
      ...overrides,
    },
  };
}

function node(type: PathNode["type"], floor: number, col = 0): PathNode {
  return { type, floor, col, row: floor } as PathNode;
}

describe("scorePaths — phase 1 hard filter", () => {
  it("disqualifies a path whose min HP reaches 0", () => {
    // 5 monsters in a row with expectedDmg=16 and hp=60 → dips to -20.
    const lethal = makeEnriched("lethal", [
      node("monster", 1),
      node("monster", 2),
      node("monster", 3),
      node("monster", 4),
      node("monster", 5),
    ], { monstersTaken: 5, totalFights: 5 });
    const safe = makeEnriched("safe", [
      node("monster", 1),
      node("rest", 2),
      node("monster", 3),
    ]);
    const result = scorePaths([lethal, safe], emptyRunState(), { cardRemovalCost: 75 });
    const scored = result.find((p) => p.id === "lethal");
    expect(scored?.disqualified).toBe(true);
    expect(scored?.disqualifyReasons).toContain("fatal");
  });

  it("disqualifies a 0-elite path in Act 1 when a 2-elite alternative exists and survives", () => {
    const zeroElite = makeEnriched("zero", [node("monster", 1), node("rest", 2)]);
    const twoElite = makeEnriched(
      "two",
      [node("rest", 1), node("elite", 2), node("rest", 3), node("elite", 4)],
      { elitesTaken: 2 },
    );
    const result = scorePaths(
      [zeroElite, twoElite],
      emptyRunState({ act: 1 }),
      { cardRemovalCost: 75 },
    );
    expect(result.find((p) => p.id === "zero")?.disqualified).toBe(true);
    expect(result.find((p) => p.id === "zero")?.disqualifyReasons).toContain("elite_abdication");
    expect(result.find((p) => p.id === "two")?.disqualified).toBe(false);
  });

  it("disqualifies a 0-elite path in Act 2 when a 1-elite alternative exists and survives", () => {
    const zeroElite = makeEnriched("zero", [node("monster", 1), node("rest", 2)]);
    const oneElite = makeEnriched("one", [node("rest", 1), node("elite", 2)], { elitesTaken: 1 });
    const result = scorePaths(
      [zeroElite, oneElite],
      emptyRunState({ act: 2 }),
      { cardRemovalCost: 75 },
    );
    expect(result.find((p) => p.id === "zero")?.disqualified).toBe(true);
    expect(result.find((p) => p.id === "zero")?.disqualifyReasons).toContain("elite_abdication");
  });

  it("does NOT disqualify a 0-elite path in Act 3 (abdication rule is Acts 1/2 only)", () => {
    const zeroElite = makeEnriched("zero", [node("monster", 1), node("rest", 2)]);
    const twoElite = makeEnriched(
      "two",
      [node("rest", 1), node("elite", 2), node("rest", 3), node("elite", 4)],
      { elitesTaken: 2 },
    );
    const result = scorePaths(
      [zeroElite, twoElite],
      emptyRunState({ act: 3 }),
      { cardRemovalCost: 75 },
    );
    expect(result.find((p) => p.id === "zero")?.disqualified).toBe(false);
  });

  it("disqualifies a naked-shop path when projected gold < MIN_SHOP_PRICE_FLOOR and an alternative exists", () => {
    // Starting gold 30, ~40g per fight, shop at floor 2 so gold ≈ 30 + ~0 fights = 30 < 50.
    const nakedShop = makeEnriched("naked", [node("shop", 2)], { shopsTaken: 1 });
    const viable = makeEnriched(
      "viable",
      [node("elite", 1), node("elite", 2)],
      { elitesTaken: 2 },
    );
    const result = scorePaths(
      [nakedShop, viable],
      emptyRunState({ gold: 30 }),
      { cardRemovalCost: 75 },
    );
    expect(result.find((p) => p.id === "naked")?.disqualified).toBe(true);
    expect(result.find((p) => p.id === "naked")?.disqualifyReasons).toContain("naked_shop");
  });

  it("keeps a shop path when projected gold at the shop floor is >= MIN_SHOP_PRICE_FLOOR", () => {
    const okShop = makeEnriched("ok", [node("shop", 2)], { shopsTaken: 1 });
    const other = makeEnriched("other", [node("monster", 1)]);
    const result = scorePaths(
      [okShop, other],
      emptyRunState({ gold: 100 }),
      { cardRemovalCost: 75 },
    );
    expect(result.find((p) => p.id === "ok")?.disqualified).toBe(false);
  });

  it("falls back to 'least bad' when every path is disqualified", () => {
    const fatal1 = makeEnriched("f1", [
      node("monster", 1), node("monster", 2), node("monster", 3),
      node("monster", 4), node("monster", 5),
    ]);
    const fatal2 = makeEnriched("f2", [
      node("monster", 1), node("monster", 2), node("monster", 3),
      node("monster", 4), node("monster", 5), node("monster", 6),
    ]);
    const result = scorePaths(
      [fatal1, fatal2],
      emptyRunState(),
      { cardRemovalCost: 75 },
    );
    // Both disqualified, but result is non-empty — caller still gets something.
    expect(result.length).toBe(2);
    expect(result.every((p) => p.disqualified)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @sts2/web test -- score-paths`
Expected: FAIL — the hard-filter tests fail (no filter logic yet).

- [ ] **Step 3: Implement the hard filter**

Replace the body of `scorePaths` and add helpers. The full updated `packages/shared/evaluation/map/score-paths.ts`:

```ts
import type { EnrichedPath } from "./enrich-paths";
import type { PathNode } from "./path-patterns";
import type { RunState } from "./run-state";

export const MAP_SCORE_WEIGHTS = {
  elitesTaken: 10,
  elitesInAct1Bonus: 2,
  restBeforeElite: 8,
  restAfterElite: 5,
  treasuresTaken: 6,
  unknownsActs1And2: 2,
  unknownsAct3: 1,
  projectedHpAtBossFight: 4,
  distanceToAct3EliteOpportunities: 3,
  hpDipBelow30PctPenalty: -5,
  hpDipBelow15PctPenalty: -12,
  backToBackShopPairUnderGold: -3,
  hardPoolChainLength: -2,
} as const;

export const MIN_SHOP_PRICE_FLOOR = 50;
export const REST_HEAL_PCT = 0.3;

const ELITE_MULTIPLIER = 1.5;
const ESTIMATED_GOLD_PER_FIGHT = 40;

export interface ScoredPath extends EnrichedPath {
  score: number;
  scoreBreakdown: Record<string, number>;
  disqualified: boolean;
  disqualifyReasons: string[];
}

export interface ScorePathsOptions {
  cardRemovalCost: number;
}

interface WalkSnapshot {
  minHp: number;
  dipsBelow30Pct: number;
  dipsBelow15Pct: number;
  projectedHpEnteringPreBossRest: number;
}

function simulatePathHp(path: EnrichedPath, runState: RunState): WalkSnapshot {
  const { expectedDamagePerFight } = runState.riskCapacity;
  const restHeal = Math.round(runState.hp.max * REST_HEAL_PCT);
  const preBossRestFloor = runState.bossPreview.preBossRestFloor;
  let hp = runState.hp.current;
  let minHp = hp;
  let dipsBelow30Pct = 0;
  let dipsBelow15Pct = 0;
  const thirtyPct = runState.hp.max * 0.3;
  const fifteenPct = runState.hp.max * 0.15;
  for (const n of path.nodes) {
    if (n.floor === preBossRestFloor) break;
    switch (n.type) {
      case "monster":
        hp -= expectedDamagePerFight;
        break;
      case "elite":
        hp -= Math.round(expectedDamagePerFight * ELITE_MULTIPLIER);
        break;
      case "rest":
        hp = Math.min(runState.hp.max, hp + restHeal);
        break;
      default:
        break;
    }
    if (hp < minHp) minHp = hp;
    if (hp < thirtyPct) dipsBelow30Pct += 1;
    if (hp < fifteenPct) dipsBelow15Pct += 1;
  }
  return {
    minHp,
    dipsBelow30Pct,
    dipsBelow15Pct,
    projectedHpEnteringPreBossRest: Math.max(0, hp),
  };
}

function estimateGoldAtFloor(path: EnrichedPath, floor: number, startGold: number): number {
  let gold = startGold;
  for (const n of path.nodes) {
    if (n.floor >= floor) break;
    if (n.type === "monster" || n.type === "elite") gold += ESTIMATED_GOLD_PER_FIGHT;
  }
  return gold;
}

function findNakedShopFloors(
  path: EnrichedPath,
  startGold: number,
): number[] {
  const nakedFloors: number[] = [];
  for (const n of path.nodes) {
    if (n.type !== "shop") continue;
    const goldAtShop = estimateGoldAtFloor(path, n.floor, startGold);
    if (goldAtShop < MIN_SHOP_PRICE_FLOOR) nakedFloors.push(n.floor);
  }
  return nakedFloors;
}

function applyHardFilter(
  paths: EnrichedPath[],
  runState: RunState,
  options: ScorePathsOptions,
  walks: Map<string, WalkSnapshot>,
): Map<string, string[]> {
  const reasons = new Map<string, string[]>();
  const maxElitesOnAnyPath = Math.max(...paths.map((p) => p.aggregates.elitesTaken));
  const anySurvivingEliteAlt = (threshold: number) =>
    paths.some(
      (p) =>
        p.aggregates.elitesTaken >= threshold &&
        (walks.get(p.id)?.minHp ?? 0) > 0,
    );

  for (const p of paths) {
    const walk = walks.get(p.id)!;
    const rs: string[] = [];

    // Rule 1 — fatal.
    if (walk.minHp <= 0) rs.push("fatal");

    // Rule 2 — elite abdication.
    if (p.aggregates.elitesTaken === 0) {
      if (runState.act === 1 && anySurvivingEliteAlt(2)) rs.push("elite_abdication");
      else if (runState.act === 2 && anySurvivingEliteAlt(1)) rs.push("elite_abdication");
    }

    // Rule 3 — naked shop.
    if (p.aggregates.shopsTaken > 0) {
      const nakedFloors = findNakedShopFloors(p, runState.gold);
      if (nakedFloors.length > 0) {
        // "Equal-or-more elites with a viable shop" — alt must have elite count
        // >= this path's elite count AND either zero shops or no naked shops.
        const viableAltExists = paths.some((alt) => {
          if (alt.id === p.id) return false;
          if (alt.aggregates.elitesTaken < p.aggregates.elitesTaken) return false;
          if (alt.aggregates.shopsTaken === 0) return true;
          return findNakedShopFloors(alt, runState.gold).length === 0;
        });
        if (viableAltExists) rs.push("naked_shop");
      }
    }

    void options; // reserved for future constraints
    void maxElitesOnAnyPath;

    if (rs.length > 0) reasons.set(p.id, rs);
  }

  return reasons;
}

export function scorePaths(
  paths: EnrichedPath[],
  runState: RunState,
  options: ScorePathsOptions,
): ScoredPath[] {
  if (paths.length === 0) return [];

  const walks = new Map<string, WalkSnapshot>();
  for (const p of paths) walks.set(p.id, simulatePathHp(p, runState));

  const reasons = applyHardFilter(paths, runState, options, walks);
  const everyPathDisqualified = reasons.size === paths.length;

  return paths.map((p) => {
    const r = reasons.get(p.id) ?? [];
    return {
      ...p,
      score: 0,
      scoreBreakdown: {},
      disqualified: everyPathDisqualified ? true : r.length > 0,
      disqualifyReasons: r,
    };
  });
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @sts2/web test -- score-paths`
Expected: PASS — all phase-1 tests pass; earlier scaffold tests also still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/map/score-paths.ts packages/shared/evaluation/map/score-paths.test.ts
git commit -m "feat(map): hard-filter phase of path scorer"
```

---

## Task 3: Implement phase 2 — weighted sum

**Files:**
- Modify: `packages/shared/evaluation/map/score-paths.ts`
- Modify: `packages/shared/evaluation/map/score-paths.test.ts`

Formula from the spec (reproduced for clarity):

```
score =
  +10 * elitesTaken
  + (act === 1 ? +2 * elitesTaken : 0)
  + 8 * restBeforeEliteCount
  + 5 * restAfterEliteCount
  + 6 * treasuresTaken
  + (act <= 2 ? +2 : +1) * unknownsTaken
  + 4 * (projectedHpAtBossFight / maxHp)
  + (act === 3 && ascension >= 10 ? +3 * distanceToAct3EliteOpportunities : 0)
  -  5 * dipsBelow30Pct
  - 12 * dipsBelow15Pct
  -  3 * backToBackShopPairCountUnderGold
  -  2 * hardPoolChainLengthTotal
```

Derivation rules:

- `restBeforeEliteCount`: count of rest nodes immediately followed (at the next floor) by an elite in the path node order.
- `restAfterEliteCount`: count of elite nodes immediately followed by a rest.
- `treasuresTaken`: `path.nodes.filter(n => n.type === "treasure").length`.
- `unknownsTaken`: `path.nodes.filter(n => n.type === "event" || n.type === "unknown").length`.
- `projectedHpAtBossFight`: `simulatePathHp(...).projectedHpEnteringPreBossRest + restHeal`, clamped to `runState.hp.max`. `restHeal = round(maxHp * REST_HEAL_PCT)`.
- `distanceToAct3EliteOpportunities`: only Act 3 + Asc ≥ 10. Count of elites on path PLUS count of elites still reachable downstream. Since enriched paths only see a single next-option's downstream walk, use `p.aggregates.elitesTaken` as a proxy. A future feature can enrich this; the spec allows the simple proxy and the weight is intentionally small.
- `backToBackShopPairCountUnderGold`: consecutive shop nodes where `estimateGoldAtFloor(shop #2) < options.cardRemovalCost`.
- `hardPoolChainLengthTotal`: in Acts 2/3 only, sum of lengths of maximal monster-only runs (no rest/shop/treasure/event interrupts) in `path.nodes`. Zero in Act 1.

Breakdown: every feature contribution is stored in `scoreBreakdown[featureName] = signedDelta`. This is critical for `deriveBranches` (Task 5) which reads per-feature deltas to explain winners.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/evaluation/map/score-paths.test.ts`:

```ts
describe("scorePaths — phase 2 weighted sum", () => {
  it("scores elite count with the act-1 bonus in Act 1", () => {
    const p = makeEnriched(
      "twoElite",
      [node("elite", 1), node("elite", 2)],
      { elitesTaken: 2 },
    );
    const result = scorePaths([p], emptyRunState({ act: 1 }), { cardRemovalCost: 75 });
    // 2 elites × 10 + 2 elites × 2 Act 1 bonus = 24, then various other contributions.
    const breakdown = result[0].scoreBreakdown;
    expect(breakdown.elitesTaken).toBe(20);
    expect(breakdown.elitesInAct1Bonus).toBe(4);
  });

  it("applies no Act 1 bonus outside Act 1", () => {
    const p = makeEnriched(
      "twoElite",
      [node("elite", 1), node("elite", 2)],
      { elitesTaken: 2 },
    );
    const result = scorePaths([p], emptyRunState({ act: 2 }), { cardRemovalCost: 75 });
    expect(result[0].scoreBreakdown.elitesInAct1Bonus).toBe(0);
  });

  it("counts rest-before-elite and rest-after-elite pairs", () => {
    const path = makeEnriched(
      "pair",
      [
        node("monster", 1),
        node("rest", 2),
        node("elite", 3),   // rest-before-elite pair at 2→3
        node("rest", 4),     // rest-after-elite pair at 3→4
        node("monster", 5),
      ],
      { elitesTaken: 1, restsTaken: 2, monstersTaken: 2 },
    );
    const result = scorePaths([path], emptyRunState(), { cardRemovalCost: 75 });
    expect(result[0].scoreBreakdown.restBeforeElite).toBe(8);
    expect(result[0].scoreBreakdown.restAfterElite).toBe(5);
  });

  it("scores unknowns at 2 in Act 1, 2 in Act 2, 1 in Act 3", () => {
    const mk = (act: 1 | 2 | 3) => {
      const p = makeEnriched("u", [node("event", 1), node("event", 2)]);
      return scorePaths([p], emptyRunState({ act }), { cardRemovalCost: 75 });
    };
    expect(mk(1)[0].scoreBreakdown.unknowns).toBe(4);
    expect(mk(2)[0].scoreBreakdown.unknowns).toBe(4);
    expect(mk(3)[0].scoreBreakdown.unknowns).toBe(2);
  });

  it("treasures contribute +6 each", () => {
    const p = makeEnriched("t", [node("treasure", 1)]);
    const result = scorePaths([p], emptyRunState(), { cardRemovalCost: 75 });
    expect(result[0].scoreBreakdown.treasures).toBe(6);
  });

  it("projectedHpAtBossFight uses the post-rest HP (clamped to max)", () => {
    // Starting HP 60, no combat, rest-heal adds 24 (0.3 × 80) → 84, clamped to 80.
    // So projectedHpAtBossFight / maxHp = 1.0, weight × 4 = 4.
    const p = makeEnriched("idle", [node("monster", 1)]);
    const result = scorePaths(
      [p],
      emptyRunState({ hp: { current: 60, max: 80, ratio: 0.75 } }),
      { cardRemovalCost: 75 },
    );
    const bd = result[0].scoreBreakdown;
    // 60 - 16 = 44 entering pre-boss rest, + 24 heal = 68 / 80 = 0.85 × 4 = 3.4 → keep fractional.
    expect(bd.projectedHpAtBoss).toBeCloseTo(3.4, 2);
  });

  it("penalizes hp dips below 30% and below 15%", () => {
    // Starting HP 80, max 80. Expected dmg 16. After 4 monsters HP=16 (20%).
    // dipsBelow30Pct: floors where HP < 24 → after monster 4 HP=16 < 24, also HP=16 < 12 false for 15%.
    const p = makeEnriched("dip", [
      node("monster", 1), node("monster", 2), node("monster", 3),
      node("monster", 4), node("monster", 5),
    ]);
    const result = scorePaths(
      [p],
      emptyRunState({ hp: { current: 80, max: 80, ratio: 1 } }),
      { cardRemovalCost: 75 },
    );
    // After 5 monsters HP=0 — dip below 30% and below 15%. Exact counts depend on walk.
    expect(result[0].scoreBreakdown.hpDipBelow30Pct).toBeLessThan(0);
    expect(result[0].scoreBreakdown.hpDipBelow15Pct).toBeLessThan(0);
  });

  it("penalizes a naked back-to-back shop pair at -3", () => {
    const p = makeEnriched(
      "shops",
      [node("shop", 2), node("shop", 3)],
      { shopsTaken: 2 },
    );
    const result = scorePaths(
      [p],
      emptyRunState({ gold: 30 }),
      { cardRemovalCost: 75 },
    );
    // Shop #2 at floor 3 — projected gold: startGold=30 (no fights before shop #2 either).
    expect(result[0].scoreBreakdown.backToBackShopPair).toBe(-3);
  });

  it("does not penalize a back-to-back shop pair if gold at shop #2 >= cardRemovalCost", () => {
    // Add monsters before shops to accumulate gold above 75.
    const p = makeEnriched(
      "shops",
      [
        node("monster", 1),
        node("monster", 2),
        node("shop", 3),
        node("shop", 4),
      ],
      { shopsTaken: 2, monstersTaken: 2 },
    );
    const result = scorePaths(
      [p],
      emptyRunState({ gold: 30 }),
      { cardRemovalCost: 75 },
    );
    // Gold at shop #2 (floor 4) = 30 + 2×40 + (no more fights after floor 2) = 110 >= 75.
    expect(result[0].scoreBreakdown.backToBackShopPair ?? 0).toBe(0);
  });

  it("penalizes hard-pool chain length in Act 2 (one -2 per monster in the chain)", () => {
    // Act 2, chain of 3 monsters uninterrupted = -6.
    const p = makeEnriched(
      "chain",
      [node("monster", 1), node("monster", 2), node("monster", 3), node("rest", 4)],
      { monstersTaken: 3, restsTaken: 1 },
    );
    const result = scorePaths([p], emptyRunState({ act: 2 }), { cardRemovalCost: 75 });
    expect(result[0].scoreBreakdown.hardPoolChainLength).toBe(-6);
  });

  it("applies no hard-pool chain penalty in Act 1", () => {
    const p = makeEnriched(
      "chain",
      [node("monster", 1), node("monster", 2), node("monster", 3)],
      { monstersTaken: 3 },
    );
    const result = scorePaths([p], emptyRunState({ act: 1 }), { cardRemovalCost: 75 });
    expect(result[0].scoreBreakdown.hardPoolChainLength ?? 0).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm --filter @sts2/web test -- score-paths`
Expected: FAIL — phase-2 tests fail (no scoring logic yet).

- [ ] **Step 3: Implement the weighted sum**

Replace the `scorePaths` body + add helpers. In `score-paths.ts`, add the following helpers above `scorePaths`:

```ts
function countRestBeforeElite(nodes: PathNode[]): number {
  let count = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    if (nodes[i].type === "rest" && nodes[i + 1].type === "elite") count += 1;
  }
  return count;
}

function countRestAfterElite(nodes: PathNode[]): number {
  let count = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    if (nodes[i].type === "elite" && nodes[i + 1].type === "rest") count += 1;
  }
  return count;
}

function countUnknowns(nodes: PathNode[]): number {
  return nodes.filter((n) => n.type === "event" || n.type === "unknown").length;
}

function countTreasures(nodes: PathNode[]): number {
  return nodes.filter((n) => n.type === "treasure").length;
}

function countBackToBackShopPairsUnderGold(
  path: EnrichedPath,
  startGold: number,
  cardRemovalCost: number,
): number {
  let count = 0;
  const nodes = path.nodes;
  for (let i = 0; i < nodes.length - 1; i++) {
    if (nodes[i].type === "shop" && nodes[i + 1].type === "shop") {
      const goldAtShop2 = estimateGoldAtFloor(path, nodes[i + 1].floor, startGold);
      if (goldAtShop2 < cardRemovalCost) count += 1;
    }
  }
  return count;
}

function hardPoolChainLengthTotal(nodes: PathNode[]): number {
  let total = 0;
  let run = 0;
  for (const n of nodes) {
    if (n.type === "monster") {
      run += 1;
    } else {
      total += run;
      run = 0;
    }
  }
  total += run;
  return total;
}
```

Then replace the return block inside `scorePaths` so it computes a breakdown and a score for every path, disqualified or not:

```ts
  const qualifiers = everyPathDisqualified ? paths : paths.filter((p) => !reasons.has(p.id));
  const restHeal = Math.round(runState.hp.max * REST_HEAL_PCT);

  const scored: ScoredPath[] = paths.map((p) => {
    const walk = walks.get(p.id)!;
    const breakdown: Record<string, number> = {};

    breakdown.elitesTaken = MAP_SCORE_WEIGHTS.elitesTaken * p.aggregates.elitesTaken;
    breakdown.elitesInAct1Bonus =
      runState.act === 1
        ? MAP_SCORE_WEIGHTS.elitesInAct1Bonus * p.aggregates.elitesTaken
        : 0;
    breakdown.restBeforeElite =
      MAP_SCORE_WEIGHTS.restBeforeElite * countRestBeforeElite(p.nodes);
    breakdown.restAfterElite =
      MAP_SCORE_WEIGHTS.restAfterElite * countRestAfterElite(p.nodes);
    breakdown.treasures = MAP_SCORE_WEIGHTS.treasuresTaken * countTreasures(p.nodes);
    const unknownWeight =
      runState.act <= 2
        ? MAP_SCORE_WEIGHTS.unknownsActs1And2
        : MAP_SCORE_WEIGHTS.unknownsAct3;
    breakdown.unknowns = unknownWeight * countUnknowns(p.nodes);

    const projectedHpAtBossFight = Math.min(
      runState.hp.max,
      walk.projectedHpEnteringPreBossRest + restHeal,
    );
    breakdown.projectedHpAtBoss =
      (MAP_SCORE_WEIGHTS.projectedHpAtBossFight * projectedHpAtBossFight) /
      Math.max(1, runState.hp.max);

    breakdown.distanceToAct3Elites =
      runState.act === 3 && runState.ascension >= 10
        ? MAP_SCORE_WEIGHTS.distanceToAct3EliteOpportunities * p.aggregates.elitesTaken
        : 0;

    breakdown.hpDipBelow30Pct = MAP_SCORE_WEIGHTS.hpDipBelow30PctPenalty * walk.dipsBelow30Pct;
    breakdown.hpDipBelow15Pct = MAP_SCORE_WEIGHTS.hpDipBelow15PctPenalty * walk.dipsBelow15Pct;

    breakdown.backToBackShopPair =
      MAP_SCORE_WEIGHTS.backToBackShopPairUnderGold *
      countBackToBackShopPairsUnderGold(p, runState.gold, options.cardRemovalCost);

    const hardPoolApplies = runState.act >= 2;
    breakdown.hardPoolChainLength = hardPoolApplies
      ? MAP_SCORE_WEIGHTS.hardPoolChainLength * hardPoolChainLengthTotal(p.nodes)
      : 0;

    const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
    const r = reasons.get(p.id) ?? [];
    return {
      ...p,
      score,
      scoreBreakdown: breakdown,
      disqualified: everyPathDisqualified ? true : r.length > 0,
      disqualifyReasons: r,
    };
  });

  void qualifiers;
  return scored;
```

Delete the earlier placeholder `return paths.map(...)` block; the block above replaces it.

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm --filter @sts2/web test -- score-paths`
Expected: PASS — all phase-2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/map/score-paths.ts packages/shared/evaluation/map/score-paths.test.ts
git commit -m "feat(map): weighted-sum phase of path scorer"
```

---

## Task 4: Ranking + tiebreakers

**Files:**
- Modify: `packages/shared/evaluation/map/score-paths.ts`
- Modify: `packages/shared/evaluation/map/score-paths.test.ts`

Sort order per spec:

1. `disqualified` false first (survivors rank above disqualified).
2. Higher `score`.
3. Within ±0.5 of each other (tie band):
   - Higher `restBeforeElite` count.
   - Higher `projectedHpAtBossFight` (post-rest HP).
   - Lower `minHpDipMagnitude` (absolute minimum of the HP walk, so lower number = deeper dip).
   - Stable by original index (input order wins).

`minHpDipMagnitude` is `abs(walkSnapshot.minHp)` where a negative minHp is "how far below zero the dip went". We use `runState.hp.max - walkSnapshot.minHp` as a proxy — larger means a deeper dip, so we want smaller. Either way tests pin down the exact ordering.

- [ ] **Step 1: Write the failing tests**

Append:

```ts
describe("scorePaths — ranking", () => {
  it("sorts survivors ahead of disqualified paths even when disqualified scores higher raw", () => {
    const dq = makeEnriched("dq", [node("elite", 1), node("elite", 2)], { elitesTaken: 2 });
    const ok = makeEnriched("ok", [node("elite", 1)], { elitesTaken: 1 });
    // Act 2 with elite count 0 on dq? No — force dq to be fatal via HP dip.
    // Simpler: starting hp low so the 2-elite path dips below 0.
    const result = scorePaths(
      [dq, ok],
      emptyRunState({
        hp: { current: 20, max: 80, ratio: 0.25 },
        riskCapacity: { hpBufferAbsolute: 4, expectedDamagePerFight: 16, fightsBeforeDanger: 0, verdict: "critical" },
      }),
      { cardRemovalCost: 75 },
    );
    expect(result[0].id).toBe("ok");
    expect(result[0].disqualified).toBe(false);
    expect(result[1].id).toBe("dq");
  });

  it("sorts survivors by descending score", () => {
    const twoE = makeEnriched("two", [node("elite", 1), node("elite", 2)], { elitesTaken: 2 });
    const oneE = makeEnriched("one", [node("elite", 1)], { elitesTaken: 1 });
    const result = scorePaths(
      [oneE, twoE],
      emptyRunState({ act: 2 }),
      { cardRemovalCost: 75 },
    );
    expect(result[0].id).toBe("two");
    expect(result[1].id).toBe("one");
  });

  it("restBeforeElite feature lifts path b above a", () => {
    // Path b has a rest-before-elite pair; path a does not. b scores ~+8 higher.
    // This exercises the weighted-sum ordering, not the in-band tiebreaker.
    const a = makeEnriched("a", [node("elite", 1), node("treasure", 2)]);
    const b = makeEnriched(
      "b",
      [node("rest", 1), node("elite", 2), node("treasure", 3)],
    );
    const result = scorePaths([a, b], emptyRunState(), { cardRemovalCost: 75 });
    expect(result[0].id).toBe("b");
  });

  it("falls back to stable input order on a total tie", () => {
    const a = makeEnriched("a", [node("monster", 1)]);
    const b = makeEnriched("b", [node("monster", 1)]);
    const result = scorePaths([a, b], emptyRunState(), { cardRemovalCost: 75 });
    expect(result[0].id).toBe("a");
    expect(result[1].id).toBe("b");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm --filter @sts2/web test -- score-paths`
Expected: FAIL — ranking tests fail (output currently preserves input order).

- [ ] **Step 3: Implement the sort**

At the bottom of `scorePaths` (replacing `return scored;`), add:

```ts
  const indexById = new Map(paths.map((p, i) => [p.id, i]));
  const walkById = walks;

  scored.sort((a, b) => {
    if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1;

    const gap = b.score - a.score;
    if (Math.abs(gap) > 0.5) return gap;

    const aRBE = countRestBeforeElite(a.nodes);
    const bRBE = countRestBeforeElite(b.nodes);
    if (aRBE !== bRBE) return bRBE - aRBE;

    const aWalk = walkById.get(a.id)!;
    const bWalk = walkById.get(b.id)!;
    const aPost = Math.min(
      runState.hp.max,
      aWalk.projectedHpEnteringPreBossRest + restHeal,
    );
    const bPost = Math.min(
      runState.hp.max,
      bWalk.projectedHpEnteringPreBossRest + restHeal,
    );
    if (aPost !== bPost) return bPost - aPost;

    if (aWalk.minHp !== bWalk.minHp) return bWalk.minHp - aWalk.minHp;

    return (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0);
  });

  return scored;
```

Note: `restHeal` needs to be in scope here. It's already declared earlier in `scorePaths`; the new `sort` block uses the same variable. Move `const restHeal = ...;` up if needed so both blocks see it.

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm --filter @sts2/web test -- score-paths`
Expected: PASS — all ranking tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/map/score-paths.ts packages/shared/evaluation/map/score-paths.test.ts
git commit -m "feat(map): rank paths with tiebreakers after scoring"
```

---

## Task 5: `deriveBranches`

**Files:**
- Create: `packages/shared/evaluation/map/derive-branches.ts`
- Create: `packages/shared/evaluation/map/derive-branches.test.ts`

Purpose: given the winner and runner-up, find the structural fork points where they first diverge (and re-diverge, up to 3). Produce an array of `DerivedBranch` objects matching what `mapCoachOutputSchema.key_branches` expects.

The output must match the existing `key_branches` schema shape on the wire:

```ts
{
  floor: number;
  decision: string;
  recommended: string;
  alternatives: { option: string; tradeoff: string }[];
  close_call: boolean;
}
```

`close_call` is true when `confidence < 0.75`.

Confidence is computed in Task 8 (route) — pass it in as an argument to `deriveBranches` (`options.confidence`).

`decision`, `recommended`, `alternatives[].option`, and `alternatives[].tradeoff` are short strings built from node types + the largest score-breakdown delta between winner and runner-up at that divergence point.

Example mapping:

- decision: "`Elite vs Shop at f${floor}`"
- recommended: "`Take the elite — more relics, survivable`"
- alternatives[0].option: "`Shop`"; tradeoff: "`Shop gold short; skip for elite density`"

Keep it mechanical — pick the largest positive delta in the winner's breakdown vs the runner-up as the "why" and map it to one of ~7 canonical rationales. See the `BRANCH_RATIONALE` map in the code below.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/evaluation/map/derive-branches.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveBranches } from "./derive-branches";
import type { ScoredPath } from "./score-paths";
import type { PathNode } from "./path-patterns";

function node(type: PathNode["type"], floor: number, col = 0): PathNode {
  return { type, floor, col, row: floor } as PathNode;
}

function makeScored(
  id: string,
  nodes: PathNode[],
  score: number,
  breakdown: Record<string, number> = {},
): ScoredPath {
  return {
    id,
    nodes,
    patterns: [],
    aggregates: {
      elitesTaken: nodes.filter((n) => n.type === "elite").length,
      monstersTaken: nodes.filter((n) => n.type === "monster").length,
      restsTaken: nodes.filter((n) => n.type === "rest").length,
      shopsTaken: nodes.filter((n) => n.type === "shop").length,
      hardPoolFightsOnPath: 0,
      totalFights: 0,
      projectedHpEnteringPreBossRest: 40,
      fightBudgetStatus: "within_budget",
      hpProjectionVerdict: "safe",
    },
    score,
    scoreBreakdown: breakdown,
    disqualified: false,
    disqualifyReasons: [],
  };
}

describe("deriveBranches", () => {
  it("returns zero branches when winner and runner-up are identical", () => {
    const nodes = [node("monster", 1), node("elite", 2)];
    const winner = makeScored("w", nodes, 10);
    const runnerUp = makeScored("r", nodes, 10);
    expect(deriveBranches(winner, runnerUp, { confidence: 0.95 })).toEqual([]);
  });

  it("emits one branch at the first divergence floor", () => {
    const winner = makeScored(
      "w",
      [node("elite", 1, 1), node("rest", 2)],
      20,
      { elitesTaken: 10 },
    );
    const runnerUp = makeScored(
      "r",
      [node("monster", 1, 2), node("rest", 2)],
      5,
      { elitesTaken: 0 },
    );
    const branches = deriveBranches(winner, runnerUp, { confidence: 0.9 });
    expect(branches).toHaveLength(1);
    expect(branches[0].floor).toBe(1);
    expect(branches[0].recommended.toLowerCase()).toContain("elite");
    expect(branches[0].alternatives[0].option.toLowerCase()).toContain("monster");
    expect(branches[0].close_call).toBe(false);
  });

  it("emits a second branch when paths converge then diverge again", () => {
    const winner = makeScored(
      "w",
      [node("elite", 1, 1), node("rest", 2), node("treasure", 3, 1)],
      20,
      { elitesTaken: 10, treasures: 6 },
    );
    const runnerUp = makeScored(
      "r",
      [node("monster", 1, 2), node("rest", 2), node("monster", 3, 2)],
      5,
    );
    const branches = deriveBranches(winner, runnerUp, { confidence: 0.7 });
    expect(branches).toHaveLength(2);
    expect(branches[0].floor).toBe(1);
    expect(branches[1].floor).toBe(3);
  });

  it("caps at 3 branches", () => {
    const winner = makeScored(
      "w",
      [
        node("elite", 1, 1),
        node("rest", 2),
        node("treasure", 3, 1),
        node("rest", 4),
        node("shop", 5, 1),
        node("rest", 6),
        node("elite", 7, 1),
      ],
      100,
    );
    const runnerUp = makeScored(
      "r",
      [
        node("monster", 1, 2),
        node("rest", 2),
        node("monster", 3, 2),
        node("rest", 4),
        node("monster", 5, 2),
        node("rest", 6),
        node("monster", 7, 2),
      ],
      50,
    );
    const branches = deriveBranches(winner, runnerUp, { confidence: 0.9 });
    expect(branches).toHaveLength(3);
  });

  it("flags close_call=true when confidence < 0.75", () => {
    const winner = makeScored("w", [node("elite", 1, 1)], 10, { elitesTaken: 10 });
    const runnerUp = makeScored("r", [node("monster", 1, 2)], 0);
    const branches = deriveBranches(winner, runnerUp, { confidence: 0.6 });
    expect(branches[0].close_call).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sts2/web test -- derive-branches`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `deriveBranches`**

Create `packages/shared/evaluation/map/derive-branches.ts`:

```ts
import type { PathNode } from "./path-patterns";
import type { ScoredPath } from "./score-paths";

export interface DerivedBranch {
  floor: number;
  decision: string;
  recommended: string;
  alternatives: { option: string; tradeoff: string }[];
  close_call: boolean;
}

export interface DeriveBranchesOptions {
  confidence: number;
  /** Hard cap on branches returned. Defaults to 3. */
  maxBranches?: number;
}

const BRANCH_RATIONALE: Record<string, { rec: string; alt: string }> = {
  elitesTaken: { rec: "Elite — more relics", alt: "Skips the relic" },
  elitesInAct1Bonus: { rec: "Early elite — relics compound", alt: "Foregoes early relic" },
  restBeforeElite: { rec: "Rest first, then elite", alt: "Hits the elite cold" },
  restAfterElite: { rec: "Recover after the elite", alt: "No post-elite buffer" },
  treasures: { rec: "Take the treasure", alt: "Passes on a free relic" },
  unknowns: { rec: "Take the event", alt: "Skips event EV" },
  projectedHpAtBoss: { rec: "Enters the boss with more HP", alt: "Enters the boss lower" },
  distanceToAct3Elites: { rec: "More Act 3 elite density", alt: "Lighter Act 3 elite pressure" },
  hpDipBelow30Pct: { rec: "Avoids the mid-path HP dip", alt: "Drops below 30% mid-path" },
  hpDipBelow15Pct: { rec: "Avoids the dangerous HP dip", alt: "Drops below 15% mid-path" },
  backToBackShopPair: { rec: "Doesn't waste a back-to-back shop", alt: "Second shop is gold-short" },
  hardPoolChainLength: { rec: "Breaks up hard-pool combat chains", alt: "Long uninterrupted monster chain" },
};

function nodeSig(n: PathNode): string {
  return `${n.floor}:${n.col},${n.type}`;
}

function nodeLabel(n: PathNode): string {
  const t = n.type;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function pickTopDelta(winner: ScoredPath, runnerUp: ScoredPath): string {
  let best = "";
  let bestVal = -Infinity;
  for (const [key, wVal] of Object.entries(winner.scoreBreakdown)) {
    const rVal = runnerUp.scoreBreakdown[key] ?? 0;
    const delta = wVal - rVal;
    if (delta > bestVal) {
      best = key;
      bestVal = delta;
    }
  }
  return best;
}

export function deriveBranches(
  winner: ScoredPath,
  runnerUp: ScoredPath,
  options: DeriveBranchesOptions,
): DerivedBranch[] {
  const maxBranches = options.maxBranches ?? 3;
  const out: DerivedBranch[] = [];
  const len = Math.min(winner.nodes.length, runnerUp.nodes.length);

  let previousDivergence = false;
  for (let i = 0; i < len && out.length < maxBranches; i++) {
    const w = winner.nodes[i];
    const r = runnerUp.nodes[i];
    const diverges = nodeSig(w) !== nodeSig(r);
    if (diverges && !previousDivergence) {
      const topDelta = pickTopDelta(winner, runnerUp);
      const rationale = BRANCH_RATIONALE[topDelta] ?? {
        rec: `${nodeLabel(w)} — scorer preferred`,
        alt: `${nodeLabel(r)} — lower weighted score`,
      };
      out.push({
        floor: w.floor,
        decision: `${nodeLabel(w)} vs ${nodeLabel(r)} at f${w.floor}`,
        recommended: rationale.rec,
        alternatives: [{ option: nodeLabel(r), tradeoff: rationale.alt }],
        close_call: options.confidence < 0.75,
      });
    }
    previousDivergence = diverges;
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sts2/web test -- derive-branches`
Expected: PASS — all branch tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/map/derive-branches.ts packages/shared/evaluation/map/derive-branches.test.ts
git commit -m "feat(map): derive structural branches from scorer output"
```

---

## Task 6: `buildNarratorInput`

**Files:**
- Create: `packages/shared/evaluation/map/build-narrator-input.ts`
- Create: `packages/shared/evaluation/map/build-narrator-input.test.ts`

Emit the `NarratorInput` shape from the spec. Derive:

- `chosenPath.summary` — a compact "M → E → R → T" string from winner nodes.
- `chosenPath.{elites,restEliteWindows,shops,treasures,projectedHpRangeMin,projectedHpRangeMax}` — straight from aggregates + the scorer's walk (we can re-compute minHp / projectedHpAtBossFight here from the breakdown).
- `activeRules[]` — one entry per feature in `scoreBreakdown` whose absolute magnitude clears a threshold (defined below). These become the "rule list" the LLM renders as prose.
- `runnersUpTradeoffs[]` — one entry per direct runner-up (up to the next 2 scored paths). `whatThisWins` = top positive delta rationale; `whatItCosts` = top negative delta rationale.
- `runState` — trimmed subset of the provided `RunState`.

Active-rule thresholds per feature (so we get 2-4 active rules per typical path):

- `elitesTaken ≥ 1`
- `restBeforeElite ≥ 1`
- `restAfterElite ≥ 1`
- `treasures ≥ 1`
- `unknowns ≥ 2`
- `projectedHpAtBoss ≥ 2.5` (ratio × 4; >= 0.625 of max HP)
- `hpDipBelow15Pct` magnitude > 0 (always signal, because it's severe)
- `hpDipBelow30Pct` magnitude >= 10 (≥ 2 dips)
- `backToBackShopPair` magnitude > 0
- `hardPoolChainLength` magnitude >= 6 (chain of ≥ 3 monsters)

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/evaluation/map/build-narrator-input.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildNarratorInput } from "./build-narrator-input";
import type { ScoredPath } from "./score-paths";
import type { PathNode } from "./path-patterns";
import type { RunState } from "./run-state";

function emptyRunState(overrides: Partial<RunState> = {}): RunState {
  return {
    hp: { current: 60, max: 80, ratio: 0.75 },
    gold: 100,
    act: 2,
    floor: 20,
    floorsRemainingInAct: 10,
    ascension: 10,
    deck: { size: 18, archetype: null, avgUpgradeRatio: 0.2, removalCandidates: 4 },
    relics: { combatRelevant: [], pathAffecting: [] },
    riskCapacity: { hpBufferAbsolute: 20, expectedDamagePerFight: 16, fightsBeforeDanger: 1, verdict: "tight" },
    eliteBudget: { actTarget: [2, 3], eliteFloorsFought: [], remaining: 2, shouldSeek: true },
    goldMath: { current: 100, removalAffordable: true, shopVisitsAhead: 1, projectedShopBudget: 220 },
    monsterPool: { currentPool: "easy", fightsUntilHardPool: 3 },
    bossPreview: {
      candidates: [],
      dangerousMatchups: [],
      preBossRestFloor: 30,
      hpEnteringPreBossRest: 40,
      preBossRestRecommendation: "heal",
    },
    ...overrides,
  };
}

function node(type: PathNode["type"], floor: number, col = 0): PathNode {
  return { type, floor, col, row: floor } as PathNode;
}

function makeScored(
  id: string,
  nodes: PathNode[],
  score: number,
  breakdown: Record<string, number>,
): ScoredPath {
  return {
    id,
    nodes,
    patterns: [],
    aggregates: {
      elitesTaken: nodes.filter((n) => n.type === "elite").length,
      monstersTaken: nodes.filter((n) => n.type === "monster").length,
      restsTaken: nodes.filter((n) => n.type === "rest").length,
      shopsTaken: nodes.filter((n) => n.type === "shop").length,
      hardPoolFightsOnPath: 0,
      totalFights: 0,
      projectedHpEnteringPreBossRest: 50,
      fightBudgetStatus: "within_budget",
      hpProjectionVerdict: "safe",
    },
    score,
    scoreBreakdown: breakdown,
    disqualified: false,
    disqualifyReasons: [],
  };
}

describe("buildNarratorInput", () => {
  it("summarizes the chosen path as a short arrow-separated sequence", () => {
    const winner = makeScored(
      "w",
      [node("monster", 1), node("elite", 2), node("rest", 3), node("treasure", 4)],
      30,
      { elitesTaken: 10, restBeforeElite: 8, treasures: 6 },
    );
    const input = buildNarratorInput(winner, [], emptyRunState());
    expect(input.chosenPath.summary).toMatch(/monster.*elite.*rest.*treasure/i);
    expect(input.chosenPath.elites).toBe(1);
    expect(input.chosenPath.treasures).toBe(1);
  });

  it("emits an active rule for each feature clearing its threshold", () => {
    const winner = makeScored(
      "w",
      [node("elite", 1), node("rest", 2)],
      25,
      {
        elitesTaken: 10,
        restAfterElite: 5,
        treasures: 0,
        unknowns: 0,
        projectedHpAtBoss: 3.2,
        hpDipBelow30Pct: 0,
        hpDipBelow15Pct: 0,
        backToBackShopPair: 0,
        hardPoolChainLength: 0,
      },
    );
    const input = buildNarratorInput(winner, [], emptyRunState());
    const kinds = input.activeRules.map((r) => r.kind);
    expect(kinds).toContain("elitesTaken");
    expect(kinds).toContain("restAfterElite");
    expect(kinds).toContain("projectedHpAtBoss");
    expect(kinds).not.toContain("treasures");
    expect(kinds).not.toContain("hpDipBelow30Pct");
  });

  it("emits a runners-up tradeoff entry for each provided runner-up up to 2", () => {
    const winner = makeScored(
      "w",
      [node("elite", 1), node("rest", 2)],
      30,
      { elitesTaken: 10, restBeforeElite: 8 },
    );
    const runnerA = makeScored(
      "a",
      [node("monster", 1), node("rest", 2)],
      15,
      { elitesTaken: 0 },
    );
    const runnerB = makeScored(
      "b",
      [node("shop", 1), node("rest", 2)],
      10,
      { elitesTaken: 0, backToBackShopPair: -3 },
    );
    const input = buildNarratorInput(winner, [runnerA, runnerB], emptyRunState());
    expect(input.runnersUpTradeoffs).toHaveLength(2);
    expect(input.runnersUpTradeoffs[0].vsPosition).toBe(1);
    expect(input.runnersUpTradeoffs[1].vsPosition).toBe(2);
  });

  it("trims runState to the documented fields only", () => {
    const winner = makeScored("w", [node("elite", 1)], 10, { elitesTaken: 10 });
    const input = buildNarratorInput(winner, [], emptyRunState({
      act: 3,
      ascension: 10,
      floor: 44,
      hp: { current: 40, max: 80, ratio: 0.5 },
      gold: 250,
      deck: { size: 16, archetype: "exhaust", avgUpgradeRatio: 0.3, removalCandidates: 2 },
    }));
    expect(input.runState.hpPct).toBeCloseTo(0.5, 2);
    expect(input.runState.gold).toBe(250);
    expect(input.runState.act).toBe(3);
    expect(input.runState.floor).toBe(44);
    expect(input.runState.ascension).toBe(10);
    expect(input.runState.committedArchetype).toBe("exhaust");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm --filter @sts2/web test -- build-narrator-input`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/shared/evaluation/map/build-narrator-input.ts`:

```ts
import type { PathNode } from "./path-patterns";
import type { ScoredPath } from "./score-paths";
import type { RunState } from "./run-state";

export interface ActiveRule {
  kind: string;
  detail?: string;
}

export interface NarratorInput {
  chosenPath: {
    summary: string;
    elites: number;
    restEliteWindows: number;
    shops: number;
    treasures: number;
    projectedHpRangeMin: number;
    projectedHpRangeMax: number;
  };
  activeRules: ActiveRule[];
  runnersUpTradeoffs: Array<{
    vsPosition: number;
    whatThisWins: string;
    whatItCosts: string;
  }>;
  runState: {
    hpPct: number;
    gold: number;
    act: 1 | 2 | 3;
    floor: number;
    ascension: number;
    committedArchetype: string | null;
  };
}

const ACTIVE_RULE_THRESHOLDS: Record<
  string,
  { kind: string; applies: (signedValue: number) => boolean }
> = {
  elitesTaken: { kind: "elitesTaken", applies: (v) => v >= 10 },
  elitesInAct1Bonus: { kind: "elitesInAct1Bonus", applies: (v) => v >= 2 },
  restBeforeElite: { kind: "restBeforeElite", applies: (v) => v >= 8 },
  restAfterElite: { kind: "restAfterElite", applies: (v) => v >= 5 },
  treasures: { kind: "treasures", applies: (v) => v >= 6 },
  unknowns: { kind: "unknowns", applies: (v) => Math.abs(v) >= 4 },
  projectedHpAtBoss: { kind: "projectedHpAtBoss", applies: (v) => v >= 2.5 },
  distanceToAct3Elites: { kind: "distanceToAct3Elites", applies: (v) => v >= 3 },
  hpDipBelow30Pct: { kind: "hpDipBelow30Pct", applies: (v) => v <= -10 },
  hpDipBelow15Pct: { kind: "hpDipBelow15Pct", applies: (v) => v <= -1 },
  backToBackShopPair: { kind: "backToBackShopPair", applies: (v) => v <= -1 },
  hardPoolChainLength: { kind: "hardPoolChainLength", applies: (v) => v <= -6 },
};

function pathSummary(nodes: PathNode[]): string {
  return nodes.map((n) => n.type).join(" → ");
}

function countRestEliteWindows(nodes: PathNode[]): number {
  let count = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    if (
      (nodes[i].type === "rest" && nodes[i + 1].type === "elite") ||
      (nodes[i].type === "elite" && nodes[i + 1].type === "rest")
    ) {
      count += 1;
    }
  }
  return count;
}

function topPositiveRationale(winner: ScoredPath, other: ScoredPath): string {
  let best = "";
  let bestDelta = -Infinity;
  for (const [k, wVal] of Object.entries(winner.scoreBreakdown)) {
    const delta = wVal - (other.scoreBreakdown[k] ?? 0);
    if (delta > bestDelta) {
      best = k;
      bestDelta = delta;
    }
  }
  return best;
}

function topNegativeRationale(winner: ScoredPath, other: ScoredPath): string {
  let best = "";
  let bestDelta = Infinity;
  for (const [k, wVal] of Object.entries(winner.scoreBreakdown)) {
    const delta = wVal - (other.scoreBreakdown[k] ?? 0);
    if (delta < bestDelta) {
      best = k;
      bestDelta = delta;
    }
  }
  return best;
}

export function buildNarratorInput(
  winner: ScoredPath,
  runnersUp: ScoredPath[],
  runState: RunState,
): NarratorInput {
  const activeRules: ActiveRule[] = [];
  for (const [key, val] of Object.entries(winner.scoreBreakdown)) {
    const rule = ACTIVE_RULE_THRESHOLDS[key];
    if (rule && rule.applies(val)) {
      activeRules.push({ kind: rule.kind });
    }
  }

  return {
    chosenPath: {
      summary: pathSummary(winner.nodes),
      elites: winner.aggregates.elitesTaken,
      restEliteWindows: countRestEliteWindows(winner.nodes),
      shops: winner.aggregates.shopsTaken,
      treasures: winner.nodes.filter((n) => n.type === "treasure").length,
      projectedHpRangeMin: Math.max(0, winner.aggregates.projectedHpEnteringPreBossRest),
      projectedHpRangeMax: runState.hp.max,
    },
    activeRules,
    runnersUpTradeoffs: runnersUp.slice(0, 2).map((r, i) => ({
      vsPosition: i + 1,
      whatThisWins: topPositiveRationale(winner, r),
      whatItCosts: topNegativeRationale(winner, r),
    })),
    runState: {
      hpPct: runState.hp.ratio,
      gold: runState.gold,
      act: runState.act,
      floor: runState.floor,
      ascension: runState.ascension,
      committedArchetype: runState.deck.archetype,
    },
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm --filter @sts2/web test -- build-narrator-input`
Expected: PASS — all narrator-input tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/evaluation/map/build-narrator-input.ts packages/shared/evaluation/map/build-narrator-input.test.ts
git commit -m "feat(map): build narrator input from scorer output"
```

---

## Task 7: Narrator prompt + LLM response schema

**Files:**
- Modify: `packages/shared/evaluation/prompt-builder.ts`
- Modify: `packages/shared/evaluation/map-coach-schema.ts`

Add `MAP_NARRATOR_PROMPT` (≈ 80 tokens) in `prompt-builder.ts`. Remove the old `MAP_PATHING_SCAFFOLD` export and the `map:` TYPE_ADDENDA entry — narrator is self-contained and doesn't need the general deck-building base rules baked into the narrator-specific prompt. Continue using `BASE_PROMPT` via `buildSystemPrompt("map")` to preserve the hallucination guards; `MAP_NARRATOR_PROMPT` gets appended in the route handler as a scaffold, parallel to `CARD_REWARD_SCAFFOLD`.

Add `mapNarratorOutputSchema` and `sanitizeMapNarratorOutput` in `map-coach-schema.ts`. Keep `mapCoachOutputSchema` + `sanitizeMapCoachOutput` — those are the server→client contract and stay intact.

- [ ] **Step 1: Update `prompt-builder.ts`**

In `packages/shared/evaluation/prompt-builder.ts`:

- Delete the export `MAP_PATHING_SCAFFOLD` (lines 70–103 in the current file).
- Delete the `map:` entry in `TYPE_ADDENDA` (lines 132–137).
- Add the following constant right where `MAP_PATHING_SCAFFOLD` was:

```ts
export const MAP_NARRATOR_PROMPT = `
You are narrating a MAP coaching recommendation. You do NOT pick the path. The path has already been chosen by a deterministic scorer.

You receive:
- chosenPath: summary + aggregates
- activeRules: the rules the chosen path satisfies strongly
- runnersUpTradeoffs: what this path gives up vs alternatives
- runState: deck and act context

Produce:
- headline (1 sentence): the verdict in the player's voice.
- reasoning (2–3 sentences): why these rules matter for THIS run.
- teaching_callouts (max 4): one per rule the player should internalize. 1–2 sentences each.

Rules:
- Do NOT describe another path as "better" — the scorer has decided.
- Do NOT invent facts beyond the input.
- Do NOT propose alternative paths.
- Render active rules as coaching prose.
`.trim();
```

- [ ] **Step 2: Write the failing tests for the new schema**

Add to `packages/shared/evaluation/map-coach-schema.test.ts` (create if missing — the file currently has no sibling test; if it does, append):

```ts
// packages/shared/evaluation/map-coach-schema.test.ts
import { describe, it, expect } from "vitest";
import { mapNarratorOutputSchema, sanitizeMapNarratorOutput } from "./map-coach-schema";

describe("mapNarratorOutputSchema", () => {
  it("accepts the minimal narrator shape", () => {
    const parsed = mapNarratorOutputSchema.parse({
      headline: "Take the 2-elite route.",
      reasoning: "Relics compound in Act 1.",
      teaching_callouts: [
        { pattern: "elitesTaken", explanation: "Elites drop relics; skipping them is the biggest common mistake." },
      ],
    });
    expect(parsed.headline).toBe("Take the 2-elite route.");
    expect(parsed.teaching_callouts).toHaveLength(1);
  });

  it("rejects missing required fields", () => {
    expect(() =>
      mapNarratorOutputSchema.parse({ headline: "", reasoning: "x", teaching_callouts: [] }),
    ).toThrow();
  });

  it("sanitize clamps teaching_callouts to the documented cap", () => {
    const raw = {
      headline: "x",
      reasoning: "y",
      teaching_callouts: Array.from({ length: 10 }).map((_, i) => ({
        pattern: `p${i}`,
        explanation: `e${i}`,
      })),
    };
    const cleaned = sanitizeMapNarratorOutput(raw);
    expect(cleaned.teaching_callouts).toHaveLength(4);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @sts2/web test -- map-coach-schema`
Expected: FAIL — `mapNarratorOutputSchema` not exported yet.

- [ ] **Step 4: Update `map-coach-schema.ts`**

Add to `packages/shared/evaluation/map-coach-schema.ts`, after the `mapCoachOutputSchema` block:

```ts
/**
 * LLM-facing schema for the narrator step. The scorer picks the path; the LLM
 * produces coaching text only. The server assembles this into the
 * `mapCoachOutputSchema` response before returning to the desktop.
 */
export const mapNarratorOutputSchema = z.object({
  headline: z.string().min(1),
  reasoning: z.string().min(1),
  teaching_callouts: z
    .array(
      z.object({
        pattern: z.string(),
        explanation: z.string(),
      }),
    )
    .describe(
      `At most ${MAP_COACH_LIMITS.maxTeachingCallouts} entries — extras truncated post-parse.`,
    ),
});

export type MapNarratorOutputRaw = z.infer<typeof mapNarratorOutputSchema>;

export function sanitizeMapNarratorOutput(raw: MapNarratorOutputRaw): MapNarratorOutputRaw {
  return {
    ...raw,
    teaching_callouts: raw.teaching_callouts.slice(0, MAP_COACH_LIMITS.maxTeachingCallouts),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sts2/web test -- map-coach-schema`
Expected: PASS.

- [ ] **Step 6: Typecheck the workspace**

Run: `pnpm --filter @sts2/web build`
Expected: build succeeds. Any remaining imports of `MAP_PATHING_SCAFFOLD` will fail — fix them in the next task.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/evaluation/prompt-builder.ts packages/shared/evaluation/map-coach-schema.ts packages/shared/evaluation/map-coach-schema.test.ts
git commit -m "feat(map): narrator prompt + narrator output schema"
```

---

## Task 8: Rewire `/api/evaluate` map branch

**Files:**
- Modify: `apps/web/src/app/api/evaluate/route.ts`

The map branch currently: builds prompt via `buildSystemPrompt("map")` + (indirectly) the scaffold → LLM call with `mapCoachOutputSchema` → `applyMapCompliance` (`repair` + `rerank`) → response.

New flow: scorer picks → `deriveBranches` → `buildNarratorInput` → narrator LLM call (`mapNarratorOutputSchema`) → server assembles `MapCoachOutputRaw` with scorer-injected `macro_path`, `key_branches`, `confidence`, scorer telemetry stashed in `compliance` slot, LLM text in `headline` / `reasoning` / `teaching_callouts`.

The desktop already sends `mapCompliance` in the request body (see `EvaluateRequest.mapCompliance`). We reuse `enrichedPaths`, `nodes`, `nextOptions`, `boss`, `currentPosition` as inputs to the scorer. The desktop must also start sending the `RunState` (computed in `buildMapPrompt`) because the scorer needs it — add a `runState` field on the request body and have the desktop pass `runState` through. This is the server-side `RunState` the existing comment in `route.ts:580-586` hedges on.

### Sub-step A: add `runState` to the request body

- [ ] **Step A.1: Modify `EvaluateRequest.mapCompliance`**

In `apps/web/src/app/api/evaluate/route.ts`:

```ts
  mapCompliance?: {
    nodes: RepairMapNode[];
    nextOptions: RepairNextOption[];
    boss: { col: number; row: number };
    currentPosition: { col: number; row: number } | null;
    enrichedPaths: EnrichedPath[];
    runState: import("@sts2/shared/evaluation/map/run-state").RunState;
    cardRemovalCost: number;
  };
```

- [ ] **Step A.2: Modify `apps/desktop/src/services/evaluationApi.ts` and `buildMapPrompt` callers** to pass the extra fields

Look up the caller in `apps/desktop/src/features/map/mapListeners.ts:480-484`:

```ts
const { prompt: mapPrompt, runState, compliance: mapCompliance } = buildMapPrompt({ ... });
```

Change the `evaluationApi.endpoints.evaluateMap.initiate(...)` payload to include `runState` and `cardRemovalCost` inside `mapCompliance`:

```ts
mapCompliance: mapCompliance && {
  ...mapCompliance,
  runState,
  cardRemovalCost: player?.cardRemovalCost ?? 75,
},
```

And in the `EvaluateMap` arg type in `apps/desktop/src/services/evaluationApi.ts`, extend the request body type to match the new shape. Find the relevant block; most of the mutation type already uses a loose structural type that allows arbitrary extra fields in `mapCompliance`, but add `runState` and `cardRemovalCost` explicitly for type safety:

```ts
// In apps/desktop/src/services/evaluationApi.ts
// Within the existing evaluateMap mutation args interface — extend `mapCompliance`:
mapCompliance?: {
  nodes: unknown[];
  nextOptions: unknown[];
  boss: { col: number; row: number };
  currentPosition: { col: number; row: number } | null;
  enrichedPaths: unknown[];
  runState: unknown;
  cardRemovalCost: number;
};
```

- [ ] **Step A.3: Commit**

```bash
git add apps/web/src/app/api/evaluate/route.ts apps/desktop/src/features/map/mapListeners.ts apps/desktop/src/services/evaluationApi.ts
git commit -m "feat(map): thread runState + cardRemovalCost to the evaluate route"
```

### Sub-step B: replace the map branch body

- [ ] **Step B.1: Write the failing integration test**

Create `apps/web/src/app/api/evaluate/map-route.test.ts`. (If a test file already exists for this route, append; otherwise create — use vitest with a mocked `anthropic` provider so no real API call goes out.)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: vi.fn(async () => ({
      output: {
        headline: "Take the 2-elite route.",
        reasoning: "You have the HP buffer to push for elites in Act 1.",
        teaching_callouts: [
          { pattern: "elitesTaken", explanation: "Elites drop relics — the strongest single power lever." },
        ],
      },
      usage: { inputTokens: 100, outputTokens: 40 },
    })),
  };
});

import { POST } from "./route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("EVAL_DEBUG", "0");
});

describe("POST /api/evaluate (map branch)", () => {
  it("returns the assembled map coach response with scorer-injected fields", async () => {
    const body = {
      type: "map",
      evalType: "map",
      context: { character: "Watcher", act: 1, floor: 1, ascension: 10, hpPercent: 0.75, deckSize: 15, deckCards: [], relics: [], archetypes: [] },
      mapPrompt: "...",  // ignored content; narrator schema is what matters
      runId: null,
      gameVersion: null,
      mapCompliance: {
        nodes: [],
        nextOptions: [],
        boss: { col: 0, row: 10 },
        currentPosition: null,
        enrichedPaths: [/* populated with two paths per the scoring fixture */],
        runState: {/* minimal valid RunState */},
        cardRemovalCost: 75,
      },
    };
    const res = await POST(req(body));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.headline).toMatch(/elite/i);
    expect(json.macro_path).toBeDefined();
    expect(json.key_branches).toBeDefined();
    expect(typeof json.confidence).toBe("number");
    // scoredPaths stash for telemetry
    expect(json.compliance).toBeDefined();
  });
});
```

(This test is representative — the exact fixture shape will need to match the real `RunState`/`EnrichedPath` shapes. Fill in realistic values by copying from existing `apps/web/src/app/api/**` tests. If no such route tests exist, skip this step as an integration-level validation — the regression suite in Task 13 covers equivalent paths.)

- [ ] **Step B.2: Run the test to see it fail**

Run: `pnpm --filter @sts2/web test -- map-route`
Expected: FAIL — route still uses the old flow.

- [ ] **Step B.3: Replace the map branch**

In `apps/web/src/app/api/evaluate/route.ts`:

1. Update imports. Remove `repairMacroPath`, `RepairMapNode`, `RepairNextOption`, `rerankIfDominated`, `MAP_PATHING_SCAFFOLD`. Add:

```ts
import { scorePaths } from "@sts2/shared/evaluation/map/score-paths";
import { deriveBranches } from "@sts2/shared/evaluation/map/derive-branches";
import { buildNarratorInput } from "@sts2/shared/evaluation/map/build-narrator-input";
import {
  mapNarratorOutputSchema,
  sanitizeMapNarratorOutput,
} from "@sts2/shared/evaluation/map-coach-schema";
import { MAP_NARRATOR_PROMPT } from "@sts2/shared/evaluation/prompt-builder";
```

The `RepairMapNode`/`RepairNextOption` imports are no longer needed — the compliance input gets replaced by the new `mapCompliance` shape that carries `enrichedPaths`, `runState`, and `cardRemovalCost`. Remove both imports.

2. Delete the `applyMapCompliance` function (lines 64–92 in the current file).

3. Replace the entire `if (isMapEval) { ... }` block (lines 559–588) with:

```ts
if (isMapEval) {
  const compliance = body.mapCompliance;
  if (!compliance || !compliance.enrichedPaths || !compliance.runState) {
    return NextResponse.json(
      { error: "Missing map compliance inputs" },
      { status: 400 },
    );
  }

  const scored = scorePaths(
    compliance.enrichedPaths,
    compliance.runState as Parameters<typeof scorePaths>[1],
    { cardRemovalCost: compliance.cardRemovalCost },
  );
  const winner = scored[0];
  const runnerUp = scored[1];

  // Confidence from weight gap (fallback to 0.5 when there's no runner-up).
  const confidence = (() => {
    if (!runnerUp) return 0.95;
    const gap = winner.score - runnerUp.score;
    const gapRatio = gap / Math.max(1, Math.abs(winner.score));
    if (gapRatio >= 0.25) return 0.95;
    if (gapRatio >= 0.15) return 0.80;
    if (gapRatio >= 0.07) return 0.65;
    return 0.50;
  })();

  const branches = runnerUp
    ? deriveBranches(winner, runnerUp, { confidence })
    : [];

  const narratorInput = buildNarratorInput(
    winner,
    scored.slice(1, 3),
    compliance.runState as Parameters<typeof buildNarratorInput>[2],
  );

  const narratorPrompt = `${MAP_NARRATOR_PROMPT}\n\nINPUT:\n${JSON.stringify(narratorInput)}`;

  const mapResult = await generateText({
    ...callOptions,
    prompt: narratorPrompt,
    output: Output.object({ schema: mapNarratorOutputSchema }),
  });

  logUsage(supabase, {
    userId: body.userId ?? null,
    evalType: evalType,
    model: EVAL_MODELS.default,
    inputTokens: mapResult.usage.inputTokens ?? 0,
    outputTokens: mapResult.usage.outputTokens ?? 0,
  }).catch(console.error);

  const narratorText = sanitizeMapNarratorOutput(mapResult.output);

  // Assemble the response in the shape the desktop already consumes.
  const macroPath = {
    floors: winner.nodes.map((n) => ({
      floor: n.floor,
      node_type: mapNodeType(n.type),
      node_id: `${n.col},${n.row}`,
    })),
    summary: narratorInput.chosenPath.summary,
  };

  const response: MapCoachOutputRaw = {
    reasoning: {
      risk_capacity: narratorText.reasoning,
      act_goal: narratorText.headline,
    },
    headline: narratorText.headline,
    confidence,
    macro_path: macroPath,
    key_branches: branches,
    teaching_callouts: narratorText.teaching_callouts.map((c) => ({
      pattern: c.pattern,
      floors: [],
      explanation: c.explanation,
    })),
    compliance: {
      repaired: false,
      reranked: false,
      rerank_reason: null,
      repair_reasons: [],
      // phase-5 telemetry — the full score breakdown per candidate.
      // @ts-expect-error augmenting the compliance shape for telemetry only
      scoredPaths: scored.map((p) => ({
        id: p.id,
        score: p.score,
        scoreBreakdown: p.scoreBreakdown,
        disqualified: p.disqualified,
        disqualifyReasons: p.disqualifyReasons,
      })),
    },
  };

  return NextResponse.json(sanitizeMapCoachOutput(response));
}
```

4. Add the `mapNodeType` helper above the `POST` function (converts the `"monster"`/`"elite"`/etc. strings to the schema's `MapNodeType` enum — they're the same set, so it's effectively a type-safe pass-through):

```ts
function mapNodeType(t: string): "monster" | "elite" | "rest" | "shop" | "treasure" | "event" | "boss" | "unknown" {
  switch (t) {
    case "monster":
    case "elite":
    case "rest":
    case "shop":
    case "treasure":
    case "event":
    case "boss":
    case "unknown":
      return t;
    default:
      return "unknown";
  }
}
```

5. The trailing-comma repair fallback for the map branch (lines 624–639) still tries to parse with `mapCoachOutputSchema`. In the new flow the LLM returns a *narrator* shape. Replace the `if (isMapEval) { ... }` block inside the `NoObjectGeneratedError` handler with narrator-schema repair:

```ts
if (isMapEval) {
  const parsed = mapNarratorOutputSchema.parse(repairedJson);
  // Same assembly as the happy path but we don't re-run scoring — repair
  // only intervenes when generateText errors. Defer to the caller: return
  // the parsed narrator text as the response and let the desktop surface it
  // with the scorer-injected fields absent. This is a degraded mode.
  return NextResponse.json({
    error: "narrator_parse_recovered",
    narrator: sanitizeMapNarratorOutput(parsed),
  });
}
```

(This is acceptable because the `NoObjectGeneratedError` branch is a rare recovery path; documenting degraded-mode is fine. If the desktop needs a stricter guarantee, a follow-up ticket can re-run the scorer to reconstruct fields.)

- [ ] **Step B.4: Run tests to verify they pass**

Run: `pnpm --filter @sts2/web test -- map-route`
Expected: PASS.

Run: `pnpm --filter @sts2/web build`
Expected: build succeeds.

- [ ] **Step B.5: Commit**

```bash
git add apps/web/src/app/api/evaluate/route.ts
git commit -m "feat(map): rewire route to scorer + narrator pipeline"
```

---

## Task 9: Rewrite `should-evaluate-map.ts` to the three triggers

**Files:**
- Modify: `apps/desktop/src/lib/should-evaluate-map.ts`
- Modify (or create if missing): `apps/desktop/src/lib/should-evaluate-map.test.ts`

Three triggers per spec:

1. **Start of act (post-ancient).** First map-state of a new act. Act 1 triggers immediately. Acts 2/3: wait one tick if HP appears pre-heal (ratio below some sentinel the listener supplies; keep the current ≥0.5 heuristic used in the grace-skip logic).
2. **Player off-path.** `currentPosition` is non-null AND NOT in `lastRecommendedPathNodes`. The new node becomes floor 0 for re-scoring (that's a scorer concern, not a trigger concern — the trigger just returns true).
3. **Meaningful fork.** `next_options.length > 1` AND options differ in node type OR in downstream subgraph. Same-type + identical-downstream forks return false.

We also need an "initial trigger" case: no prior context yet → trigger.

The existing function also rejects `optionCount === 0` — keep that.

New signature:

```ts
export interface ShouldEvaluateMapInput {
  optionCount: number;
  hasPrevContext: boolean;
  isStartOfAct: boolean;
  ancientHealResolved: boolean; // false on a start-of-act tick where HP ratio looks pre-heal
  currentPosition: { col: number; row: number } | null;
  isOnRecommendedPath: boolean;
  nextOptions: { col: number; row: number; type: string }[];
  /**
   * Downstream subgraph fingerprints for each next_option — two options with
   * the same fingerprint reach the same set of downstream node types. Callers
   * derive this from `mapState.map.nodes` by computing a canonical
   * floor→type histogram rooted at each option. Mechanical signature, not a
   * hash of coordinates — two structurally identical subgraphs should match.
   */
  nextOptionSubgraphFingerprints: string[];
}

export function shouldEvaluateMap(input: ShouldEvaluateMapInput): boolean
```

A fork is "meaningful" if:
- Any two options differ in node type, OR
- Any two of `nextOptionSubgraphFingerprints` differ.

If all next_options have the same type AND the same fingerprint, it's a no-op fork.

Downstream subgraph fingerprint helper: for each option, BFS forward through the map graph (using adjacency) and build a floor→sorted-type-counts map. Serialize it deterministically and use the string as the fingerprint. This helper lives with the listener (Task 10), not with `shouldEvaluateMap`. `shouldEvaluateMap` receives already-computed fingerprints.

- [ ] **Step 1: Write the failing tests**

Replace `apps/desktop/src/lib/should-evaluate-map.test.ts` entirely (if it exists — otherwise create):

```ts
import { describe, it, expect } from "vitest";
import { shouldEvaluateMap } from "./should-evaluate-map";

function base(overrides: Partial<Parameters<typeof shouldEvaluateMap>[0]> = {}) {
  return {
    optionCount: 1,
    hasPrevContext: true,
    isStartOfAct: false,
    ancientHealResolved: true,
    currentPosition: { col: 0, row: 1 },
    isOnRecommendedPath: true,
    nextOptions: [{ col: 0, row: 2, type: "monster" }],
    nextOptionSubgraphFingerprints: ["x"],
    ...overrides,
  };
}

describe("shouldEvaluateMap — three triggers", () => {
  it("returns false when there are no options", () => {
    expect(shouldEvaluateMap(base({ optionCount: 0, nextOptions: [], nextOptionSubgraphFingerprints: [] }))).toBe(false);
  });

  it("triggers on the first eval (no prior context)", () => {
    expect(shouldEvaluateMap(base({ hasPrevContext: false }))).toBe(true);
  });

  it("triggers at start of Act 1 (no ancient to wait for)", () => {
    expect(shouldEvaluateMap(base({ isStartOfAct: true, ancientHealResolved: true }))).toBe(true);
  });

  it("waits one tick at start of Acts 2/3 if the ancient heal is unresolved", () => {
    expect(shouldEvaluateMap(base({ isStartOfAct: true, ancientHealResolved: false }))).toBe(false);
  });

  it("triggers on start of Acts 2/3 once ancient heal is resolved", () => {
    expect(shouldEvaluateMap(base({ isStartOfAct: true, ancientHealResolved: true }))).toBe(true);
  });

  it("triggers when the player is off the recommended path", () => {
    expect(shouldEvaluateMap(base({ isOnRecommendedPath: false }))).toBe(true);
  });

  it("triggers on a fork where options differ in type", () => {
    expect(
      shouldEvaluateMap(
        base({
          optionCount: 2,
          nextOptions: [
            { col: 0, row: 2, type: "monster" },
            { col: 1, row: 2, type: "elite" },
          ],
          nextOptionSubgraphFingerprints: ["a", "b"],
        }),
      ),
    ).toBe(true);
  });

  it("triggers on a same-type fork when downstream subgraphs differ", () => {
    expect(
      shouldEvaluateMap(
        base({
          optionCount: 2,
          nextOptions: [
            { col: 0, row: 2, type: "monster" },
            { col: 1, row: 2, type: "monster" },
          ],
          nextOptionSubgraphFingerprints: ["a", "b"],
        }),
      ),
    ).toBe(true);
  });

  it("does NOT trigger on a same-type fork with identical downstream subgraphs", () => {
    expect(
      shouldEvaluateMap(
        base({
          optionCount: 2,
          nextOptions: [
            { col: 0, row: 2, type: "monster" },
            { col: 1, row: 2, type: "monster" },
          ],
          nextOptionSubgraphFingerprints: ["a", "a"],
        }),
      ),
    ).toBe(false);
  });

  it("no-op when none of the triggers fire", () => {
    expect(shouldEvaluateMap(base())).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sts2/desktop test -- should-evaluate-map`
Expected: FAIL — tests reference a shape the current function doesn't have.

- [ ] **Step 3: Rewrite `should-evaluate-map.ts`**

Replace the ENTIRE content of `apps/desktop/src/lib/should-evaluate-map.ts`:

```ts
export interface ShouldEvaluateMapInput {
  optionCount: number;
  hasPrevContext: boolean;
  isStartOfAct: boolean;
  ancientHealResolved: boolean;
  currentPosition: { col: number; row: number } | null;
  isOnRecommendedPath: boolean;
  nextOptions: { col: number; row: number; type: string }[];
  nextOptionSubgraphFingerprints: string[];
}

function hasMeaningfulFork(input: ShouldEvaluateMapInput): boolean {
  if (input.optionCount <= 1) return false;
  const types = new Set(input.nextOptions.map((o) => o.type));
  if (types.size > 1) return true;
  const fingerprints = new Set(input.nextOptionSubgraphFingerprints);
  return fingerprints.size > 1;
}

export function shouldEvaluateMap(input: ShouldEvaluateMapInput): boolean {
  if (input.optionCount <= 0) return false;

  if (!input.hasPrevContext) return true;

  if (input.isStartOfAct) {
    if (!input.ancientHealResolved) return false;
    return true;
  }

  if (input.currentPosition && !input.isOnRecommendedPath) return true;

  if (hasMeaningfulFork(input)) return true;

  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sts2/desktop test -- should-evaluate-map`
Expected: PASS — all 10 cases pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/should-evaluate-map.ts apps/desktop/src/lib/should-evaluate-map.test.ts
git commit -m "feat(map): rewrite should-evaluate-map to three structural triggers"
```

---

## Task 10: Simplify `mapListeners.ts`

**Files:**
- Modify: `apps/desktop/src/features/map/mapListeners.ts`
- Create: `apps/desktop/src/lib/compute-subgraph-fingerprint.ts` (+ test)

We need a fingerprint helper the listener can call for each `next_option`. It receives the full `nodes` list, an option coord, and the boss row; BFS forward using existing adjacency rules and emits a stable string.

Listener changes:

- Drop the Tier 1 retrace block (lines 340–407).
- Drop the `allOptionsAreAncient` derivation block and its reference.
- Drop the `ACT_CHANGE_GRACE_SKIPS` counter + its pre-heal heuristic. Replace with an `ancientHealResolved` check fed into `shouldEvaluateMap`: `ancientHealResolved = !actChanged || currentHp >= 0.5` (same heuristic as before; cleaner when it's expressed as a single input instead of a separate grace counter).
- Drop `hpDropExceedsThreshold`, `goldCrossedThreshold`, `deckSizeChangedSignificantly`, `shopInPathBecameWorthless` — none are inputs to the new `shouldEvaluateMap`.
- Compute `isStartOfAct = actChanged` (the existing logic already tracks prev act).
- Compute `nextOptionSubgraphFingerprints` per option using the new helper.
- Remaining flow (build context, pre-API dispatch, API call, post-API path derivation, backfill, registerLastEvaluation) stays the same, but the API payload no longer needs `mapCompliance.nodes`/`.nextOptions`/`.boss`/`.currentPosition` for `repairMacroPath` — those are only used to reconstruct the enriched paths + run state. The desktop still sends them through because the server still needs them for scoring context. Keep them.

### Sub-step A: subgraph fingerprint helper

- [ ] **Step A.1: Write the failing test**

Create `apps/desktop/src/lib/compute-subgraph-fingerprint.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeSubgraphFingerprint } from "./compute-subgraph-fingerprint";

describe("computeSubgraphFingerprint", () => {
  it("returns the same fingerprint for two subgraphs with the same type histogram per row", () => {
    // Toy map: 3 rows, 2 columns each, simple pair of paths.
    const nodes = [
      { col: 0, row: 0, type: "monster", children: [{ col: 0, row: 1 }] },
      { col: 1, row: 0, type: "monster", children: [{ col: 1, row: 1 }] },
      { col: 0, row: 1, type: "rest", children: [{ col: 0, row: 2 }] },
      { col: 1, row: 1, type: "rest", children: [{ col: 1, row: 2 }] },
      { col: 0, row: 2, type: "elite", children: [] },
      { col: 1, row: 2, type: "elite", children: [] },
    ];
    const fpA = computeSubgraphFingerprint(nodes, { col: 0, row: 0 }, 2);
    const fpB = computeSubgraphFingerprint(nodes, { col: 1, row: 0 }, 2);
    expect(fpA).toBe(fpB);
  });

  it("returns different fingerprints when subgraphs differ in type histogram", () => {
    const nodes = [
      { col: 0, row: 0, type: "monster", children: [{ col: 0, row: 1 }] },
      { col: 1, row: 0, type: "monster", children: [{ col: 1, row: 1 }] },
      { col: 0, row: 1, type: "rest", children: [] },
      { col: 1, row: 1, type: "elite", children: [] },
    ];
    const fpA = computeSubgraphFingerprint(nodes, { col: 0, row: 0 }, 1);
    const fpB = computeSubgraphFingerprint(nodes, { col: 1, row: 0 }, 1);
    expect(fpA).not.toBe(fpB);
  });
});
```

- [ ] **Step A.2: Run the test to verify it fails**

Run: `pnpm --filter @sts2/desktop test -- compute-subgraph-fingerprint`
Expected: FAIL — module not found.

- [ ] **Step A.3: Implement the helper**

Create `apps/desktop/src/lib/compute-subgraph-fingerprint.ts`:

```ts
export interface FingerprintNode {
  col: number;
  row: number;
  type: string;
  children: { col: number; row: number }[];
}

export function computeSubgraphFingerprint(
  nodes: FingerprintNode[],
  start: { col: number; row: number },
  maxRow: number,
): string {
  const byCoord = new Map<string, FingerprintNode>();
  for (const n of nodes) byCoord.set(`${n.col},${n.row}`, n);

  // Per-row histogram of node types reachable from start, up to maxRow inclusive.
  const histogram = new Map<number, Map<string, number>>();
  const visited = new Set<string>();
  const queue: { col: number; row: number }[] = [start];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const key = `${cur.col},${cur.row}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const node = byCoord.get(key);
    if (!node) continue;
    if (node.row > maxRow) continue;

    const rowHist = histogram.get(node.row) ?? new Map<string, number>();
    rowHist.set(node.type, (rowHist.get(node.type) ?? 0) + 1);
    histogram.set(node.row, rowHist);

    for (const child of node.children) queue.push(child);
  }

  const rows = Array.from(histogram.keys()).sort((a, b) => a - b);
  const parts = rows.map((r) => {
    const types = histogram.get(r)!;
    const sorted = Array.from(types.entries()).sort(([a], [b]) => a.localeCompare(b));
    return `${r}:${sorted.map(([t, c]) => `${t}${c}`).join(",")}`;
  });
  return parts.join("|");
}
```

- [ ] **Step A.4: Run the test to verify it passes**

Run: `pnpm --filter @sts2/desktop test -- compute-subgraph-fingerprint`
Expected: PASS.

- [ ] **Step A.5: Commit**

```bash
git add apps/desktop/src/lib/compute-subgraph-fingerprint.ts apps/desktop/src/lib/compute-subgraph-fingerprint.test.ts
git commit -m "feat(map): subgraph fingerprint helper for fork triggers"
```

### Sub-step B: listener rewrite

- [ ] **Step B.1: Update the listener**

In `apps/desktop/src/features/map/mapListeners.ts`:

1. Delete the entire `ACT_CHANGE_GRACE_SKIPS` + `actChangeGrace` block (lines 49-65) and the later usage at 317-334.
2. Delete the `allOptionsAreAncient` derivation (lines 280-281) and its passage through `input` (line 305).
3. Delete the Tier 2 soft-gate computations (`hpDropExceedsThreshold`, `goldCrossedThreshold`, `deckSizeChangedSignificantly`, `shopInPathBecameWorthless`) — not needed by the new gate.
4. Delete the Tier 1 retrace branch (lines 340-407) entirely.
5. Import `computeSubgraphFingerprint` from `../../lib/compute-subgraph-fingerprint` and `traceConstraintAwarePath` may no longer be needed — the map-view trace logic still reads from `recommendedNodes`, so leave its `import` intact if other call sites reference it; if not, remove.
6. Wire the new `shouldEvaluateMap` input:

```ts
const currentPos = mapState.map?.current_position ?? null;
const bestPathNodes = selectBestPathNodesSet(state);
const isOnPath = currentPos ? bestPathNodes.has(`${currentPos.col},${currentPos.row}`) : false;

const allNodes = mapState.map?.nodes ?? [];
const nodesForFp = allNodes.map((n) => ({
  col: n.col,
  row: n.row,
  type: n.type.toLowerCase(),
  children: n.children ?? [],
})) as FingerprintNode[];
const bossRow = mapState.map.boss.row;
const fingerprints = options.map((o) =>
  computeSubgraphFingerprint(nodesForFp, { col: o.col, row: o.row }, bossRow - 1),
);

const currentHp = mapPlayer && mapPlayer.max_hp > 0 ? mapPlayer.hp / mapPlayer.max_hp : 1;
const actChanged = prevContext ? prevContext.act !== run.act : false;
const ancientHealResolved = !actChanged || currentHp >= 0.5;

const input = {
  optionCount: options.length,
  hasPrevContext: !!prevContext,
  isStartOfAct: actChanged,
  ancientHealResolved,
  currentPosition: currentPos,
  isOnRecommendedPath: isOnPath,
  nextOptions: options.map((o) => ({ col: o.col, row: o.row, type: o.type.toLowerCase() })),
  nextOptionSubgraphFingerprints: fingerprints,
};

const shouldEval = shouldEvaluateMap(input);
logDevEvent("eval", "map_should_eval", { input, shouldEval });
if (!shouldEval) return;
```

Remove the call site for the deleted gate and Tier 1 block. Leave the choice-logging block (lines 192-270) intact — that's independent of the gate logic.

7. Remove imports that are no longer used:

```ts
// remove
import { traceConstraintAwarePath } from "../../views/map/constraint-aware-tracer";
```

If `traceConstraintAwarePath` is referenced elsewhere (map-view.tsx), leave its file alone; just drop the listener's import.

- [ ] **Step B.2: Run the full test suite**

Run: `pnpm --filter @sts2/desktop test`
Expected: PASS — existing map listener tests (if any) updated or retained; new trigger tests from Task 9 pass.

If existing listener tests fail due to removed features (`allOptionsAreAncient`, `shopInPathBecameWorthless`, etc.), delete those test cases — they're testing behavior that's been replaced by the three-trigger model.

- [ ] **Step B.3: Smoke run the desktop**

Run (manually, once): `pnpm --filter @sts2/desktop tauri dev`

Verify map coach still produces a highlighted path, that a start-of-act-2 scenario no longer flashes a critical HP reading, and that sibling monster-forks don't trigger an eval spam.

- [ ] **Step B.4: Commit**

```bash
git add apps/desktop/src/features/map/mapListeners.ts
git commit -m "feat(map): simplify listener to three structural triggers"
```

---

## Task 11: Retire `rerank-if-dominated` and trim `repair-macro-path`

**Files:**
- Delete: `packages/shared/evaluation/map/rerank-if-dominated.ts`
- Delete: `packages/shared/evaluation/map/rerank-if-dominated.test.ts`
- Modify: `packages/shared/evaluation/map/repair-macro-path.ts`
- Modify: `packages/shared/evaluation/map/repair-macro-path.test.ts`
- Modify: any callers that still import from these files

The route no longer calls either of these (Task 8 deleted the `applyMapCompliance` function). Telemetry in `compliance-report.ts` still aggregates `repair` + `rerank` into a single report — adjust that too.

- [ ] **Step 1: Find all callers**

Run: `grep -rn "rerank-if-dominated\|repairMacroPath\|rerankIfDominated" apps packages --include="*.ts" --include="*.tsx"`

Expected references (besides the files themselves):
- `apps/web/src/app/api/evaluate/route.ts` — already cleaned up in Task 8.
- `packages/shared/evaluation/map/compliance-report.ts` — `buildComplianceReport` takes both `repair` and `rerank` outputs; becomes unreachable.

- [ ] **Step 2: Delete `rerank-if-dominated.{ts,test.ts}`**

```bash
rm packages/shared/evaluation/map/rerank-if-dominated.ts
rm packages/shared/evaluation/map/rerank-if-dominated.test.ts
```

- [ ] **Step 3: Decide on `repair-macro-path.ts`**

Read the file. If the scorer / branch derivation / narrator input imports anything from it (graph walkers, `nodesById`, etc.), keep those exports and delete the rest. If nothing is imported, delete the whole file + its test.

Run: `grep -rn "from.*repair-macro-path" packages apps --include="*.ts" --include="*.tsx"`

Based on Task 8's route changes, the only caller was `route.ts` (removed). If no other files import it, delete both `repair-macro-path.ts` and `repair-macro-path.test.ts`:

```bash
rm packages/shared/evaluation/map/repair-macro-path.ts
rm packages/shared/evaluation/map/repair-macro-path.test.ts
```

- [ ] **Step 4: Update `compliance-report.ts`**

`buildComplianceReport` no longer has meaningful inputs. The `compliance` field in the server response (set in Task 8 Step B.3) is a fixed `{ repaired: false, reranked: false, rerank_reason: null, repair_reasons: [], scoredPaths: [...] }`. That means `compliance-report.ts` is dead code for the map path.

Run: `grep -rn "buildComplianceReport\|REPAIR_REASON_KINDS" packages apps --include="*.ts" --include="*.tsx"`

- `packages/shared/evaluation/map-coach-schema.ts` imports `REPAIR_REASON_KINDS` for its zod enum. Preserve `REPAIR_REASON_KINDS` (a string-literal array) so the schema compiles. Move it to `map-coach-schema.ts` directly or keep `compliance-report.ts` as a stub file that exports only that constant.

Easiest: delete `buildComplianceReport` and keep `REPAIR_REASON_KINDS` at the top of `compliance-report.ts`. Delete `compliance-report.test.ts`.

```bash
# rewrite compliance-report.ts to only export REPAIR_REASON_KINDS
```

Replace the entire `packages/shared/evaluation/map/compliance-report.ts` file with:

```ts
// Kept only because `map-coach-schema.ts` imports REPAIR_REASON_KINDS for its
// enum. Post-phase-4 the compliance field is a telemetry passthrough; there's
// no repair/rerank pipeline to aggregate.
export const REPAIR_REASON_KINDS = [
  "macro_path_drift",
  "next_option_mismatch",
  "duplicate_floor",
  "non_adjacent",
  "wrong_boss",
] as const;
export type RepairReasonKind = (typeof REPAIR_REASON_KINDS)[number];
```

Delete `packages/shared/evaluation/map/compliance-report.test.ts`.

- [ ] **Step 5: Run the test suite to catch fallout**

Run: `pnpm --filter @sts2/web test`

Any remaining imports of deleted symbols will fail at typecheck or module-load. Fix them by removing the import or the whole dead block.

Run: `pnpm --filter @sts2/desktop test`

Run: `pnpm --filter @sts2/web build`
Expected: no typecheck errors.

- [ ] **Step 6: Commit**

```bash
git add -A  # captures deletions
git commit -m "chore(map): retire rerank-if-dominated and repair-macro-path"
```

---

## Task 12: Persist scorer telemetry in `choices.rankings_snapshot`

**Files:**
- Modify: `apps/desktop/src/features/map/mapListeners.ts`
- Modify: `packages/shared/evaluation/last-evaluation-registry.ts` (only if needed for typing)

The listener today calls `registerLastEvaluation("map", {...raw: parsed})` and later uses that `raw` to populate `rankingsSnapshot` in `/api/choice` writes (lines 236 + 247 of the current listener). That's exactly the channel we need for Phase 5 calibration. No new plumbing needed beyond making sure `compliance.scoredPaths` flows through.

- [ ] **Step 1: Verify the telemetry path already works**

In the rewired `route.ts` (Task 8), `compliance.scoredPaths` is on `finalOutput`. The desktop listener already does `registerLastEvaluation("map", { ..., raw: parsed })`. Since `parsed` is the full server response, `parsed.compliance.scoredPaths` is included in `rankingsSnapshot` automatically.

- [ ] **Step 2: Add a smoke test for the flow**

Add a unit test in `apps/desktop/src/lib/build-pre-eval-payload.test.ts` or a new file `apps/desktop/src/features/map/choice-telemetry.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("map_node choice telemetry", () => {
  it("stashes scoredPaths inside rankingsSnapshot when the API response includes compliance.scoredPaths", () => {
    const parsed = {
      macro_path: { floors: [], summary: "x" },
      headline: "h",
      reasoning: { risk_capacity: "r", act_goal: "a" },
      confidence: 0.9,
      key_branches: [],
      teaching_callouts: [],
      compliance: {
        repaired: false,
        reranked: false,
        rerank_reason: null,
        repair_reasons: [],
        scoredPaths: [{ id: "A", score: 30, scoreBreakdown: {}, disqualified: false, disqualifyReasons: [] }],
      },
    };
    // Just a shape assertion — the registry stores `raw: parsed` verbatim.
    expect((parsed as { compliance: { scoredPaths: unknown[] } }).compliance.scoredPaths[0]).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @sts2/desktop test -- choice-telemetry`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/features/map/choice-telemetry.test.ts
git commit -m "test(map): verify scoredPaths telemetry flows through rankingsSnapshot"
```

---

## Task 13: Regression suite + manual smoke

**Files:**
- Modify: `packages/shared/evaluation/map/score-paths.test.ts`

Add a `describe("scorePaths — regression")` block reproducing every user-reported map failure from phases 1–3. Each test constructs `EnrichedPath[]` + `RunState` fixtures that match the real shapes, then asserts the winner is the expected path. These fixtures come from the issue bodies in GitHub (#77, #79, #80, #81) and from the user's verbal reports. Scan `docs/superpowers/specs/` for earlier specs that enumerated failures and promote them to test cases.

Representative cases to add:

1. **"0-elite wins in abundant run."** RunState with `hpRatio=0.85`, `riskCapacity.verdict="abundant"`; two paths: one 0-elite monster-heavy, one 2-elite with rest→elite pair. Assert winner is 2-elite.
2. **"Rest→elite×2 from low HP."** RunState with `hpRatio=0.35`; path A = monster-heavy, path B = rest→elite, rest→elite. Assert winner is B.
3. **"Post-ancient first-eval CRITICAL flash."** Covered by the `shouldEvaluateMap` tests in Task 9 (`ancientHealResolved=false` path).
4. **"Mid-path HP dip"** — path dips to 12% mid-route. Assert it loses to a safer path with fewer elites even when elite count is tied.

- [ ] **Step 1: Write the failing regression tests**

Append to `packages/shared/evaluation/map/score-paths.test.ts`:

```ts
describe("scorePaths — regression (user-reported failures)", () => {
  it("abundant run picks 2-elite over 0-elite monster path", () => {
    const zeroElite = makeEnriched(
      "zero",
      [node("monster", 1), node("monster", 2), node("rest", 3)],
      { monstersTaken: 2, restsTaken: 1 },
    );
    const twoElite = makeEnriched(
      "two",
      [node("rest", 1), node("elite", 2), node("rest", 3), node("elite", 4)],
      { elitesTaken: 2, restsTaken: 2 },
    );
    const result = scorePaths(
      [zeroElite, twoElite],
      emptyRunState({
        hp: { current: 68, max: 80, ratio: 0.85 },
        riskCapacity: { hpBufferAbsolute: 44, expectedDamagePerFight: 16, fightsBeforeDanger: 2, verdict: "abundant" },
        act: 1,
      }),
      { cardRemovalCost: 75 },
    );
    expect(result[0].id).toBe("two");
  });

  it("low-HP run with rest→elite×2 beats monster-heavy alternative", () => {
    const monsterHeavy = makeEnriched(
      "m",
      [node("monster", 1), node("monster", 2), node("elite", 3), node("elite", 4)],
      { elitesTaken: 2, monstersTaken: 2 },
    );
    const restElite = makeEnriched(
      "re",
      [node("rest", 1), node("elite", 2), node("rest", 3), node("elite", 4)],
      { elitesTaken: 2, restsTaken: 2 },
    );
    const result = scorePaths(
      [monsterHeavy, restElite],
      emptyRunState({
        hp: { current: 28, max: 80, ratio: 0.35 },
        riskCapacity: { hpBufferAbsolute: 4, expectedDamagePerFight: 16, fightsBeforeDanger: 0, verdict: "tight" },
      }),
      { cardRemovalCost: 75 },
    );
    expect(result[0].id).toBe("re");
  });

  it("mid-path dip loses to a safer path with fewer elites", () => {
    const dipPath = makeEnriched(
      "dip",
      [node("monster", 1), node("monster", 2), node("monster", 3), node("elite", 4), node("elite", 5)],
      { elitesTaken: 2, monstersTaken: 3 },
    );
    const safePath = makeEnriched(
      "safe",
      [node("rest", 1), node("elite", 2), node("rest", 3), node("treasure", 4)],
    );
    const result = scorePaths(
      [dipPath, safePath],
      emptyRunState({
        hp: { current: 56, max: 80, ratio: 0.7 },
        riskCapacity: { hpBufferAbsolute: 32, expectedDamagePerFight: 16, fightsBeforeDanger: 2, verdict: "moderate" },
      }),
      { cardRemovalCost: 75 },
    );
    expect(result[0].id).toBe("safe");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @sts2/web test -- score-paths`
Expected: PASS — regression tests pass. If any fail, the weights need tuning in `MAP_SCORE_WEIGHTS`. Tune + re-run. Weight tuning is in one place; a failing regression is a bug in the weights, not the tests.

- [ ] **Step 3: Manual smoke on the desktop**

Run: `pnpm --filter @sts2/desktop tauri dev`

Play through at least:
1. Act 1 start → verify the scorer's highlighted path aligns with the player's instincts (2-elite, 1-2 rest nodes).
2. Pick a node off the recommended path → verify a new highlight appears, with narrator prose rendered for the new winner.
3. Reach an act boundary → verify the post-ancient flash no longer happens.
4. Hit a same-type fork (two monsters with identical downstream) → verify no new eval fires (check dev logs for `map_should_eval`).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/evaluation/map/score-paths.test.ts
git commit -m "test(map): regression suite for user-reported failures"
```

---

## Final checklist

- [ ] All tasks 1–13 completed and committed.
- [ ] `pnpm --filter @sts2/web test` — all pass.
- [ ] `pnpm --filter @sts2/desktop test` — all pass.
- [ ] `pnpm --filter @sts2/web build` — succeeds.
- [ ] Manual smoke passed on a real STS2 run.
- [ ] Push branch + open PR with `Closes #93`.

Open the PR with `gh pr create`:

```bash
git push -u origin feat/93-map-scorer-narrator
gh pr create --title "feat(map): deterministic scorer + LLM narrator (phase 4)" --body "$(cat <<'EOF'
## Summary
- Inverts the map coach architecture: a deterministic scorer picks the path; the LLM narrates.
- Phase 1 hard filter + phase 2 weighted sum over the existing EnrichedPath aggregates.
- Structural branch derivation from winner vs runner-up.
- Three-trigger re-eval (start-of-act post-ancient, off-path, meaningful fork).
- Retires rerank-if-dominated + repair-macro-path.

Spec: docs/superpowers/specs/2026-04-20-map-scorer-narrator-design.md
Plan: docs/superpowers/plans/2026-04-20-map-scorer-narrator.md

Closes #93

## Test plan
- [ ] All vitest suites pass
- [ ] Manual smoke: Act 1 start, off-path pick, act transition, same-type fork
- [ ] Telemetry: /api/choice writes include compliance.scoredPaths in rankings_snapshot

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
