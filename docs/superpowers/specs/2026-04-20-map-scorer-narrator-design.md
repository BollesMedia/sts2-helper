# Map Coach — Deterministic Scorer + LLM Narrator (Phase 4)

**Date:** 2026-04-20
**Status:** Approved (design, pre-plan)
**Motivation:** Every map-pathing iteration in phases 1–3 has hit the same failure shape — the LLM receives correct facts and produces output that is self-contradictory with its own pick ("safest 2-elite route" + 0-elite path; `act_goal: "acquire 2–3 elites"` + 0-elite `macro_path`; claim of "abundant risk capacity" followed by the survival route). We added prompt rules and compliance layers; the LLM ignored them. Map pathing is a constrained-optimization problem, not a reasoning problem: maximize elites / treasures / rest→elite pairs subject to HP and budget constraints. This phase inverts the architecture so a deterministic scorer picks the path and the LLM translates the resulting structured rule annotations into prose.

## Non-goals

- Calibration loop / deviation-aware prompting. Unblocked by this phase's telemetry but deferred.
- Extending the scorer pattern to card rewards, shops, ancients. LLM judgment is appropriate there.
- Changing the UI. The output schema stays the same at the server/desktop boundary (`macro_path` is now injected server-side post-LLM).
- Learned weights. Phase 4 ships hand-tuned weights; phase 5+ can swap in learned ones using the score telemetry this phase captures.

## Current State

**Evaluation flow today (phases 1–3):**
- `enrichPaths` computes patterns + aggregates per candidate path.
- `buildMapPrompt` injects facts + `MAP_PATHING_SCAFFOLD` (hard rules + reasoning steps) into the prompt.
- LLM returns `{ reasoning, headline, confidence, macro_path, key_branches, teaching_callouts }`.
- `sanitizeMapCoachOutput` truncates + clamps.
- `repairMacroPath` validates + reconstructs if LLM drifted.
- `rerankIfDominated` swaps the LLM's pick to a strictly-dominating alternative if one exists.

**Known failure pattern**
- The LLM is the picker. Hard rules in the scaffold ("elite count is load-bearing") are advisory — the LLM ignores them when the output tone suggests otherwise.
- `rerankIfDominated` catches only strict-dominance cases; every failure mode the user has reported either didn't trip strict dominance or couldn't be expressed as one (e.g., "your `act_goal` contradicts your `macro_path`" isn't dominance).
- Prompt has grown to ~600 tokens. Adding more rules doesn't help.

**Root cause:** LLM judgment is the wrong tool for a constrained-optimization problem with < 10 features and a handful of hard rules. Map pathing is deterministic by nature; LLM adds noise, not signal.

## Phase Scope

1. **Deterministic scorer** (`scorePaths`) — two-phase (hard filter then weighted sum) produces a ranked `EnrichedPath[]`. Pure TS, no IO.
2. **Narrator input builder** (`buildNarratorInput`) — given ranked paths + run state, emits structured annotations (active rules, branch tradeoffs, trimmed run state).
3. **Branch derivation** (`deriveBranches`) — given winner + runner-up, finds structural fork points and labels them. Scorer-driven; no LLM.
4. **LLM narrator** — shorter prompt (`MAP_NARRATOR_PROMPT`, ~80 tokens). LLM receives annotations, returns `{ headline, reasoning, teaching_callouts }` only. No path, no branches, no confidence.
5. **Server assembly** — final response = LLM text fields + scorer's `macro_path` + scorer's `key_branches` + a confidence derived from the scorer (weight-gap between winner and runner-up).
6. **Listener simplification** — map listener only triggers evaluation (scorer + narrator) on three explicit conditions: start of act (after ancient heal resolves), player moves to a node that is NOT on the current recommended path (that new node becomes floor 0 for re-scoring), or player is at a fork (next_options.length > 1). Narrator LLM call within a triggered eval is further gated by "winner path changed since last narration."
7. **Compliance tear-down** — `rerankIfDominated` unreachable; delete or collapse. `repairMacroPath` keeps the smart walker for map-graph validation only. `MAP_PATHING_SCAFFOLD` deleted (replaced by narrator prompt).

Single-release ship. No feature flag.

## Architecture

```
POST /api/evaluate (type: "map")
  ├── enrichPaths(nodes, runState) → EnrichedPath[]     (existing)
  ├── scorePaths(paths, runState) → ScoredPath[] ranked
  │   ├── phase 1: hard filter
  │   └── phase 2: weighted sum over survivors
  ├── winner = ranked[0]; runnerUp = ranked[1]
  ├── deriveBranches(winner, runnerUp, nodes) → KeyBranch[]
  ├── buildNarratorInput(winner, runnerUp, runState) → NarratorInput
  ├── LLM call with MAP_NARRATOR_PROMPT
  │   Returns { headline, reasoning, teaching_callouts }
  └── server assembles:
      { macro_path, key_branches, confidence, headline, reasoning,
        teaching_callouts, compliance? }

Desktop listener (mapListeners):
  On gameStateReceived with state_type === "map":
    ├── shouldReEvaluate(prevState, nextState)?
    │     - start-of-act after ancient resolves
    │     - player's current node is NOT on lastRecommendedPath.nodes
    │         (player deviated; the new node becomes floor 0 for the next score)
    │     - player is at a fork (next_options.length > 1)
    ├── if no trigger: no-op (keep last highlight + last narration)
    ├── if trigger: enrich + score (pure JS, synchronous)
    ├── if winner.id !== previouslyDisplayed.id:
    │     - update highlighted path immediately
    │     - dispatch narrator LLM call (async)
    ├── cache scoredPaths + winner for telemetry + next-trigger comparison
    └── on narrator LLM response: attach text to already-displayed path
```

### New files

- `packages/shared/evaluation/map/score-paths.ts` + `.test.ts`
- `packages/shared/evaluation/map/build-narrator-input.ts` + `.test.ts`
- `packages/shared/evaluation/map/derive-branches.ts` + `.test.ts`

### Modified files

- `packages/shared/evaluation/prompt-builder.ts` — add `MAP_NARRATOR_PROMPT`; delete `MAP_PATHING_SCAFFOLD`.
- `packages/shared/evaluation/map-coach-schema.ts` — LLM response schema loses `macro_path`, `key_branches`, `confidence` (server-injected now). Output schema (server → client) stays the same.
- `apps/web/src/app/api/evaluate/route.ts` — map branch rewired.
- `apps/desktop/src/features/map/mapListeners.ts` — rewire gating to the three structural triggers; narrator call further gated on winner-change.
- `apps/desktop/src/lib/should-evaluate-map.ts` — rewritten to the three triggers (start-of-act post-ancient, off-path, at-fork). Old soft gates removed.
- `packages/shared/evaluation/map/repair-macro-path.ts` — significantly shrunk. Retained helpers serve as map-graph validators used by the scorer; LLM-drift repair paths removed (no LLM `macro_path` to repair).

### Files unchanged

- `enrich-paths.ts` — already produces everything the scorer needs.
- `run-state.ts` including the HP walk simulator — stays as the feature source.
- `apps/desktop/src/views/map/map-view.tsx` — same UI, same data shape.
- `sanitizeMapCoachOutput` — still truncates/clamps the narrator's text fields.

### Files retired

- `packages/shared/evaluation/map/rerank-if-dominated.ts` + `.test.ts` — unreachable; delete.

## Scoring

### Phase 1 — hard filter (disqualifiers)

A path is disqualified if ANY of:

1. **Fatal.** `minHpAlongPath <= 0`.
2. **0-elite abdication.** In Acts 1 or 2, `elitesTaken === 0` AND some other candidate has `elitesTaken >= 2` AND that candidate's `minHpAlongPath > 0`.
3. **Naked shop.** `shopsTaken > 0` AND projected gold at shop floor < `cardRemovalCost` AND some alternative has equal-or-more elites with a viable shop.

If EVERY path is disqualified, phase 1 falls back to "least bad" — sort by fewest hard-filter violations, then proceed to phase 2 among that tier. The scorer always picks something; a dead run still deserves coaching.

### Phase 2 — weighted sum (among survivors)

```ts
score =
  +10 * elitesTaken
  + 8 * restBeforeEliteCount
  + 5 * restAfterEliteCount
  + 6 * treasuresTaken
  +10 * (projectedHpEnteringPreBossRest / maxHp)
  + 3 * distanceToAct3EliteOpportunities (only Act 3 at Asc 10+)
  - 5 * minHpDipBelow30Pct_count
  -12 * minHpDipBelow15Pct_count
  - 3 * backToBackShopPairCount
  - 2 * hardPoolChainsWithoutRest
```

Note: the pre-boss rest is guaranteed by the game, so the "naked approach to boss" concern is already captured by `minHpDipBelow30Pct_count` / `minHpDipBelow15Pct_count` and by `projectedHpEnteringPreBossRest` (which rewards entering that guaranteed rest with more HP). No separate `nakedPreBossChainCount` feature.

All weights live in a single exported `MAP_SCORE_WEIGHTS` const so tuning is a one-file change.

### Tiebreakers (paths within ±0.5 score)

1. Higher `restBeforeEliteCount`.
2. Lower `minHpDipMagnitude` (absolute, not count-based).
3. Higher `projectedHpEnteringPreBossRest`.
4. Stable order by the candidate index (earliest next_option wins on total ties).

### Score shape

```ts
export interface ScoredPath extends EnrichedPath {
  score: number;
  scoreBreakdown: Record<string, number>;
  disqualified: boolean;
  disqualifyReasons: string[];
}
```

## Confidence derivation

Scorer produces `confidence` from the gap between winner and runner-up:

```ts
const gap = ranked[0].score - ranked[1].score;
const gapRatio = gap / Math.max(1, Math.abs(ranked[0].score));
confidence =
  gapRatio >= 0.25 ? 0.95 :
  gapRatio >= 0.10 ? 0.80 :
  gapRatio >= 0.05 ? 0.65 : 0.50;
```

Large gap = confident recommendation. Narrow gap = close call — surfaced to the player via the existing confidence pill in the UI.

## Key branches — scorer-derived

`deriveBranches(winner, runnerUp, nodes)`:

1. Walk both paths in parallel from floor 1 to the act boss.
2. At the first floor where the two paths diverge to different nodes, emit a branch:
   ```ts
   {
     floor: floorNumber,
     winnerNode: <type of winner's pick>,
     alternatives: [{ nodeId: runnerUp.node, type: runnerUp.nodeType, tradeoff: string }],
     whyWinnerWins: string,  // derived from score-breakdown delta
     closeCall: boolean,     // true if confidence < 0.75
   }
   ```
3. If the paths converge again and diverge a second time, emit a second branch. Cap at 3 total.
4. If the paths never diverge (same path), no branches.

`whyWinnerWins` is constructed from the score-breakdown delta — which feature contributes most to the winner's lead at that fork. Examples: "rest→elite pair vs naked elite", "keeps HP safe vs dips to 14%", "elite access vs detour".

## Narrator

### Prompt (`MAP_NARRATOR_PROMPT`)

```
You are narrating a MAP coaching recommendation. You do NOT pick the path.
The path has already been chosen by a deterministic scorer.

You receive:
- chosenPath: summary + aggregates
- activeRules: rules the chosen path satisfies strongly
- runnersUpTradeoffs: what this path gives up vs alternatives
- runState: deck and act context

Produce:
- headline (1 sentence): the verdict in the player's voice.
- reasoning (2–3 sentences): why these rules matter for THIS run.
- teaching_callouts (max 4): one per rule the player should internalize.
  Each callout is 1–2 sentences.

Rules:
- Do NOT describe another path as "better" — the scorer has decided.
- Do NOT invent facts beyond the input.
- Do NOT propose alternative paths.
- Render active rules as coaching prose.
```

~80 tokens. Entire map eval system prompt (base + narrator) should land under 1200 tokens, vs ~2000 today.

### LLM output schema

```ts
export const mapNarratorOutputSchema = z.object({
  headline: z.string().min(1),
  reasoning: z.string().min(1),
  teaching_callouts: z.array(
    z.object({
      pattern: z.string(),
      explanation: z.string(),
    }),
  ),
});
```

No `macro_path`, no `key_branches`, no `confidence`. Server injects those.

### Narrator input

```ts
export interface NarratorInput {
  chosenPath: {
    summary: string;          // "3 monsters → elite at f6 → rest → treasure"
    elites: number;
    restEliteWindows: number;
    shops: number;
    treasures: number;
    projectedHpRangeMin: number;
    projectedHpRangeMax: number;
  };
  activeRules: Array<{
    kind: string;  // "rest_before_elite_pair", "elite_count_met", "treasure_anchor", etc.
    detail?: string;
  }>;
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
```

Active rule kinds — enum. When the scorer assigns positive or negative weight to a feature that clears a meaningful threshold, it emits an active rule. Thresholds tuned so typical paths produce 2–4 active rules.

## Listener simplification

The old `shouldEvaluateMap` grew a pile of soft gates (`hpDropExceedsThreshold`, `goldCrossedThreshold`, `deckSizeChangedSignificantly`, `shopInPathBecameWorthless`, `isOnRecommendedPath`, `allOptionsAreAncient`, 3-tick grace, etc.) because evaluation meant an LLM call and we needed to debounce cost. With the scorer being pure JS, re-eval cost is zero — so the gate logic collapses to three structural triggers:

1. **Start of act (post-ancient).** First map-state of a new act. Acts 2 and 3 begin with an ancient heal event — if the map-state arrives pre-heal (HP shown is pre-heal), wait one tick for the heal to resolve; this replaces the old 3-tick grace with a deterministic "ancient event resolved" check. Act 1 has no ancient, so the trigger fires immediately on first Act 1 map-state.
2. **Player off-path.** Player's `current_node` is NOT a node on `lastRecommendedPath.nodeIds`. Treat the new node as floor 0 and re-score from there. (This covers deliberate deviation, branch-swapping due to a chosen node, and recovery from prior-frame glitches.)
3. **Player at a fork.** `next_options.length > 1` and the player has not yet moved this tick. This is the normal "we're at a decision point" case.

Absence of any trigger = no-op. We keep the highlighted path and the last narrator text.

Within a triggered eval, the narrator LLM call is further gated by "winner path ID changed since last narration." If the scorer produces the same winner we already have, no LLM call.

`allOptionsAreAncient` → handled by trigger 1 (ancient events always happen at start-of-act transitions and the heal-resolution check covers the visible-but-forced row).

Cancellation: if a second triggered eval resolves a different winner while the narrator LLM call is in flight, cancel the in-flight call and re-dispatch. Same winner → let the call continue.

## Telemetry

`choices.rankings_snapshot` captures the full scorer output for phase-5 calibration:

```ts
{
  macro_path,
  headline,
  reasoning,
  key_branches,
  teaching_callouts,
  confidence,
  compliance: { ... },
  // NEW:
  scoredPaths: ScoredPath[],  // every candidate + its score breakdown + disqualify reasons
  winnerId: string,
  narratorPromptTokens: number,
  narratorCompletionTokens: number,
}
```

Learning weights from this data is a phase-5 project; this phase just makes sure the data exists.

## Testing

### Unit

- `score-paths.test.ts`:
  - Each hard filter rule: positive and negative fixture.
  - Weighted-sum assembly: one fixture per feature contribution, plus a regression fixture that reproduces each user-reported failure (0-elite in abundant run, rest→elite×2 path, etc.).
  - Tiebreaker behavior.
  - "All paths disqualified" fallback.
- `build-narrator-input.test.ts`:
  - Shape round-trip.
  - Active rule emission at threshold boundaries.
  - Runners-up tradeoff generation.
- `derive-branches.test.ts`:
  - Identical paths → zero branches.
  - Diverging at floor 1 → one branch.
  - Diverging, converging, diverging again → two branches.
  - Cap at 3 branches.
- `should-evaluate-map.test.ts`:
  - Start-of-act with ancient unresolved → skip (one-tick wait).
  - Start-of-act with ancient resolved → trigger.
  - Player node on `lastRecommendedPath.nodeIds` and not at fork → skip.
  - Player node NOT on `lastRecommendedPath.nodeIds` → trigger (node becomes floor 0).
  - `next_options.length > 1` → trigger.
  - None of the three → no-op.

### Integration (route)

- Happy path: enrich → score → narrate → response matches `mapCoachOutputSchema`.
- Narrator LLM omits a field: server defaults, no crash.
- Narrator LLM drift (hypothetical — can it happen with the new schema?): test that unrecognized output fields are stripped.

### Regression suite

Reproduce every user-reported map failure as a scorer-level test that now asserts the CORRECT winner:

1. "0-elite path wins in abundant risk" → scorer disqualifies the 0-elite path via hard filter 2.
2. "Safest 2-elite route" + 0-elite path → mechanically impossible; narrator's input is the winner.
3. Rest→elite×2 from low HP → scorer ranks it above monster-heavy alternatives.
4. Mid-path HP dip → negative contribution high enough to fall behind safer alternatives.

### Manual smoke

Replay the act-18 smoke scenario the user flagged earlier (3 elites possible, coach previously suggested 0). Scorer should pick the 2-elite path; narrator should produce coaching text about "rest→elite density" and "HP entering pre-boss."

## Rollout

Single release. No feature flag. The LLM output schema CHANGES (loses path/branches/confidence fields), but the overall response schema the desktop consumes stays the same — server fills those fields from the scorer. No desktop changes needed.

## Risks and mitigations

- **Weight tuning produces weird picks.** Mitigation: regression test per user-reported failure. Weights in a single const. Tune + ship again if a real case is wrong.
- **Scorer disqualifies all paths on pathological maps.** Mitigation: phase 1 has the "least bad" fallback. Always returns something.
- **Narrator hallucinates facts.** Mitigation: prompt rules + structured input restricts what can be invented. If the LLM fabricates, the rendered text is wrong but the path is still right. Same failure mode as any other eval; telemetry catches it.
- **Confidence-from-gap feels wrong for the player.** Mitigation: can swap to a simpler "top N features all agree = high confidence" heuristic. One-file change.
- **Late-game Act 3 paths with the Double Boss modifier aren't captured well.** Mitigation: the `distanceToAct3EliteOpportunities` feature specifically targets A10. Tunable.

## Alternatives considered

- **Keep LLM as picker, tighten prompt.** Rejected. Every phase 1–3 iteration proved this doesn't converge.
- **LLM-as-judge on scorer output.** Rejected. Re-introduces the same disagreement class (LLM overrides scorer = which wins?).
- **Full templates, no LLM.** Rejected. Template prose feels robotic; teaching callouts lose didactic quality. Keeping the LLM for natural-language wrapping gives the best of both.
- **Feature flag behind an env var.** Rejected. Single user; direct regression observable; parallel paths add complexity without value.

## Out of scope

- Phase 5: calibration — learn weights from `scoredPaths` telemetry.
- Phase 6: extend scorer pattern to shop and ancient evals (if ever — judgment is more relevant there).
