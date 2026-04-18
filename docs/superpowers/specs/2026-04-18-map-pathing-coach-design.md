# Map Pathing Coach (Phase 1)

**Date:** 2026-04-18
**Status:** Approved
**Motivation:** Map pathing recommendations systematically underperform an experienced player's judgment (Ironclad, Ascension 10). The engine misses structural patterns (rest→elite→rest alignment, hard-pool monster awareness, elite-budget-vs-deck-readiness), weighs risk poorly (case b: bad weighting, not missing facts), and presents output as a verdict rather than coaching. Preparing the app for broader rollout requires the engine to teach *why*, not just point, so players become better rather than dependent.

## Non-goals

- Personalization per user (deferred to a later phase once multi-user data exists).
- Card-reward, shop, and ancient eval improvements (deferred — the enrichment + scaffold infra built here is reusable for them later).
- Outcome-weighted calibration loop (deferred — telemetry in phase 1 positions phase 2 to do it).
- Node-graph visual overhaul. All phase-1 changes are text-first; a richer visualization can come in a subsequent UI pass.

## Current State

### Evaluation pipeline

- `POST /api/evaluate` handles map evals (apps/web/src/app/api/evaluate/route.ts lines 280–592).
- Prompt assembled via `packages/shared/evaluation/prompt-builder.ts`: base system prompt + `TYPE_ADDENDA["map"]` addendum containing deterministic rules as prose (treasure priority, elite-by-act targets 1–2 / 2–3 / 0–1, rest-site heuristics, back-to-back shops).
- Contextual data injected: run history (5-min TTL), character strategy (30-min cache), community tier signals (just merged in #68, per-card priors), card win rates (aggregated), enriched card data.
- Model: `EVAL_MODELS.default` (Claude Haiku 4.5).
- Output schema `buildMapEvalSchema(optionCount)` (eval-schemas.ts): `rankings` (per-option-index), `node_preferences` (per-node-type scores), `overall_advice`.

### Choice capture (already in place)

- `POST /api/choice` writes to `choices` with `recommended_item_id`, `recommended_tier`, `was_followed`, `rankings_snapshot`, `game_context`.
- `act_paths` captures `recommended_path`, `actual_path`, `node_preferences`, `deviation_count`, `deviation_nodes`.
- Analytics views exist (`card_win_rates`, `recommendation_follow_rates`, `evaluation_stats_v2`, `eval_accuracy`).

### Known failure mode

The LLM receives adequate facts but weighs them inconsistently. Its prompt asks it to *infer* structural facts (elite budget consumed, HP buffer, monster-pool state) from raw node lists and run state every call. The enrichment layer below lifts that arithmetic into pre-computation so the model can focus on judgment.

### STS2 map invariants used by the design

- Ancient is always the starting node of each act.
- Treasure is always the halfway node, splitting the act into "early" and "late" halves.
- Pre-boss rest is always the last rest before the act boss.
- Monster easy-pool / hard-pool split: Act 1 first 3 regular fights are easy pool; Acts 2–3 first 2 regular fights are easy pool. Applies to regular monsters only, not elites.
- Elite HP/damage is fixed per elite type at a given ascension. "Early elite is easier" perception is a function of deck readiness, not the elite.
- Act 1 has two variants (Overgrowth / Underdocks) with distinct elite and boss pools. Detecting variant is a phase-1.5 stretch.

## Phase Scope

1. **Deterministic run-state enrichment layer** (new, pure TypeScript).
2. **Pattern annotations** per candidate path (new, pure TypeScript).
3. **Prompt restructure**: structured facts block + chain-of-thought reasoning scaffold, trimmed map addendum.
4. **New output schema** with `reasoning`, `macro_path`, `key_branches[]`, `teaching_callouts[]`.
5. **UI revision** of the map eval view to elevate reasoning and teaching callouts.
6. **Telemetry** adjustments so phase 2 has the structured output + run-state snapshot.
7. **Backtest harness** (manual script, not CI) for validating the change against the user's historical floors.

Ships in a single release (no feature flag) — single-user app, regressions are directly observable.

## Architecture

```
POST /api/evaluate (type: "map")
  ├── 1. run-state enrichment (NEW)
  │      computeRunState(gameState, runHistory)
  │      → HP / elite / gold / monster-pool / pre-boss-rest facts
  ├── 2. path enrichment (NEW)
  │      enrichPaths(candidatePaths, runState)
  │      → each path annotated with PathPattern[] + aggregates
  ├── 3. prompt assembly (MODIFIED)
  │      - structured facts block (run state + enriched paths)
  │      - reasoning scaffold (chain-of-thought instruction)
  │      - trimmed map addendum (drops rules now encoded as facts)
  ├── 4. LLM eval (Claude Haiku 4.5, unchanged transport)
  │      - new zod output schema: mapCoachOutput
  └── 5. response + telemetry
         - choices.rankings_snapshot now stores full mapCoachOutput
         - choices.run_state_snapshot (new jsonb column) stores RunState

Map eval UI (MODIFIED)
  - headline + confidence pill
  - "Why this path" (reasoning.risk_capacity + reasoning.act_goal) — full visibility
  - path summary
  - key decisions (BranchCard per entry)
  - "Why this is a good path" (teaching callouts) — full visibility
```

### Files

New:
- `apps/web/src/evaluation/map/run-state.ts` — `computeRunState`, `computeHpBudget`, `computeEliteBudget`, `computeGoldMath`, `computePreBossRest`, `computeMonsterPool`.
- `apps/web/src/evaluation/map/path-patterns.ts` — per-pattern detectors, each returning a `PathPattern | null`.
- `apps/web/src/evaluation/map/enrich-paths.ts` — orchestrator combining run state + per-path detectors.
- `packages/shared/evaluation/map-output-schema.ts` — zod schemas and TS types for the new output shape.
- `apps/web/src/components/map/BranchCard.tsx`, `apps/web/src/components/map/TeachingCallouts.tsx`, and updates to the component that currently renders `overall_advice`.
- `apps/web/scripts/map-coach-backtest.ts` — backtest harness.

Modified:
- `apps/web/src/app/api/evaluate/route.ts` — map branch (~lines 280–592): wire enrichment in, swap output schema, extend `choices` payload with `run_state_snapshot`.
- `packages/shared/evaluation/prompt-builder.ts` — new `MAP_PATHING_SCAFFOLD` addendum; revise `TYPE_ADDENDA["map"]` to drop rules that move into the facts block.
- DB migration adding `choices.run_state_snapshot jsonb NULL`.

## Run-state enrichment

Computed once per map eval, passed to prompt assembly.

```ts
type RunState = {
  hp: { current: number; max: number; ratio: number }
  gold: number
  act: 1 | 2 | 3
  floor: number
  floorsRemainingInAct: number
  ascension: number

  deck: {
    size: number
    archetype: string | null           // null in phase 1; LLM infers from card list
    avgUpgradeRatio: number
    removalCandidates: number          // strikes + defends + dead cards
  }

  relics: {
    combatRelevant: string[]
    pathAffecting: string[]            // maw bank, wing boots, etc.
  }

  riskCapacity: {
    hpBufferAbsolute: number
    expectedDamagePerFight: number     // lookup: ascension × archetype bucket
    fightsBeforeDanger: number
    verdict: "abundant" | "moderate" | "tight" | "critical"
  }

  eliteBudget: {
    actTarget: [min: number, max: number]   // (1,2) | (2,3) | (0,1)
    eliteFloorsFought: number[]
    remaining: number                        // max - fought
    shouldSeek: boolean                      // capacity + below target
  }

  goldMath: {
    current: number
    removalAffordable: boolean
    shopVisitsAhead: number
    projectedShopBudget: number
  }

  monsterPool: {
    currentPool: "easy" | "hard"
    fightsUntilHardPool: number              // 0 if already in hard pool
  }

  bossPreview: {
    candidates: string[]
    dangerousMatchups: string[]              // from run history loss notes
    preBossRestFloor: number                 // structural — always present
    hpEnteringPreBossRest: number            // projected
    preBossRestRecommendation: "heal" | "smith" | "close_call"
  }
}
```

### Archetype inference (phase 1 decision)

Archetype stays `null` in phase 1. The main LLM already sees the deck card list and inferring archetype from card tags deterministically adds complexity without a proven payoff. Revisit only if the prompt bloats with card listings or the model reliably miscategorizes.

### Risk capacity

`expectedDamagePerFight` is a static lookup table of (ascension × deck-size bucket), calibrated roughly from community-pool data. Not an ML model. Tuning it over time is a one-file change.

`verdict` thresholds (in units of "fights before danger"):
- `abundant` ≥ 4 | `moderate` 2–4 | `tight` 1–2 | `critical` < 1

### Pre-boss rest recommendation

Uses HP ratio entering the pre-boss rest and count of upgrade candidates on the smith. Heal when `hpRatio < 0.65` or `upgradeCandidates == 0`; smith when `hpRatio >= 0.70` and candidates exist; `close_call` otherwise.

## Pattern annotations

Per-candidate-path tags. Pure functions, pure facts, no scores.

```ts
type PathPattern =
  | { kind: "rest_before_elite"; restFloor: number; eliteFloor: number }
  | { kind: "rest_after_elite"; eliteFloor: number; restFloor: number }
  | { kind: "elite_cluster"; floors: number[] }               // 2+ elites within 3 floors
  | { kind: "back_to_back_shops"; floors: number[] }
  | { kind: "treasure_before_rest"; treasureFloor: number; restFloor: number }
  | { kind: "monster_chain_for_rewards"; floors: number[]; length: 3 | 4 }
  | { kind: "shop_before_earning"; floors: number[] }         // shop before accumulating gold
  | { kind: "no_rest_in_late_half"; elitesLate: number }
  | { kind: "smith_before_elite"; smithFloor: number; eliteFloor: number }
  | { kind: "heal_vs_smith_at_preboss"; recommendation: "heal" | "smith" | "close_call" }
  | { kind: "rest_spent_too_early"; restFloor: number; hpRatioAtRest: number }
```

Removed from consideration: `rest_before_boss` (structural invariant, not a signal), `naked_boss_approach` (impossible given the invariant).

Each pattern function:
- Takes `(path: NodePath, runState: RunState) => PathPattern | null`.
- Is colocated with a `.test.ts` covering a clear positive, clear negative, and edge case.

### Per-path aggregates

Alongside patterns, `enrichPaths` computes per-path aggregates that otherwise force the LLM to do arithmetic:
- `elitesTaken`, `restsTaken`, `shopsTaken`
- `projectedHpEnteringPreBossRest` (current HP − sum of expected damage across fights on this path)
- `hardPoolFightsOnPath`

## Prompt restructure

### Structured facts block (per request)

Injected in place of rules the LLM used to be asked to reason out:

```
=== RUN STATE ===
HP: 62/80 (77%)
Gold: 215
Act 2, Floor 23 — 10 floors to act boss (pre-boss rest at floor 33)
Ascension: 10
Deck: 19 cards, 6 upgraded, 3 removal candidates

Risk capacity: MODERATE
  HP buffer 28 | expected damage/fight ≈ 12 | ~2 fights of slack
Elite budget: Act 2 target 2–3 | fought 1 (f19) | remaining 1–2 | should-seek: yes
Gold math: removal affordable (215 ≥ 75) | 2 shops ahead | projected budget 310
Monster pool: HARD (2 fights into hard pool)
Pre-boss rest (f33): projected HP entering ≈ 40 | recommendation: HEAL

=== CANDIDATE PATHS ===
Path A: M(f23) → M → E(f25) → R → T → M → E(f29) → S → R(f32) → BOSS
  Patterns: rest_after_elite(f25→f26), elite_cluster(f25,f29)
  Aggregate: 2 elites | 2 rests | 1 shop | HP_proj_pre_boss_rest ≈ 38
Path B: ...
```

### Reasoning scaffold (new addendum)

Prepended to the map eval instruction, ~120 tokens:

```
Before ranking, reason step-by-step:

1. RISK CAPACITY: restate the buffer number and verdict in your own words.
   Is this a run that can push for elites, or needs to consolidate?
2. ACT GOAL: one sentence. What should remaining floors accomplish?
3. KEY BRANCHES: identify 1–3 floors where the decision is non-obvious.
   A close call is NOT a failure — say so explicitly.

Then produce the output. Do not restate game rules; the facts block has them.
Your job is judgment under the specific run state, not general theory.

Branch recommendations may be conditional (e.g., "Elite IF HP ≥ 55 at f28, else Monster").
```

### Map addendum trim

Removed from `TYPE_ADDENDA["map"]`:
- Elite-by-act-target numbers (moved to `runState.eliteBudget`).
- Rest-site HP threshold rules (moved to `runState.bossPreview.preBossRestRecommendation` and patterns).
- Back-to-back-shops warning (moved to `back_to_back_shops` pattern).

Retained: high-level act philosophy (Act 1 card acquisition, Act 2 peak window, Act 3 boss prep) because these are goal-shaping, not arithmetic-replacing.

## Output schema

```ts
// packages/shared/evaluation/map-output-schema.ts
const mapCoachOutput = z.object({
  reasoning: z.object({
    risk_capacity: z.string(),
    act_goal: z.string(),
  }),

  headline: z.string(),
  confidence: z.number().min(0).max(1),

  macro_path: z.object({
    floors: z.array(z.object({
      floor: z.number(),
      node_type: z.enum(["monster", "elite", "rest", "shop", "treasure", "event", "unknown"]),
      node_id: z.string(),
    })),
    summary: z.string(),
  }),

  key_branches: z.array(z.object({
    floor: z.number(),
    decision: z.string(),
    recommended: z.string(),       // may be conditional prose ("Elite IF HP ≥ 55…")
    alternatives: z.array(z.object({
      option: z.string(),
      tradeoff: z.string(),
    })),
    close_call: z.boolean(),
  })).max(3),

  teaching_callouts: z.array(z.object({
    pattern: z.string(),
    floors: z.array(z.number()),
    explanation: z.string(),
  })).max(4),
})
```

Caps prevent the LLM from padding with low-value filler.

## UI

Single eval-view revision. Coaching and reasoning get primary visibility — no truncation, no collapse.

```
┌──────────────────────────────────────────────────────────┐
│  HEADLINE                                  [conf: 0.82]  │
│  Take the f25 elite, rest into treasure, chain the hard- │
│  pool monsters for card rewards.                         │
├──────────────────────────────────────────────────────────┤
│  WHY THIS PATH                                           │
│  Risk capacity: Moderate buffer — 28 HP over danger      │
│  threshold, ~2 fights of slack. One elite absorbable,    │
│  two back-to-back is not.                                │
│                                                          │
│  Act goal: Heal to 70%+ before pre-boss rest. Second     │
│  elite only if HP recovery aligns.                       │
├──────────────────────────────────────────────────────────┤
│  PATH                                                    │
│  M → M → Elite(f25) → Rest → Treasure → M → Elite(f29)   │
│  → Shop → Rest → Boss                                    │
├──────────────────────────────────────────────────────────┤
│  KEY DECISIONS                                           │
│  ┌ Floor 25 — Elite or Monster? ───────────────────────┐ │
│  │ Recommend: Elite                                    │ │
│  │ ▸ Monster: safer, lose relic + elite card reward    │ │
│  │ ▸ Elite: take the relic, f26 rest absorbs cost      │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌ Floor 29 — Close call (2nd elite?) [amber dashed] ─┐ │
│  │ Recommend: Elite IF HP ≥ 55 at f28, else Monster    │ │
│  └─────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────┤
│  WHY THIS IS A GOOD PATH                                 │
│  💡 Rest after elite — heals the elite cost before the   │
│     treasure, entering late half at full HP              │
│  💡 Hard monster pool — past easy-pool, expect 15+ HP    │
│     per fight now                                        │
└──────────────────────────────────────────────────────────┘
```

- **`BranchCard`** — renders one entry of `key_branches[]`. `close_call: true` gets an amber dashed border.
- **`TeachingCallouts`** — renders `teaching_callouts[]`. Hidden entirely when the array is empty (no empty-state noise).
- **No node-graph changes** in phase 1. Branches are referenced by floor number in text.

Phase 1 is a stepping stone; a full UI overhaul is a later project. The data shape is structured for that to be a pure re-skin.

## Testing

### Unit (vitest, colocated)

- `run-state.test.ts` — one fixture per computation (HP buffer, elite budget by act/ascension, gold math, monster-pool transition, pre-boss rest recommendation thresholds). Pure functions, no mocks.
- `path-patterns.test.ts` — positive / negative / edge for each pattern.
- `enrich-paths.test.ts` — orchestrator shape test (a realistic input, assert output shape, not values).

### Schema / prompt

- `map-output-schema.test.ts` — zod round-trip on a valid example; reject on invalid (e.g., 4 branches).
- Opt-in prompt snapshot test (not CI) — renders full prompt from a canned `RunState` + paths; catches accidental prompt drift.

### Backtest harness (script, not CI)

`apps/web/scripts/map-coach-backtest.ts`:
- Pulls historical map-type rows from `choices` joined with `runs` and `act_paths`.
- Reconstructs game state from `rankings_snapshot` + `game_context`.
- Runs enrichment + new eval.
- Buckets each floor into: `v2_agrees_with_user` | `v2_agrees_with_old` | `v2_differs_from_both`.
- Weights by final run outcome (victory / `final_floor`).
- Writes a report.

Usage: `pnpm tsx apps/web/scripts/map-coach-backtest.ts --character=ironclad --ascension=10`.

The useful signal is **"on floors where v1 disagreed with the user and the user won, does v2 now agree with the user?"** — that's the closest proxy to improvement we have without a calibration loop.

## Telemetry

Two changes to `choices` writes for map evals:

1. **`rankings_snapshot`** — store the full `mapCoachOutput` (reasoning block, macro path, branches, callouts), not just the recommended path. Phase 2 calibration needs the reasoning + branches to analyze *why* the engine chose as it did, not only what it chose.
2. **`run_state_snapshot`** — new `jsonb NULL` column holding the computed `RunState`. Lets phase 2 compute "in what contexts was the engine wrong?" without re-deriving from raw game state. Nullable; legacy rows remain valid.

Migration: `ALTER TABLE choices ADD COLUMN run_state_snapshot jsonb NULL;` — no index in phase 1, added when phase 2 queries demand it.

## Out of scope / future phases

- **Phase 1.5 (optional):** Act 1 variant (Overgrowth / Underdocks) detection, narrowing boss and elite pools.
- **Phase 2:** deviation-aware prompting — query the player's similar-context history at eval time, inject as few-shot-style signal weighted by run outcome.
- **Phase 3:** extend the enrichment + scaffold pattern to card rewards, shops, ancients.
- **Phase 4:** node-graph visualization with branch highlighting.

## Risks and mitigations

- **Token inflation from the facts block.** Mitigation: map addendum trim offsets most of it; monitor via existing token counters, tighten facts-block formatting if needed.
- **LLM ignoring the scaffold and free-forming anyway.** Mitigation: scaffold is encoded in the zod schema (`reasoning.risk_capacity` and `reasoning.act_goal` are required fields), so a non-compliant response fails validation and retries.
- **Pattern detectors producing noisy tags on short paths.** Mitigation: each detector checks minimum path length; patterns tested against the user's historical fixtures before ship.
- **`expectedDamagePerFight` lookup table drift.** Mitigation: one-file change; keep as a labeled constant with a comment citing the calibration source.
