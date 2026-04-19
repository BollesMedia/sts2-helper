# Map Coach Compliance (Phase 2)

**Date:** 2026-04-18
**Status:** Approved (design, pre-plan)
**Motivation:** Phase 1 shipped enrichment + reasoning scaffold that surfaces structured facts (`fightBudgetStatus`, `hpProjectionVerdict`, pattern annotations) to the LLM. Smoke testing showed the model cheerfully ignores those facts — recommending 6-fight paths when its own computed `fightsBeforeDanger` was 2.5, or returning sparse `macro_path` arrays that leave the SVG halo trailing off mid-path. Phase 2 closes that gap with two post-parse layers (structural auto-repair + judgment-level rerank) so the output respects the facts we already compute. No prompt changes. No new LLM calls. No calibration loop — that stays phase 3.

## Non-goals

- Deviation-aware prompting (personal history injection). Deferred — follow-up #79 + calibration-grade data both gated on this phase's telemetry shipping first.
- Retry-with-feedback loops. Decided against in favor of deterministic repair — cheaper, lower latency, more traceable.
- Per-user compliance tuning. Thresholds stay global.
- Card-reward / ancient / shop eval compliance. This phase is map-only; pattern is reusable when the other eval types get the phase-1 treatment later.

## Current State

### What phase 1 gives us
- `packages/shared/evaluation/map/enrich-paths.ts` computes `fightBudgetStatus: "within_budget" | "tight" | "exceeds_budget"` and `hpProjectionVerdict: "safe" | "risky" | "critical"` per candidate path, alongside patterns + aggregates.
- `packages/shared/evaluation/prompt-builder.ts` exports `MAP_PATHING_SCAFFOLD` with soft rules ("Do NOT recommend a path whose `fightBudget` is `EXCEEDS_BUDGET` unless ALL alternatives are also over budget").
- `apps/web/src/app/api/evaluate/route.ts` calls `sanitizeMapCoachOutput` post-parse to truncate arrays and clamp confidence — the only existing post-parse layer.

### The gap
- Scaffold rules are advisory. The LLM sees `EXCEEDS_BUDGET | CRITICAL` and picks it anyway if nothing else is constraining the output.
- `macro_path.floors[]` can come back empty, sparse, or with node_ids that don't match any real map node. SVG highlighting silently degrades.
- No observability into how often either failure pattern fires — we know it happened once in smoke, no data on frequency.

## Phase Scope

1. **Structural auto-repair layer** (`repairMacroPath`) — validates `macro_path.floors` against the map graph and repairs by walking primary-child from the chosen next_option to boss.
2. **Judgment-level rerank layer** (`rerankIfDominated`) — swaps the LLM's chosen path to a dominating alternative when one exists. Conservative dominance definition (strict improvement on BOTH HP risk + fight budget).
3. **Compliance telemetry** attached to the response and persisted via the existing `choices.rankings_snapshot` write path.
4. **Minimal UI surface** — a `SwapBadge` beside the confidence pill when a rerank fires.

Single-release ship (no feature flag). Single-user app; regressions observable directly.

## Architecture

```
POST /api/evaluate (type: "map")
  ├── ... existing layers (enrichment, prompt, LLM call) ...
  ├── sanitizeMapCoachOutput         ← existing caps/clamps
  ├── repairMacroPath (NEW)          ← structural auto-repair
  │     validates node_ids + contiguity + first/last floor
  │     fallback: primary-child walk from chosen next_option to boss
  ├── rerankIfDominated (NEW)        ← judgment-level rerank
  │     swap only when a strictly-dominating alternative exists
  │     rewrite headline + synthetic key_branches[0] + dampen confidence
  ├── attach compliance report       ← telemetry
  │     { repaired, reranked, reason, repair_reasons }
  └── response to client
```

### Files

**New:**
- `packages/shared/evaluation/map/repair-macro-path.ts` + `.test.ts`
- `packages/shared/evaluation/map/rerank-if-dominated.ts` + `.test.ts`
- `packages/shared/evaluation/map/compliance-report.ts` (types + small helpers) + `.test.ts`
- `apps/desktop/src/components/swap-badge.tsx` + `.test.tsx`

**Modified:**
- `apps/web/src/app/api/evaluate/route.ts` — wire in repair → rerank → report on the map branch.
- `packages/shared/evaluation/map-coach-schema.ts` — add `compliance` field to the output schema (optional, snake_case).
- `apps/desktop/src/services/evaluationApi.ts` — adapter passes compliance through to the client type.
- `apps/desktop/src/lib/eval-inputs/map.ts` — `MapCoachEvaluation` type gains `compliance?: { repaired, reranked, reason, repairReasons }`.
- `apps/desktop/src/views/map/map-view.tsx` — renders `SwapBadge` next to `ConfidencePill` when `compliance.reranked`.

**No new DB migration.** Compliance lives inside `rankings_snapshot` which already stores the full parsed output.

## `repairMacroPath` — structural auto-repair

Pure function; runs after `sanitizeMapCoachOutput`, before rerank. Takes the parsed output + the map graph + the enriched candidate paths. Returns `{ output, repaired, repair_reasons }`.

### Validators (in order)

1. **Non-empty `macro_path.floors`.** Empty → synthesize from the best-next-option + a primary-child walk.
2. **Every `node_id` matches a real node.** Uses a `Map<"col,row", MapNode>` built from `state.map.nodes`. Unknown entries are dropped; the path is truncated at the first gap.
3. **`macro_path.floors[0]` matches one of `next_options`.** If not, try: a) scan the first 3 floors for any node_id that matches a next_option, use the matching next_option as anchor and drop the floors before it; b) match by node type (if LLM said first floor was `elite`, pick the elite next_option); c) fall back to first next_option.
4. **Contiguity.** `floors[i+1]` must appear in `floors[i].children`. Break found → truncate at the last valid node, then walk primary-child from there.
5. **Final floor is the act boss.** Append a primary-child walk from the last valid floor if missing.

### Repair strategy — primary-child walk

When filling missing steps, walk the `children[0]` branch from a given start-node to the act boss. Matches the existing `walkPath` helper and is deterministic.

### Edge cases

- **Dead-end walk** — walk hits a node with no children before boss. Stop; emit truncated path. Log `"repair_walk_dead_end"`. UI degrades gracefully (partial glow).
- **Totally missing `macro_path`** — synthesize from the top-ranked next_option (by matching LLM's `headline` or falling back to the first next_option) plus primary-child walk to boss.
- **Multiple next_options on `macro_path[0]`'s row** — shouldn't happen given game rules, but: prefer the one whose `col,row` matches LLM's stated `node_id`.

### Output

```ts
type RepairResult = {
  output: MapCoachOutputRaw;
  repaired: boolean;
  repair_reasons: string[];  // "empty_macro_path", "unknown_node_id@3,5", "truncated_at_f8", "repair_walk_dead_end"
};
```

### Tests

Six colocated cases: valid pass-through, sparse fill, bad-node-id truncation, first-floor mismatch swap, missing-boss append, dead-end partial.

## `rerankIfDominated` — judgment-level rerank

Pure function; runs after repair. Takes the repaired output + the enriched candidate paths. Returns `{ output, reranked, reason }`.

### Dominance

Path X **dominates** path Y iff X is strictly better on BOTH axes:

- **HP risk axis (lower is better):** `critical > risky > safe`
- **Fight budget axis (lower is better):** `exceeds_budget > tight > within_budget`

If LLM picked `(exceeds_budget, safe)` and path B is `(within_budget, risky)`, NEITHER dominates. We defer to the LLM — it may have deck-archetype or relic reasons we don't capture.

### Swap procedure

When LLM's pick IS dominated:

1. Find all candidates that dominate the LLM's pick.
2. Among dominators, pick the "best": lowest HP risk → best fight budget → LLM's rank-order as tiebreaker.
3. Transform the output:
   - `macro_path` → replaced with the dominator's floors.
   - `headline` → template: `"Safer alternative: ${shortSummary(dominator)}"`.
   - `confidence` → dampened: `max(0, confidence - 0.15)`.
   - `reasoning.risk_capacity` and `reasoning.act_goal` → **unchanged** (analysis still valid; only action changes).
   - `key_branches` → replaced with a single synthetic entry explaining the swap.
   - `teaching_callouts` → cleared (they were keyed to the discarded path).

### Tiebreak details

- If two dominators both improve HP risk and fight budget by one step, the one with the **better absolute HP risk** wins (a `safe` dominator beats a `risky` one).
- If HP risk is tied, the one with the **better fight budget** wins.
- If both are tied, use the LLM's original rank order (if the LLM ranked paths 1/2/3 in `macro_path` context, prefer the one LLM had higher — defers to LLM analysis when structural axes tie).

### Integration with repair

Repair runs first. If repair swapped `macro_path[0]` (because LLM's chosen node didn't match a next_option), we re-classify the path — look up the enriched candidate whose `id` corresponds to the repaired `macro_path[0].node_id`. That becomes "LLM's pick" for dominance comparison. This keeps rerank honest about what was actually picked.

### Output

```ts
type RerankResult = {
  output: MapCoachOutputRaw;
  reranked: boolean;
  reason: string;  // "dominated_by_path_B" | "no_dominators" | "llm_picked_best"
};
```

### Tests

Five colocated cases: dominated swap, no-dominator pass-through, multi-dominator selection, LLM-picked-best no-swap, all-paths-bad no-swap.

## Compliance report

Small helper that combines `RepairResult` + `RerankResult` into a single `compliance` field on the output:

```ts
type ComplianceReport = {
  repaired: boolean;
  reranked: boolean;
  reason: string | null;      // null when neither fired or both fired but no specific reason
  repair_reasons: string[];    // empty when no repair
};
```

Attached to the response body. Persisted to `choices.rankings_snapshot` via the existing write path. Also logged to server console when `EVAL_DEBUG=1`.

### Schema change

`map-coach-schema.ts` gains an optional `compliance` field (snake_case on the wire):

```ts
compliance: z.object({
  repaired: z.boolean(),
  reranked: z.boolean(),
  reason: z.string().nullable(),
  repair_reasons: z.array(z.string()),
}).optional(),
```

Optional because legacy responses (from immediately after deploy) won't have it. Client code defaults to `{repaired: false, reranked: false, reason: null, repair_reasons: []}` when missing.

## UI

### `SwapBadge`

Small amber pill component rendered in the sidebar headline row next to `ConfidencePill`, visible only when `compliance.reranked === true`.

```
[↻ SWAPPED]   [conf: 0.68]
```

- Tailwind: `text-amber-400 bg-amber-500/10 border-amber-500/25`.
- Tooltip/hover title exposes `compliance.reason`.

### Repair-only cases

No UI — `repaired: true, reranked: false` is silent. The map already renders correctly thanks to the repaired path; flagging it would just confuse the player.

### Dampened confidence

Already surfaced by the existing `ConfidencePill` — a rerank lowers the number, user sees it.

## Testing strategy

### Unit (vitest, colocated)

- `repair-macro-path.test.ts` — 6 cases (see repair section).
- `rerank-if-dominated.test.ts` — 5 cases (see rerank section).
- `compliance-report.test.ts` — shape/combination check.
- `swap-badge.test.tsx` — renders when reranked, omitted otherwise, tooltip exposes reason.

### Integration

One new case in `evaluate/route.test.ts`:
- **"compliance pipeline: dominated output is reranked"** — mock LLM returns an output pointing at an `(exceeds_budget, critical)` path when a dominating alternative exists. Assert `compliance.reranked === true`, `headline` changed, `confidence` dropped.

### Regression guards

- Route test asserting `compliance.repaired === false` when the response is already well-formed (no over-eager repair).
- Route test asserting a non-dominated LLM pick is passed through verbatim (no meddling rerank).

### Manual smoke

Replay the phase-1 run where the LLM recommended 5 monsters + elite. With compliance in place, either:
- A swap fires → UI shows `[↻ SWAPPED]` and the macro_path becomes a safer alternative.
- No swap fires → the LLM's pick actually wasn't dominated (no strictly-better alternative existed). Informative either way.

### Out of scope

- No LLM-in-the-loop tests — mocks only.
- No latency benchmarks. Both validators are O(paths × floors); game rules bound inputs (≤5 candidates, ≤20 floors).

## Rollout

Single release. No feature flag (single-user context, direct regression observability).

Order of operations:
1. Implement + land repair in isolation (no wiring). Unit tests cover the repair logic.
2. Implement + land rerank in isolation. Unit tests cover dominance rules.
3. Implement compliance report helper + schema change.
4. Wire all three into `/api/evaluate` route. Integration test + regression guards.
5. Add client-side `compliance` pass-through + `SwapBadge`.
6. Manual smoke on a real run.

Each step commits independently; the route wiring is the big integration moment.

## Risks and mitigations

- **Over-eager repair** — repair fires on valid output due to a bug, mangling correct responses. Mitigation: regression guard test; repair is no-op on well-formed input.
- **Over-eager rerank** — swaps when it shouldn't because dominance rules are too loose. Mitigation: strict dominance (BOTH axes must strictly improve); no-dominator test guard.
- **Repair creates an invalid path** — primary-child walk hits a dead-end before boss. Mitigation: explicit handling, logged reason, graceful partial path.
- **Phase-1 `fightBudgetStatus` thresholds are wrong** — rerank triggers frequently on correct LLM picks because the budget was miscalibrated. Mitigation: telemetry exposes the rate; tune thresholds (already tracked as issue #81).
- **Swap's synthetic reasoning feels jarring to the player** — UI-level risk. Mitigation: phrase the swap branch to credit both the coach's analysis and the swap rationale; confidence pill dampened so the user knows this is lower-certainty.

## Out of scope / future phases

- **Phase 2.5:** tighten dominance rules based on real telemetry (if strict dominance is too conservative, relax to "better on one axis AND no worse on the other").
- **Phase 3:** deviation-aware prompting (original phase 2 scope) — now unblocked by compliance telemetry providing cleaner calibration signal.
- **Phase 4+:** extend the repair + rerank pattern to card_reward, shop, ancient eval types when they adopt phase-1-style enrichment.
