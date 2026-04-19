# Save-File-Derived Canonical RunId (Phase 1 + Phase 2)

**Issue:** [#75](https://github.com/BollesMedia/sts2-helper/issues/75)
**Date:** 2026-04-19
**Scope:** Phase 1 (Rust save-file reader + Tauri commands + dir watcher) and Phase 2 (frontend adopts canonical runId, backfills on startup, uses history watcher for SP end-of-run). Phase 3 (MP-specific handling) is deliberately out of scope and will be a separate spec.

---

## Goal

Replace the helper's client-minted `run_${Date.now()}_${random}` runId with a save-file-derived canonical identifier (`start_time` from the STS2 save file's filename and contents). This unlocks:

- Crash-safe run tracking — runIds survive app restarts because the game writes them to disk before the helper ever sees the run.
- Reliable SP end-of-run detection — the game atomically writes `history/<start_time>.run` at end-of-run, giving us a single authoritative signal that replaces the brittle `inferRunOutcome` heuristics for SP (directly closes [#74](https://github.com/BollesMedia/sts2-helper/issues/74) for SP).
- Foundation for MP tracking and cross-device lifetime stats in later phases.

Multiplayer is not addressed in this phase: the game never writes MP runs to local `history/`, so MP tracking must rely on live MCP polling + a future helper-side history record. The existing `inferRunOutcome` path remains in place for MP until Phase 3 lands.

## Context (verified 2026-04-18)

- Save directory (macOS): `~/Library/Application Support/SlayTheSpire2/steam/<steam_user_id>/modded/profile1/saves/`. Mirror on Windows under `AppData/Roaming/SlayTheSpire2/...`.
- Files are JSON. `current_run.save` (active SP) and `current_run_mp.save` (active MP) are written during a run; on end-of-run the game atomically creates `history/<start_time>.run` and (for SP) removes `current_run.save`.
- Scan of 114 local history files showed **0** with `len(players) > 1`. Multiplayer runs never land in local `history/` regardless of host/joiner status.
- The top-level `game_mode` field is `"standard"` for both SP and MP saves. The real discriminator is `len(players) > 1` or presence of MP-specific fields (`pre_finished_room`, `shared_relic_grab_bag`).
- Existing DB records use client-minted `run_${Date.now()}_${random}` runIds. No migration, rename, or match-and-merge is planned; legacy rows stay as-is.

## Decisions Log

The following design decisions were settled during brainstorming on 2026-04-19:

- **Scope:** Phase 1 + Phase 2 together as one plan. Phase 3 (MP) is a separate follow-up.
- **Legacy DB rows:** Add a nullable `run_id_source TEXT` column. NULL = legacy client-minted. New values: `'save_file'` (canonical) and `'client_fallback'` (save reader unavailable at time of detection). No retroactive backfill or match-and-merge.
- **Historical backfill:** None on first launch. The helper only syncs runs that complete after this feature ships. Historical entries in `history/` with no DB twin stay orphaned on disk.
- **End-of-run signal for SP:** Add a `notify`-crate history-directory watcher as the authoritative source, plus a startup scan for the "app was closed during end-of-run" case. Keep `inferRunOutcome` intact because MP paths depend on it; the `outcomeConfirmed` reducer is already idempotent against double-firing.
- **Save reader unavailable:** Retry up to 3 times over ~10s, then fall back to the old client-minted runId format with `run_id_source: 'client_fallback'`. Never drop a run.

## Architecture

**Rust** owns all filesystem work. It exposes three Tauri commands and one event; the frontend consumes them.

**Frontend** owns API posting and Redux state. No new endpoints on the web side — all sync goes through existing `/api/run` (start + end actions) with the new `run_id_source` field plumbed through.

### Command surface

- `get_active_run_identifier() -> Option<ActiveRun>` — reads `current_run.save` or `current_run_mp.save` (whichever exists), returns `{ start_time, seed, ascension, character, is_mp }` or `None`.
- `list_run_history(after_start_time: Option<i64>) -> RunHistoryListing` — scans `history/` for `<ts>.run` files with `start_time > after`, parses each, returns `{ entries: Vec<RunSummary>, skipped: u32 }`.
- `start_run_history_watch()` — arms the `notify` watcher on `history/` if not already armed. Idempotent.

### Event surface

- `"run-completed"` — fires from the watcher when a new `history/<ts>.run` appears. Payload is the full `RunSummary`.

### Data types

```rust
pub struct ActiveRun {
    pub start_time: i64,
    pub seed: String,
    pub ascension: u32,
    pub character: String,
    pub is_mp: bool,
}

pub struct RunSummary {
    pub start_time: i64,
    pub seed: String,
    pub ascension: u32,
    pub character: String,
    pub win: bool,
    pub was_abandoned: bool,
    pub killed_by_encounter: String,
    pub run_time: u32,
    pub build_id: String,
    pub act_reached: u32,
    pub players_count: u32,
}

pub struct RunHistoryListing {
    pub entries: Vec<RunSummary>,
    pub skipped: u32,
}
```

## Components

Each file has one responsibility. Kept focused so each can be unit-tested in isolation.

### Rust (`apps/desktop/src-tauri/src/`)

- **`save_file.rs`** (new) — Pure parsing. `parse_run_file(&Path) -> Result<RunSummary, SaveError>` and `parse_active_save(&Path) -> Result<ActiveRun, SaveError>`. No I/O beyond the single file read passed in. Uses `serde(default)` liberally to tolerate schema-version drift; only `start_time`, `seed`, `ascension`, `win`, and `players` are strict.
- **`save_dir.rs`** (new) — Path resolution. `resolve_saves_dir() -> Result<PathBuf, SaveError>` handles the UnifiedSavePath-vs-unmodded fork and walks per-steam-user-id subdirectories. Env-injectable `HOME` / `APPDATA` for tests.
- **`save_watcher.rs`** (new) — `notify`-crate wrapper. Spawns a tokio task watching `history/`, debounces bursts (the game can write multiple files in quick succession if backups are rotating), emits `"run-completed"` on new files. Uses the same supervisor pattern as `game_state_poller.rs` (respawn on panic via `tokio::spawn` + `JoinHandle::await`; factor out a tiny `supervise_task` helper if the duplication is ugly).
- **`lib.rs`** — Register the three commands, add a setup hook that calls `start_run_history_watch`. No other changes.

### Frontend (`apps/desktop/src/`)

- **`features/run/saveFileSubscription.ts`** (new) — `setupSaveFileSubscription(dispatch)`. Mirrors `gameStateSubscription.ts` from PR #71. Does: (1) startup backfill from `list_run_history`, (2) Tauri-subscribe to `"run-completed"`, (3) arm the watcher via `start_run_history_watch`.
- **`features/run/runAnalyticsListener.ts`** — Modified. Start-of-run path swaps `generateRunId()` for `get_active_run_identifier()` with retry-then-fallback. MP path untouched.
- **`features/run/should-resume-run.ts`** — Simplified. New logic: if the active save's `start_time` equals a persisted `runId`, resume. The character/ascension/floor/act/deck heuristic is retired once the canonical path proves reliable.
- **`features/run/runSlice.ts`** — Add `runIdSource: 'save_file' | 'client_fallback' | null` to `RunData`. Plumb through reducers and selectors.
- **`lib/run-sync-queue.ts`** (new) — `queueRunSync()` / `drainPendingRunSyncs()` — a tiny localStorage-backed retry queue. Callers send via the existing `evaluationApi.endpoints.startRun` / `endRun` mutations (no new API client abstraction); the queue absorbs offline-then-online cycles for both backfill and live paths.
- **`store/store.ts`** — Register `setupSaveFileSubscription` alongside existing listener setups.

### Backend (`apps/web/`)

- **`api/run/route.ts`** — Add `runIdSource?: 'save_file' | 'client_fallback'` to both Zod schemas. Write through to `runs.run_id_source`.
- **Supabase migration** — Add `run_id_source TEXT` column, nullable. NULL on existing rows (= legacy).

## Data Flow

### 1. App boot / startup backfill

```
store.ts
  → setupSaveFileSubscription(dispatch)
    → invoke('start_run_history_watch')
    → lastSynced = localStorage.lastSyncedStartTime ?? 0
    → listing = await invoke('list_run_history', { after: lastSynced })
    → drainPendingRunSyncs()           // flush offline queue first
    → for each entry in listing.entries (ascending start_time):
        await postRunStart({
          runId: String(entry.start_time),
          runIdSource: 'save_file',
          character: entry.character,
          ascension: entry.ascension,
          gameMode: entry.players_count > 1 ? 'multiplayer' : 'singleplayer',
        })
        await postRunEnd({
          runId: String(entry.start_time),
          victory: entry.win,
          actReached: entry.act_reached,
          causeOfDeath: entry.killed_by_encounter === 'NONE.NONE'
            ? null
            : entry.killed_by_encounter,
          runIdSource: 'save_file',
        })
        localStorage.lastSyncedStartTime = entry.start_time
```

Sequential, not parallel. Typical case is 0-2 missed runs; 114-entry first-run case finishes in seconds.

### 2. New run starts

```
runAnalyticsListener (first menu → in-run transition of the game_state stream)
  → active = await invokeWithRetry('get_active_run_identifier', retries=3, delayMs=3000)
  → if (active) {
      runId = String(active.start_time)
      source = 'save_file'
    } else {
      runId = `run_${Date.now()}_${randSuffix()}`
      source = 'client_fallback'
    }
  → dispatch(runStarted({ runId, character, ascension, gameMode, runIdSource: source }))
  → postRunStart({ runId, character, ascension, gameMode, runIdSource: source })
```

### 3. SP run ends (history watcher fires)

```
save_watcher.rs (notify: new file at history/<ts>.run)
  → summary = parse_run_file(path)
  → app.emit("run-completed", summary)

saveFileSubscription.ts
  → on "run-completed":
      runId = String(summary.start_time)
      dispatch(outcomeConfirmed({ runId, victory: summary.win }))  // idempotent
      postRunEnd({
        runId,
        victory: summary.win,
        actReached: summary.act_reached,
        causeOfDeath: summary.killed_by_encounter === 'NONE.NONE' ? null : summary.killed_by_encounter,
        runIdSource: 'save_file',
      })
      localStorage.lastSyncedStartTime = max(current, summary.start_time)
```

### 4. MP run ends

Unchanged. `inferRunOutcome` + the existing menu-transition handler in `runAnalyticsListener.ts` continue to fire. Phase 3 owns MP.

### 5. App closed mid-run-end

Covered by (1). On next launch, the startup scan finds any `history/` entries with `start_time > lastSyncedStartTime` and replays the same POSTs the watcher would have sent. No special-case code.

### Idempotency

- `outcomeConfirmed` reducer already guards on `pendingOutcome` / existing `lastCompletedRun`. Second dispatch for the same runId is a no-op.
- `/api/run` `action: "start"` is an upsert keyed on `run_id`. Second POST is safe.
- `/api/run` `action: "end"` is an UPDATE keyed on `run_id`. Second POST rewrites the same data.

So if the watcher and `inferRunOutcome` both fire for the same SP run (shouldn't happen; could in exotic edge cases), nothing breaks.

## Error Handling

Everything degrades to today's behavior rather than breaking the app.

### Save directory not found / UnifiedSavePath missing / permissions error

- `resolve_saves_dir()` returns `Err(SaveError::NotFound)`.
- `get_active_run_identifier` returns `None` → frontend falls back to `client_fallback`.
- `list_run_history` returns empty vec → startup backfill is a no-op.
- `start_run_history_watch` logs once at `warn!` and returns `Err(...)` that the frontend ignores after logging.
- One Sentry report per app lifetime via `reportError("save_reader_unavailable", ...)`.

### Individual save file fails to parse

- `parse_run_file` returns `Err(SaveError::Parse { path, schema_version, source })`.
- Watcher logs and skips the file; does NOT tear down. `list_run_history` returns the skipped count for frontend logging.
- Rate-limited Sentry report keyed on `schema_version`, mirroring the `reportedValidationErrors` Set pattern in `gameStateApi.ts`.
- Schema version guard: `#[serde(default)]` on everything except the five load-bearing fields. New/renamed fields in future schema versions don't break parsing.

### `notify` watcher errors

- Supervisor from PR #71: `tokio::spawn` + `JoinHandle::await`, respawn on panic with 1s backoff. `save_watcher.rs` reuses the pattern — factor out a `supervise_task` helper if duplication feels bad.

### POST failures (offline, 5xx, auth expired)

- `postRunStart` / `postRunEnd` try once; on failure, queue in `localStorage.pendingRunSyncs`.
- Next app boot drains the queue BEFORE the fresh `list_run_history` scan. Ordering preserved.
- Cap `pendingRunSyncs` at 100 entries; drop oldest and log if exceeded.

### Active save file reports unknown `start_time`, no matching pending entry

- Treat as a new run. This is the normal path.

### Explicit non-goals

- No auto-healing of existing `victory=null` DB rows. A follow-up task can add that once we know which matching rules are safe.
- No MP-specific error paths. Phase 3.
- No UI surfacing of `runIdSource`. Stats/settings views can differentiate later if needed.

## Testing

### Rust (`apps/desktop/src-tauri/`)

- **`save_file.rs`** — Unit tests against fixtures. Commit 3-4 anonymized `.run` samples to `src-tauri/tests/fixtures/`: an SP win (schema 9), an SP death, an SP abandon, an active MP save (schema 16, `len(players) > 1`). Assert parsed `RunSummary` matches expected. Add a deliberately-corrupt file and one with unknown `schema_version` to exercise error paths.
- **`save_dir.rs`** — Unit tests for macOS + Windows path resolution using env-injected fake `HOME` / `APPDATA`. No real filesystem reads.
- **`save_watcher.rs`** — Integration test: `tempfile::TempDir`, spawn the watcher against it, drop a file into `history/`, assert event fires within 500ms.

### Frontend (`apps/desktop/src/`)

- **`saveFileSubscription.test.ts`** — Mirror `gameStateSubscription.test.ts` from PR #71. Mock `@tauri-apps/api/core` and `@tauri-apps/api/event`. Assert: startup scan POSTs `start+end` per entry, subscribes to `"run-completed"`, event triggers `outcomeConfirmed` + posts.
- **`runAnalyticsListener.test.ts`** — New cases for `get_active_run_identifier` retry-then-fallback: (a) success first try, (b) null for 3 retries → client fallback, (c) success on retry 2.
- **`should-resume-run.test.ts`** — Replace heuristic tests with: active save `start_time` matches persisted `runId` → resume; mismatch or no active save → don't.

### Backend (`apps/web/`)

- **`api/run/route.test.ts`** — Add cases for the new `runIdSource` field flowing through to the DB on both start and end actions.
- **Migration test** — adds the column, existing rows have NULL, indexes unchanged.

### Manual smoke (gate to merge)

1. Win an SP run → watcher fires, DB row appears with `run_id = <start_time>`, `run_id_source = 'save_file'`, `victory = true`.
2. Die in an SP run → same, `victory = false`.
3. Abandon → same, `victory = false`, `was_abandoned` captured in the existing `notes` field for v1 (e.g. `"save_file: abandoned"`). A dedicated column can come later if stats views need to filter on it.
4. Close app mid-run-end → restart → startup scan POSTs the missed entry.
5. MP run ends → still goes through the old `inferRunOutcome` path, new watcher doesn't double-fire.
6. Revoke save file permissions (`chmod 000` on `saves/`) → new SP run uses `client_fallback`, app doesn't crash.

### Non-coverage

- No automated test for UnifiedSavePath absent vs. present. Environmental. Call out in the manual smoke checklist that it runs on a known-good setup.

## Follow-ups Tracked Elsewhere

- Phase 3 — MP run tracking (helper-side parallel history record; MCP-live-state-driven end-of-run detection).
- Auto-healing of existing `victory=null` DB rows by cross-referencing `history/`.
- UI surfacing of `run_id_source` in stats/settings views.
- GET `/api/runs` endpoint for server-driven sync (currently helper reads the DB via Supabase client to do diffs — not needed for this phase since we're not backfilling, but useful for the cross-device story later).
- Opt-in "Sync historical runs from disk" Settings action — would post the 114+ orphans as `save_file` rows, accepting potential duplicates with existing `legacy_client` rows.
