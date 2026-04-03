# Code Review: Map Path Highlight Persistence Fix

## Summary

This review examines a proposed two-part fix for the map path highlight disappearing when `MapView` unmounts (during combat, card rewards, etc.) and remounts (returning to the map).

---

## Plan Alignment Analysis

The plan correctly identifies the root cause: **two independent gaps** that conspire to lose the highlight on remount.

1. **Gap A (cache miss):** The smart re-eval skip path in `use-map-evaluation.ts` (line 83-87) sets `evaluatedKey.current = mapKey` but never calls `setCache()`. So when the component remounts, `getCached()` on line 47/66 finds nothing for the current `mapKey`, and `evaluation` starts as `null`.

2. **Gap B (ref reset):** In `map-view.tsx`, `prevPathRef` (line 119) is a `useRef([])` that resets to an empty array on every mount. So the `recommendedPath` useMemo (line 121-131) falls back to `[]` when `bestOptionIndex` is null (no evaluation loaded), producing no highlight.

Both identified gaps are real and accurately described. The plan addresses the correct files and the correct code paths.

---

## Detailed Review of Each Fix

### Fix 1: Cache evaluation when smart re-eval skips

**Planned change in `use-map-evaluation.ts` (lines 83-87):**
```typescript
if (onRecommendedPath && hpSimilar && deckSimilar) {
    evaluatedKey.current = mapKey;
    if (evaluation) setCache(CACHE_KEY, mapKey, evaluation);
    return;
}
```

**Verdict: CORRECT with one important caveat.**

This fix is sound for the primary use case. When the user follows the recommended path and the context is similar, the existing evaluation is still valid -- the rankings and path data still apply to the same map topology. The `mapKey` changes because `next_options` shifts as the player advances, but the full `recommendedPath` (which traces through deeper nodes) remains meaningful.

**IMPORTANT concern -- stale option indices:**

The `evaluation.rankings[].optionIndex` values are 1-indexed references to the *previous* set of `next_options`. When the player moves forward:
- The old `next_options` might have been `[{col:1,row:3}, {col:2,row:3}, {col:3,row:3}]`
- The new `next_options` might be `[{col:2,row:4}, {col:3,row:4}]`

The cached evaluation's `optionIndex` values (e.g., 1, 2, 3) now reference a different set of options. This affects:

1. **`bestOptionIndex`** (map-view.tsx line 74-85) -- selects the best ranking by tier, then uses `optionIndex` to find the "best" option in `next_options`. With mismatched indices, this could highlight the **wrong** next node.

2. **Sidebar ranking cards** (map-view.tsx line 347-349) -- `evaluation.rankings.find(r => r.optionIndex === i + 1)` pairs rankings to the current `next_options` by index. A mismatch would show wrong tier badges and reasoning against the wrong path options.

However, looking more carefully at the flow: this skip logic only fires when `lastEvalContext.current` is populated (line 75-76), and `lastEvalContext` is only set after a successful LLM evaluation (line 248). The `lastEvalContext.recommendedNodes` set includes nodes from `leads_to` (lines 239-242) and the explicit recommended path (lines 245-247). So the `onRecommendedPath` check (line 77) validates that the player's current position is on the expected trajectory.

**The real question is: does the sidebar UI display stale ranking data against new options?**

Yes, it would. The sidebar iterates over `next_options` and matches by `optionIndex` (line 347-349). If the new `next_options` has 2 entries but the cached evaluation has 3 rankings, the UI will show tier badges for indices 1 and 2 (which originally referred to different nodes). This is a **correctness bug in the sidebar**, even though the path highlight itself may be visually acceptable since `traceRecommendedPath` recomputes locally from the best option.

**Recommendation (Important):** When caching in the skip path, also clear or mark the `rankings` as stale so the sidebar does not display mismatched data. Alternatively, only cache the `recommendedPath` and `overallAdvice` but null out `rankings`. Or, check if the new `next_options` indices still correspond to the same node types before displaying sidebar rankings.

Actually, wait -- re-reading more carefully: the `recommendedPath` useMemo at line 121-131 calls `traceRecommendedPath()` which recomputes from the `bestOptionIndex`. If `bestOptionIndex` points to the wrong option in the new set, the traced path would highlight the wrong branch from the current position. This is the more critical issue.

**Revised severity: CRITICAL.** The `optionIndex` mismatch means `bestOptionKey` (line 87-91) could resolve to the wrong node in the new `next_options` array, causing the path tracer to start from the wrong branch. The highlight would point down the wrong path.

**Recommended mitigation:** Instead of blindly caching under the new `mapKey`, validate that the best-ranked option's node type still matches. Or better: since `traceRecommendedPath` is a pure local computation that does not need the LLM evaluation, decouple the path trace from the evaluation rankings. Cache only the `recommendedPath` coordinates (not the rankings), and on remount, just restore those coordinates for the highlight. The sidebar can show "no evaluation" state until a fresh eval runs.

### Fix 2: Module-level path storage

**Planned change in `map-view.tsx`:**
Replace `const prevPathRef = useRef<{ col: number; row: number }[]>([])` with `let persistedPath: { col: number; row: number }[] = []` at module scope.

**Verdict: WORKS but has design concerns.**

This would survive unmount/remount. However:

1. **Multiple instances:** The plan asks about simultaneous `MapView` instances. In the current architecture (`GameStateView` switch statement), only one view renders at a time, so this is not a practical concern today. But it is a latent coupling -- if the architecture ever changes (e.g., tabbed views, split panes), the shared mutable state would cause cross-contamination.

2. **Cross-app leakage:** The plan asks about desktop vs. web imports. Since this is in `packages/shared`, both apps import the same module. In practice, each app runs in its own JS runtime (browser tab vs. Tauri webview), so the module-level variable would be independent per runtime. No issue here.

3. **Stale data across runs:** A module-level variable persists for the entire app session. If the user starts a new run, `persistedPath` still holds coordinates from the previous run's map. The `recommendedPath` useMemo only uses `prevPathRef.current` when `bestOptionIndex == null` (line 122), and after a new evaluation arrives, it would overwrite `persistedPath`. But during the brief window before a new eval loads, the old run's path coordinates could flash on the new run's map. This is minor (coordinates likely won't match any nodes) but worth noting.

4. **React patterns:** The plan asks about better alternatives. The standard React approaches for persisting state across unmount cycles are:

   - **Lift state up:** Move the evaluation result (or at least the recommended path) into the parent (`GameStateView` or higher) so it is not lost on unmount. This is the cleanest React pattern.
   - **External store (zustand/jotai):** A lightweight store that holds the last map evaluation. Components subscribe reactively. This project does not appear to use one, so this adds a dependency.
   - **Context:** A `MapEvaluationProvider` wrapping the game state view. Works but adds provider nesting.
   - **The existing localStorage cache (Fix 1):** If Fix 1 properly caches the evaluation, Fix 2 becomes unnecessary -- `useMapEvaluation` would restore the evaluation from cache on remount, `bestOptionIndex` would be non-null, and `recommendedPath` would compute correctly without needing a fallback.

**Key insight:** If Fix 1 is implemented correctly, Fix 2 is redundant. The `prevPathRef` fallback only triggers when `bestOptionIndex` is null, which only happens when `evaluation` is null. If the cache restores the evaluation synchronously on mount (which it does -- line 47-49 in `use-map-evaluation.ts` reads cache synchronously during state initialization), then `evaluation` is non-null on the first render, `bestOptionIndex` computes, and `recommendedPath` computes via `traceRecommendedPath`. No fallback needed.

---

## Race Condition Analysis

The plan asks about race conditions between cache write (skip logic) and cache read (remount).

The localStorage cache is synchronous and single-threaded in the browser. The write in the skip path happens during a render cycle's callback execution. The read on remount happens during the next component initialization. These cannot overlap. **No race condition.**

However, there is a subtle ordering issue: the skip logic runs inside `evaluate()` which is called from the render-phase check at line 279-281. The `evaluation` state variable referenced in the skip path (`if (evaluation) setCache(...)`) captures the value from the current render's closure. On the first render after a map key change, `evaluation` holds the *previous* evaluation (React state persists across re-renders within a component's lifecycle). This is correct -- it is exactly the evaluation we want to cache. But if the component was unmounted and remounted, `evaluation` starts as `initialEval` (line 49), which could be null if the cache was empty. In that case, `if (evaluation)` would be false and the cache write would not happen. This is actually safe -- it means "nothing to cache, nothing to persist."

**No race condition concern.**

---

## Summary of Findings

### Critical

1. **Stale `optionIndex` mapping after caching skipped evaluation.** When the skip logic caches the old evaluation under the new `mapKey`, the `rankings[].optionIndex` values reference the previous set of `next_options`. This causes `bestOptionIndex` to resolve to the wrong node, making the path highlight point down the wrong branch and the sidebar display mismatched tier/reasoning data.

   **Fix:** Either (a) do not cache `rankings` when skipping -- only cache `recommendedPath` and `overallAdvice`, or (b) remap `optionIndex` values to match the new `next_options`, or (c) match rankings to options by node coordinate rather than by index.

### Important

2. **Fix 2 is unnecessary if Fix 1 is done correctly.** The synchronous cache read in `useMapEvaluation` (line 47) restores the evaluation on mount, making `bestOptionIndex` non-null on the first render. The `prevPathRef` fallback never triggers. Remove Fix 2 to avoid the module-level mutable state and its associated design concerns (stale cross-run data, implicit coupling).

### Suggestions

3. **Consider lifting evaluation state up.** If future requirements need evaluation data in sibling views (e.g., showing "recommended path: Elite -> Rest -> Shop" in a run summary sidebar), having the evaluation in a parent component or lightweight store would be more extensible than localStorage.

4. **Add a `runId` or `act` qualifier to the cache key.** Currently `mapKey` is derived purely from `next_options` coordinates. Two different runs could theoretically produce the same `mapKey` for different maps. Including the run identifier would prevent stale cross-run cache hits.

---

## Recommended Revised Plan

1. **In `use-map-evaluation.ts`, skip-path caching:** Cache the evaluation but clear `rankings` (or set to empty array) so the sidebar gracefully shows "no ranking" state. Keep `recommendedPath` and `overallAdvice` intact for the path highlight and advice text.

   ```typescript
   if (onRecommendedPath && hpSimilar && deckSimilar) {
     evaluatedKey.current = mapKey;
     if (evaluation) {
       // Cache path + advice but not rankings (indices are stale for new options)
       const cached: MapPathEvaluation = {
         ...evaluation,
         rankings: [],
       };
       setCache(CACHE_KEY, mapKey, cached);
     }
     return;
   }
   ```

   Then in `map-view.tsx`, the `recommendedPath` useMemo needs to handle the case where `bestOptionIndex` is null (no rankings) but `evaluation.recommendedPath` exists. Use the evaluation's `recommendedPath` directly as a fallback before falling back to the previous path ref.

2. **Do not implement Fix 2 (module-level variable).** The cache restoration makes it unnecessary.

3. **Validate on remount:** When `useMapEvaluation` loads from cache and the rankings are empty, the component should show a "Following recommended path" or similar indicator instead of blank sidebar cards, so the user understands why tier badges are absent.
