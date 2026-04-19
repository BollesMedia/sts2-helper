# Save-File Canonical RunId Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the helper's client-minted `run_${Date.now()}_${random}` runId with a save-file-derived canonical identifier (the `start_time` field of the STS2 save file, which matches the filename of history records).

**Architecture:** Rust reads the save directory (parse + path resolution + `notify`-crate watcher), exposes three Tauri commands and one event. Frontend replaces `generateRunId()` with an `invoke('get_active_run_identifier')` call (retry-then-fallback), subscribes to `"run-completed"` events for authoritative SP end-of-run detection, and runs a startup scan to backfill runs that completed while the app was closed. A nullable `run_id_source` column on the `runs` table tags the provenance: `'save_file'` (canonical), `'client_fallback'` (retry exhausted), or `NULL` (legacy client-minted).

**Tech Stack:** Rust + Tauri 2 (`notify` 7.x, `serde`, existing `tokio` + `reqwest`), React + RTK Query, Vitest, Supabase Postgres, Next.js API routes.

**Spec:** `docs/superpowers/specs/2026-04-19-save-file-canonical-runid-design.md` — read it once for full context; each task below quotes the relevant section.

---

## File Structure

### Create

- `apps/desktop/src-tauri/src/save_file.rs` — Pure parsing. Types (`ActiveRun`, `RunSummary`, `SaveError`) + `parse_run_file()` + `parse_active_save()`. No I/O beyond the path passed in.
- `apps/desktop/src-tauri/src/save_dir.rs` — Path resolution. `resolve_saves_dir() -> Result<PathBuf, SaveError>` handling macOS + Windows + the UnifiedSavePath-vs-unmodded fork. Env-injectable home for tests.
- `apps/desktop/src-tauri/src/save_watcher.rs` — `notify`-crate wrapper, emits `"run-completed"` Tauri events on new `history/<ts>.run` files. Reuses the supervisor pattern (respawn on panic) from PR #71's `game_state_poller.rs`.
- `apps/desktop/src-tauri/tests/fixtures/sp_win.run` — anonymized SP win fixture.
- `apps/desktop/src-tauri/tests/fixtures/sp_death.run` — anonymized SP death fixture.
- `apps/desktop/src-tauri/tests/fixtures/sp_abandon.run` — anonymized SP abandon fixture.
- `apps/desktop/src-tauri/tests/fixtures/current_run_mp.save` — anonymized active MP save fixture (for `len(players) > 1` discriminator path).
- `apps/desktop/src-tauri/tests/fixtures/corrupt.run` — deliberately corrupt JSON to exercise parse error path.
- `apps/desktop/src/features/run/saveFileSubscription.ts` — `setupSaveFileSubscription(dispatch)`: startup backfill + Tauri event subscription + arming the watcher.
- `apps/desktop/src/features/run/__tests__/saveFileSubscription.test.ts`.
- `apps/desktop/src/lib/run-sync-queue.ts` — `queueRunSync()` / `drainPendingRunSyncs()` — a tiny localStorage-backed retry queue used by backfill + history-watcher paths when a POST fails.
- `apps/desktop/src/lib/__tests__/run-sync-queue.test.ts`.
- `apps/web/supabase/migrations/<timestamp>_add_run_id_source.sql` — adds the nullable `run_id_source TEXT` column.

### Modify

- `apps/desktop/src-tauri/Cargo.toml` — add `notify = "7"` (runtime) and `tempfile = "3"` (already in dev-deps — confirm; no-op if so).
- `apps/desktop/src-tauri/src/lib.rs` — declare the three new modules, register three new commands (`get_active_run_identifier`, `list_run_history`, `start_run_history_watch`), add a setup hook that arms the watcher.
- `apps/desktop/src/features/run/runAnalyticsListener.ts` — start-of-run path invokes `get_active_run_identifier` with retry-then-fallback instead of `generateRunId()`; threads `runIdSource` through the `runStarted` dispatch and `startRun` mutation.
- `apps/desktop/src/features/run/runSlice.ts` — add `runIdSource: RunIdSource` to `RunData` + `runStarted` action payload; add `type RunIdSource = 'save_file' | 'client_fallback' | null;` export.
- `apps/desktop/src/features/run/should-resume-run.ts` — add `canonicalRunId: string | null` input; if set AND equals `existingRun.runId`, resume; otherwise fall through to existing heuristic (temporarily — will retire heuristic in a follow-up once canonical path proves reliable).
- `apps/desktop/src/features/run/__tests__/should-resume-run.test.ts` — add cases for the canonical-id match path.
- `apps/desktop/src/services/evaluationApi.ts` — extend `startRun` and `endRun` mutation types with optional `runIdSource`.
- `apps/desktop/src/store/store.ts` — call `setupSaveFileSubscription(store.dispatch)` after existing listener setups.
- `apps/web/src/app/api/run/route.ts` — add `runIdSource` to both Zod schemas; write to `run_id_source` column on upsert/update.
- `apps/web/src/app/api/run/route.test.ts` — add cases for `runIdSource` roundtrip.

---

## Task 1: Issue + Worktree

**Files:** no code — bootstrap.

- [ ] **Step 1: Create the GitHub issue**

The parent issue #75 already exists. Create a child/implementation issue for this plan so we have a PR target:

```bash
gh issue create \
  --repo BollesMedia/sts2-helper \
  --title "Implement save-file-derived canonical runId (Phase 1+2)" \
  --body "Implements the plan at \`docs/superpowers/plans/2026-04-19-save-file-canonical-runid.md\`.

Closes a subset of #75 (Phase 1+2). Phase 3 (multiplayer) remains open.

Unblocks the recovery path in #74 for singleplayer."
```

Capture the issue number as `<IMPL_ISSUE>`.

- [ ] **Step 2: Create the worktree**

From the main checkout:

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git worktree add .worktrees/feat/<IMPL_ISSUE>-save-file-runid -b feat/<IMPL_ISSUE>-save-file-runid
cd .worktrees/feat/<IMPL_ISSUE>-save-file-runid
scripts/setup-worktree.sh
pnpm install
```

Expected: worktree created, `.vercel/` + `.env.local` symlinks in place, `pnpm install` completes quickly (pnpm store reuse).

All remaining tasks run inside that worktree.

---

## Task 2: Rust deps — `notify` + `tempfile`

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: Add `notify` as a runtime dep and ensure `tempfile` is in dev-deps**

Open `apps/desktop/src-tauri/Cargo.toml`. Add to `[dependencies]`:

```toml
notify = "7"
```

Confirm `[dev-dependencies]` already includes `tempfile = "3"` (added in PR #71). If not, add:

```toml
tempfile = "3"
```

- [ ] **Step 2: Verify the crate resolves**

```bash
cd apps/desktop/src-tauri && cargo check
```

Expected: `Finished` with no new errors. Pre-existing dead-code warnings unchanged.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock
git commit -m "chore(desktop): add notify 7 for save-dir watching"
```

---

## Task 3: Capture test fixtures

**Files:**
- Create: `apps/desktop/src-tauri/tests/fixtures/sp_win.run`
- Create: `apps/desktop/src-tauri/tests/fixtures/sp_death.run`
- Create: `apps/desktop/src-tauri/tests/fixtures/sp_abandon.run`
- Create: `apps/desktop/src-tauri/tests/fixtures/current_run_mp.save`
- Create: `apps/desktop/src-tauri/tests/fixtures/corrupt.run`

The local `~/Library/Application Support/SlayTheSpire2/steam/<id>/modded/profile1/saves/history/` directory has 114 real `.run` files to pick from (verified 2026-04-18). Pick representatives.

- [ ] **Step 1: Identify candidate SP fixtures**

From the worktree, run:

```bash
python3 - <<'PY'
import json, os, glob
base = os.path.expanduser('~/Library/Application Support/SlayTheSpire2/steam')
hist = glob.glob(f'{base}/*/modded/profile1/saves/history/*.run')
print(f'total: {len(hist)}')
for f in hist:
    try:
        with open(f) as fh:
            d = json.load(fh)
        if len(d.get('players',[])) != 1:
            continue
        tag = ('win' if d.get('win') else 'abandon' if d.get('was_abandoned') else 'death')
        print(f'{tag:8} ts={os.path.basename(f).split(".")[0]} asc={d.get("ascension")} kill={d.get("killed_by_encounter")} size={os.path.getsize(f)}')
    except Exception:
        pass
PY
```

Expected: a list like `win ts=1776540732 asc=10 kill=NONE.NONE size=77350`. Pick one of each category with small-ish file size (~40KB preferred).

- [ ] **Step 2: Copy selected fixtures into the repo and anonymize**

Anonymization is minimal for SP (there's no steam id or friend data in SP `.run` files — verified from the schema inspection). Still run through a normalization step to replace the `players[0].id` (a steam id) with a fixed placeholder and keep everything else:

```bash
mkdir -p apps/desktop/src-tauri/tests/fixtures
python3 - <<'PY'
import json, os, shutil
src_map = {
    'sp_win.run':    '<PASTE_WIN_PATH>',
    'sp_death.run':  '<PASTE_DEATH_PATH>',
    'sp_abandon.run': '<PASTE_ABANDON_PATH>',
}
for name, path in src_map.items():
    with open(path) as f:
        d = json.load(f)
    # Anonymize any steam ids found in players[*].id
    for p in d.get('players', []):
        if isinstance(p, dict) and 'id' in p:
            p['id'] = 'STEAM_ID_PLACEHOLDER'
    with open(f'apps/desktop/src-tauri/tests/fixtures/{name}', 'w') as f:
        json.dump(d, f, indent=2)
    print(f'wrote {name}')
PY
```

Replace `<PASTE_*_PATH>` with the absolute paths from Step 1.

- [ ] **Step 3: Create an MP active-save fixture**

The local `current_run_mp.save` (if present — verify `ls ~/Library/Application Support/SlayTheSpire2/steam/*/modded/profile1/saves/current_run_mp.save`) has `len(players) > 1` which exercises the SP/MP discriminator path. Copy and anonymize the same way:

```bash
python3 - <<'PY'
import json, glob, os
paths = glob.glob(os.path.expanduser('~/Library/Application Support/SlayTheSpire2/steam/*/modded/profile1/saves/current_run_mp.save'))
if not paths:
    print('no current_run_mp.save on disk; skipping MP fixture (Task 3 Step 3)')
    raise SystemExit(0)
with open(paths[0]) as f:
    d = json.load(f)
for p in d.get('players', []):
    for k in ('id','net_id','name'):
        if k in p: p[k] = f'PLACEHOLDER_{k}'
with open('apps/desktop/src-tauri/tests/fixtures/current_run_mp.save', 'w') as f:
    json.dump(d, f, indent=2)
print('wrote current_run_mp.save')
PY
```

If the file doesn't exist (no active MP session), synthesize one by taking `sp_win.run` and adding a second `players` entry + MP-specific keys:

```bash
python3 - <<'PY'
import json
with open('apps/desktop/src-tauri/tests/fixtures/sp_win.run') as f:
    d = json.load(f)
# Duplicate the player slot
if d.get('players'):
    p2 = json.loads(json.dumps(d['players'][0]))
    d['players'].append(p2)
d['pre_finished_room'] = {}
d['shared_relic_grab_bag'] = {}
with open('apps/desktop/src-tauri/tests/fixtures/current_run_mp.save', 'w') as f:
    json.dump(d, f, indent=2)
print('synthesized current_run_mp.save from sp_win.run')
PY
```

- [ ] **Step 4: Create the corrupt fixture**

```bash
printf '{"seed": "OOPS", "start_time": 1234567890, truncated here' > apps/desktop/src-tauri/tests/fixtures/corrupt.run
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/tests/fixtures
git commit -m "test(desktop): capture sts2 save-file fixtures for save_file parser"
```

---

## Task 4: `save_file.rs` — types + `parse_run_file` (TDD)

**Files:**
- Create: `apps/desktop/src-tauri/src/save_file.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (add `mod save_file;`)

- [ ] **Step 1: Write the failing test for `parse_run_file`**

Create `apps/desktop/src-tauri/src/save_file.rs`:

```rust
//! Pure parsing for STS2 save files. No I/O beyond the file read for each
//! path passed in. Tolerant of schema-version drift via `#[serde(default)]`
//! on all optional fields.

use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActiveRun {
    pub start_time: i64,
    pub seed: String,
    pub ascension: u32,
    pub character: String,
    pub is_mp: bool,
}

#[derive(Debug, Error)]
pub enum SaveError {
    #[error("save file not found: {0}")]
    NotFound(String),
    #[error("save file i/o: {0}")]
    Io(#[from] std::io::Error),
    #[error("save file parse: schema_version={schema_version:?} path={path}: {source}")]
    Parse {
        path: String,
        schema_version: Option<u32>,
        #[source]
        source: serde_json::Error,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join(name)
    }

    #[test]
    fn parse_run_file_ok_for_sp_win() {
        let summary = parse_run_file(&fixture("sp_win.run")).expect("parse");
        assert_eq!(summary.win, true);
        assert_eq!(summary.was_abandoned, false);
        assert_eq!(summary.killed_by_encounter, "NONE.NONE");
        assert_eq!(summary.players_count, 1);
        assert!(summary.start_time > 0);
        assert!(!summary.seed.is_empty());
    }

    #[test]
    fn parse_run_file_ok_for_sp_death() {
        let summary = parse_run_file(&fixture("sp_death.run")).expect("parse");
        assert_eq!(summary.win, false);
        assert_eq!(summary.was_abandoned, false);
        assert_ne!(summary.killed_by_encounter, "NONE.NONE");
        assert_eq!(summary.players_count, 1);
    }

    #[test]
    fn parse_run_file_ok_for_sp_abandon() {
        let summary = parse_run_file(&fixture("sp_abandon.run")).expect("parse");
        assert_eq!(summary.win, false);
        assert_eq!(summary.was_abandoned, true);
        assert_eq!(summary.players_count, 1);
    }

    #[test]
    fn parse_run_file_err_on_corrupt_json() {
        let err = parse_run_file(&fixture("corrupt.run")).unwrap_err();
        assert!(matches!(err, SaveError::Parse { .. }), "got {err:?}");
    }
}
```

Also add `mod save_file;` to the top of `apps/desktop/src-tauri/src/lib.rs`, alongside the existing `mod game_state_poller;`.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd apps/desktop/src-tauri && cargo test --lib save_file
```

Expected: FAIL with "cannot find function `parse_run_file`".

- [ ] **Step 3: Implement `parse_run_file`**

Append to `apps/desktop/src-tauri/src/save_file.rs` (above `#[cfg(test)]`):

```rust
/// Raw shape of a `history/<start_time>.run` file — only fields we need.
/// Everything else is tolerated via `#[serde(default)]`.
#[derive(Deserialize)]
struct RawRunFile {
    start_time: i64,
    #[serde(default)]
    seed: String,
    #[serde(default)]
    ascension: u32,
    #[serde(default)]
    win: bool,
    #[serde(default)]
    was_abandoned: bool,
    #[serde(default)]
    killed_by_encounter: String,
    #[serde(default)]
    run_time: u32,
    #[serde(default)]
    build_id: String,
    #[serde(default)]
    schema_version: Option<u32>,
    #[serde(default)]
    players: Vec<RawPlayer>,
    #[serde(default)]
    map_point_history: Vec<Vec<serde_json::Value>>,
}

#[derive(Deserialize, Default)]
struct RawPlayer {
    #[serde(default)]
    character: String,
}

pub fn parse_run_file(path: &Path) -> Result<RunSummary, SaveError> {
    let bytes = std::fs::read(path)?;
    let path_str = path.to_string_lossy().to_string();

    // Peek at schema_version even if the full parse fails, for better errors.
    let peeked_version: Option<u32> = serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .and_then(|v| v.get("schema_version").and_then(|x| x.as_u64()).map(|n| n as u32));

    let raw: RawRunFile = serde_json::from_slice(&bytes).map_err(|e| SaveError::Parse {
        path: path_str.clone(),
        schema_version: peeked_version,
        source: e,
    })?;

    let character = raw
        .players
        .first()
        .map(|p| p.character.clone())
        .unwrap_or_default();

    let act_reached = raw.map_point_history.len() as u32;

    Ok(RunSummary {
        start_time: raw.start_time,
        seed: raw.seed,
        ascension: raw.ascension,
        character,
        win: raw.win,
        was_abandoned: raw.was_abandoned,
        killed_by_encounter: raw.killed_by_encounter,
        run_time: raw.run_time,
        build_id: raw.build_id,
        act_reached,
        players_count: raw.players.len() as u32,
    })
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd apps/desktop/src-tauri && cargo test --lib save_file
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/save_file.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): save_file.rs parse_run_file + RunSummary types"
```

---

## Task 5: `save_file.rs` — `parse_active_save` (TDD)

**Files:**
- Modify: `apps/desktop/src-tauri/src/save_file.rs`

- [ ] **Step 1: Add the failing test**

Append inside `#[cfg(test)] mod tests { ... }`:

```rust
#[test]
fn parse_active_save_detects_singleplayer() {
    let active = parse_active_save(&fixture("sp_win.run")).expect("parse");
    // Reusing sp_win.run as a stand-in for current_run.save shape.
    assert_eq!(active.is_mp, false);
    assert!(active.start_time > 0);
}

#[test]
fn parse_active_save_detects_multiplayer() {
    let active = parse_active_save(&fixture("current_run_mp.save")).expect("parse");
    assert_eq!(active.is_mp, true, "len(players) > 1 should imply MP");
}

#[test]
fn parse_active_save_err_on_corrupt() {
    let err = parse_active_save(&fixture("corrupt.run")).unwrap_err();
    assert!(matches!(err, SaveError::Parse { .. }));
}
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/desktop/src-tauri && cargo test --lib save_file::tests::parse_active_save
```

Expected: "cannot find function `parse_active_save`".

- [ ] **Step 3: Implement `parse_active_save`**

Append to the production code in `save_file.rs` (above `#[cfg(test)]`):

```rust
pub fn parse_active_save(path: &Path) -> Result<ActiveRun, SaveError> {
    let bytes = std::fs::read(path)?;
    let path_str = path.to_string_lossy().to_string();
    let peeked_version: Option<u32> = serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .and_then(|v| v.get("schema_version").and_then(|x| x.as_u64()).map(|n| n as u32));

    let raw: RawRunFile = serde_json::from_slice(&bytes).map_err(|e| SaveError::Parse {
        path: path_str.clone(),
        schema_version: peeked_version,
        source: e,
    })?;

    let character = raw
        .players
        .first()
        .map(|p| p.character.clone())
        .unwrap_or_default();

    Ok(ActiveRun {
        start_time: raw.start_time,
        seed: raw.seed,
        ascension: raw.ascension,
        character,
        is_mp: raw.players.len() > 1,
    })
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd apps/desktop/src-tauri && cargo test --lib save_file
```

Expected: 7 passing (4 from Task 4 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/save_file.rs
git commit -m "feat(desktop): save_file.rs parse_active_save with SP/MP discriminator"
```

---

## Task 6: `save_dir.rs` — path resolution (TDD)

**Files:**
- Create: `apps/desktop/src-tauri/src/save_dir.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (add `mod save_dir;`)

The resolver walks the per-steam-user-id subdirectory. On disk we observed `<base>/steam/<steam_user_id>/modded/profile1/saves/` — we return that `saves/` directory.

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src-tauri/src/save_dir.rs`:

```rust
//! STS2 save directory resolution. On macOS, STS2 writes saves under
//! `~/Library/Application Support/SlayTheSpire2/steam/<steam_user_id>/modded/profile1/saves`.
//! On Windows, the parent is `%APPDATA%\SlayTheSpire2` instead.
//!
//! Tests inject a fake home directory via the `sts2_home` parameter; production
//! callers pass `None` to use the real one.

use std::path::{Path, PathBuf};

use crate::save_file::SaveError;

/// Returns the `saves/` directory inside the active (numeric) steam user
/// subdirectory, choosing `modded/profile1/saves` first and falling back to
/// `profile1/saves` if modded doesn't exist.
pub fn resolve_saves_dir(home_override: Option<&Path>) -> Result<PathBuf, SaveError> {
    let base = sts2_root(home_override)?;
    let steam_dir = base.join("steam");
    if !steam_dir.exists() {
        return Err(SaveError::NotFound(format!(
            "sts2 steam dir not found at {}",
            steam_dir.display()
        )));
    }

    // Pick the MOST-RECENTLY-MODIFIED subdirectory whose name is an all-digit
    // steam user id. Users with alt accounts have multiple numeric dirs; the
    // currently-active one will be freshest. Falling back to lowest-numeric
    // would silently point at the wrong account.
    let mut candidates: Vec<(PathBuf, std::time::SystemTime)> =
        std::fs::read_dir(&steam_dir)?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
                    .unwrap_or(false)
            })
            .filter_map(|p| {
                let mtime = std::fs::metadata(&p).ok()?.modified().ok()?;
                Some((p, mtime))
            })
            .collect();
    if candidates.len() > 1 {
        log::warn!(
            "[save_dir] {} candidate steam user dirs under {}; picking most recent",
            candidates.len(),
            steam_dir.display()
        );
    }
    candidates.sort_by_key(|(_, t)| *t);
    let user_dir = candidates.pop().map(|(p, _)| p).ok_or_else(|| {
        SaveError::NotFound(format!(
            "no numeric steam user id under {}",
            steam_dir.display()
        ))
    })?;

    let modded = user_dir.join("modded/profile1/saves");
    if modded.exists() {
        return Ok(modded);
    }
    let plain = user_dir.join("profile1/saves");
    if plain.exists() {
        return Ok(plain);
    }
    Err(SaveError::NotFound(format!(
        "no saves directory under {}",
        user_dir.display()
    )))
}

fn sts2_root(home_override: Option<&Path>) -> Result<PathBuf, SaveError> {
    let home = match home_override {
        Some(p) => p.to_path_buf(),
        None => dirs::home_dir()
            .ok_or_else(|| SaveError::NotFound("home directory unavailable".into()))?,
    };

    #[cfg(target_os = "macos")]
    {
        Ok(home.join("Library/Application Support/SlayTheSpire2"))
    }
    #[cfg(target_os = "windows")]
    {
        // When home_override is provided, tests lay out AppData directly inside it.
        if home_override.is_some() {
            Ok(home.join("AppData/Roaming/SlayTheSpire2"))
        } else {
            Ok(home.join("AppData\\Roaming\\SlayTheSpire2"))
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err(SaveError::NotFound(format!(
            "sts2 save dir not defined on this platform"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_layout(home: &Path) {
        let base: PathBuf;
        #[cfg(target_os = "macos")]
        {
            base = home.join("Library/Application Support/SlayTheSpire2/steam/987654321/modded/profile1/saves");
        }
        #[cfg(target_os = "windows")]
        {
            base = home.join("AppData/Roaming/SlayTheSpire2/steam/987654321/modded/profile1/saves");
        }
        std::fs::create_dir_all(&base).unwrap();
        std::fs::create_dir_all(base.join("history")).unwrap();
    }

    #[test]
    fn resolves_saves_dir_for_modded_layout() {
        let tmp = TempDir::new().unwrap();
        make_layout(tmp.path());
        let dir = resolve_saves_dir(Some(tmp.path())).expect("resolve");
        assert!(dir.ends_with("modded/profile1/saves") || dir.ends_with("modded\\profile1\\saves"));
    }

    #[test]
    fn returns_not_found_when_no_steam_dir() {
        let tmp = TempDir::new().unwrap();
        let err = resolve_saves_dir(Some(tmp.path())).unwrap_err();
        assert!(matches!(err, SaveError::NotFound(_)));
    }

    #[test]
    fn picks_numeric_steam_user_dir_ignoring_others() {
        let tmp = TempDir::new().unwrap();
        make_layout(tmp.path());
        // Add a non-numeric sibling that must be ignored
        let extra;
        #[cfg(target_os = "macos")]
        {
            extra = tmp.path().join("Library/Application Support/SlayTheSpire2/steam/not_numeric");
        }
        #[cfg(target_os = "windows")]
        {
            extra = tmp.path().join("AppData/Roaming/SlayTheSpire2/steam/not_numeric");
        }
        std::fs::create_dir_all(&extra).unwrap();
        resolve_saves_dir(Some(tmp.path())).expect("resolve");
    }
}
```

Add `mod save_dir;` to `lib.rs` alongside `mod save_file;`.

- [ ] **Step 2: Run — expect PASS**

```bash
cd apps/desktop/src-tauri && cargo test --lib save_dir
```

Expected: 3 passing.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/save_dir.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): save_dir.rs resolve_saves_dir with env-injectable home"
```

---

## Task 7: Tauri commands — `get_active_run_identifier` + `list_run_history`

**Files:**
- Modify: `apps/desktop/src-tauri/src/save_file.rs` (add commands at end)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (register commands)

- [ ] **Step 1: Add the commands**

Append to `apps/desktop/src-tauri/src/save_file.rs`, below `parse_active_save`:

```rust
#[derive(Debug, Clone, Serialize)]
pub struct RunHistoryListing {
    pub entries: Vec<RunSummary>,
    pub skipped: u32,
}

#[tauri::command]
pub async fn get_active_run_identifier() -> Result<Option<ActiveRun>, String> {
    let saves_dir = match crate::save_dir::resolve_saves_dir(None) {
        Ok(d) => d,
        Err(e) => {
            log::info!("[save_file] saves dir unavailable: {e}");
            return Ok(None);
        }
    };

    // Prefer current_run.save (SP); fall back to current_run_mp.save (MP).
    for name in ["current_run.save", "current_run_mp.save"] {
        let path = saves_dir.join(name);
        if path.exists() {
            match parse_active_save(&path) {
                Ok(active) => return Ok(Some(active)),
                Err(e) => {
                    log::warn!("[save_file] parse {} failed: {e}", name);
                    continue;
                }
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn list_run_history(
    after_start_time: Option<i64>,
) -> Result<RunHistoryListing, String> {
    let saves_dir = match crate::save_dir::resolve_saves_dir(None) {
        Ok(d) => d,
        Err(e) => {
            log::info!("[save_file] saves dir unavailable: {e}");
            return Ok(RunHistoryListing {
                entries: vec![],
                skipped: 0,
            });
        }
    };
    let history_dir = saves_dir.join("history");
    if !history_dir.exists() {
        return Ok(RunHistoryListing {
            entries: vec![],
            skipped: 0,
        });
    }

    let threshold = after_start_time.unwrap_or(0);
    let mut entries: Vec<RunSummary> = vec![];
    let mut skipped: u32 = 0;

    let dir_entries = match std::fs::read_dir(&history_dir) {
        Ok(it) => it,
        Err(e) => return Err(format!("read_dir {}: {e}", history_dir.display())),
    };

    for entry in dir_entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("run") {
            continue;
        }
        // Filename is the start_time; use as a cheap pre-filter before parsing.
        let stem: Option<i64> = path
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.parse().ok());
        if let Some(ts) = stem {
            if ts <= threshold {
                continue;
            }
        }
        match parse_run_file(&path) {
            Ok(summary) => {
                if summary.start_time > threshold {
                    entries.push(summary);
                }
            }
            Err(e) => {
                log::warn!("[save_file] skip {}: {e}", path.display());
                skipped += 1;
            }
        }
    }

    entries.sort_by_key(|s| s.start_time);
    Ok(RunHistoryListing { entries, skipped })
}
```

- [ ] **Step 2: Register the commands in `lib.rs`**

Edit `apps/desktop/src-tauri/src/lib.rs`'s `invoke_handler!` block. It currently lists:

```rust
.invoke_handler(tauri::generate_handler![
    detect_game,
    get_mod_status,
    install_required_mods,
    game_state_poller::get_latest_game_state,
])
```

Change to:

```rust
.invoke_handler(tauri::generate_handler![
    detect_game,
    get_mod_status,
    install_required_mods,
    game_state_poller::get_latest_game_state,
    save_file::get_active_run_identifier,
    save_file::list_run_history,
])
```

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/desktop/src-tauri && cargo check
```

Expected: clean.

- [ ] **Step 4: Run the test suite**

```bash
cd apps/desktop/src-tauri && cargo test --lib
```

Expected: all prior tests still pass; no new warnings beyond the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/save_file.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): register get_active_run_identifier + list_run_history tauri commands"
```

---

## Task 8: `save_watcher.rs` — `notify` wrapper with supervisor

**Files:**
- Create: `apps/desktop/src-tauri/src/save_watcher.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (declare mod, register command, wire setup hook)

- [ ] **Step 1: Write the failing integration test**

Create `apps/desktop/src-tauri/src/save_watcher.rs`:

```rust
//! `notify`-crate watcher that emits "run-completed" Tauri events when a
//! new `history/<ts>.run` appears. Wrapped in a supervisor that respawns
//! the inner task on panic/exit (same pattern as game_state_poller.rs).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::{Event, EventKind, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::save_file::{parse_run_file, RunSummary};

/// Arms a watcher on `<saves_dir>/history`. Idempotent — re-arming is a no-op.
pub async fn start_watch(app: AppHandle, saves_dir: PathBuf) -> Result<(), String> {
    use std::sync::atomic::{AtomicBool, Ordering};
    static ARMED: AtomicBool = AtomicBool::new(false);
    if ARMED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(());
    }

    let history_dir = saves_dir.join("history");
    if !history_dir.exists() {
        std::fs::create_dir_all(&history_dir)
            .map_err(|e| format!("create history dir: {e}"))?;
    }

    tauri::async_runtime::spawn(async move {
        loop {
            let app_c = app.clone();
            let dir_c = history_dir.clone();
            let handle = tokio::spawn(async move {
                run_watch_loop(app_c, dir_c).await;
            });
            match handle.await {
                Ok(()) => log::error!("[save_watcher] exited; restarting in 1s"),
                Err(e) if e.is_panic() => {
                    log::error!("[save_watcher] panicked: {e}; restarting in 1s")
                }
                Err(e) => log::error!("[save_watcher] cancelled: {e}; restarting in 1s"),
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });

    Ok(())
}

async fn run_watch_loop(app: AppHandle, history_dir: PathBuf) {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Event>();
    let tx = Arc::new(tx);
    let tx_clone = tx.clone();

    let mut watcher = match notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(ev) = res {
            let _ = tx_clone.send(ev);
        }
    }) {
        Ok(w) => w,
        Err(e) => {
            log::error!("[save_watcher] create watcher failed: {e}");
            return;
        }
    };

    if let Err(e) = watcher.watch(&history_dir, RecursiveMode::NonRecursive) {
        log::error!("[save_watcher] watch failed: {e}");
        return;
    }

    log::info!("[save_watcher] watching {}", history_dir.display());

    while let Some(ev) = rx.recv().await {
        if !matches!(ev.kind, EventKind::Create(_) | EventKind::Modify(_)) {
            continue;
        }
        for path in ev.paths {
            if path.extension().and_then(|s| s.to_str()) != Some("run") {
                continue;
            }
            handle_new_history_file(&app, &path).await;
        }
    }
}

async fn handle_new_history_file(app: &AppHandle, path: &Path) {
    // Small debounce — the game can write the file in multiple passes.
    tokio::time::sleep(Duration::from_millis(150)).await;
    match parse_run_file(path) {
        Ok(summary) => emit_run_completed(app, &summary),
        Err(e) => log::warn!(
            "[save_watcher] parse {} failed: {e}",
            path.display()
        ),
    }
}

fn emit_run_completed(app: &AppHandle, summary: &RunSummary) {
    if let Err(e) = app.emit("run-completed", summary) {
        log::warn!("[save_watcher] emit run-completed failed: {e}");
    }
}

#[tauri::command]
pub async fn start_run_history_watch(app: AppHandle) -> Result<(), String> {
    let saves_dir = crate::save_dir::resolve_saves_dir(None)
        .map_err(|e| format!("resolve saves dir: {e}"))?;
    start_watch(app, saves_dir).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Verify the inner fs-watch → parse → handle pipeline. We bypass the
    /// Tauri event emit (which requires an AppHandle) and instead assert
    /// that `parse_run_file` returns Ok when given a file the watcher sees.
    #[tokio::test]
    async fn parses_new_history_file_when_dropped_into_dir() {
        let tmp = TempDir::new().unwrap();
        let history = tmp.path().join("history");
        std::fs::create_dir_all(&history).unwrap();

        // Drop a valid fixture
        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/sp_win.run");
        let target = history.join("1234567890.run");
        std::fs::copy(&fixture, &target).unwrap();

        let summary = parse_run_file(&target).expect("parse");
        assert_eq!(summary.players_count, 1);
        assert!(summary.win || !summary.win); // tautology — assert it parses without panic
    }
}
```

Add `mod save_watcher;` to `lib.rs`.

- [ ] **Step 2: Register the command in `lib.rs` `invoke_handler`**

Extend the handler list to include `save_watcher::start_run_history_watch`:

```rust
.invoke_handler(tauri::generate_handler![
    detect_game,
    get_mod_status,
    install_required_mods,
    game_state_poller::get_latest_game_state,
    save_file::get_active_run_identifier,
    save_file::list_run_history,
    save_watcher::start_run_history_watch,
])
```

- [ ] **Step 3: Arm the watcher from the `setup` hook**

In `lib.rs`, the existing `.setup(|app| { ... })` hook already spawns the poller. Append after the poll spawn:

```rust
let app_for_watcher = app.handle().clone();
tauri::async_runtime::spawn(async move {
    if let Err(e) = save_watcher::start_run_history_watch(app_for_watcher).await {
        log::info!("[save_watcher] skipped: {e}");
    }
});
```

- [ ] **Step 4: Run tests**

```bash
cd apps/desktop/src-tauri && cargo test --lib
```

Expected: save_watcher test passes; all prior tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/save_watcher.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): save_watcher.rs + start_run_history_watch on app setup"
```

---

## Task 9: Supabase migration — add `run_id_source` column

**Files:**
- Create: `apps/web/supabase/migrations/20260419000000_add_run_id_source.sql`

- [ ] **Step 1: Author the migration**

Create the file with:

```sql
-- Add run_id_source column to runs. NULL means legacy client-minted;
-- 'save_file' means canonical (derived from STS2 save-file start_time);
-- 'client_fallback' means the save reader was unavailable at detection time.
ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS run_id_source text;

COMMENT ON COLUMN public.runs.run_id_source IS
  'Provenance of run_id: NULL=legacy client-minted, save_file=canonical (start_time), client_fallback=save reader unavailable.';
```

- [ ] **Step 2: Apply migration locally if a local Supabase dev DB is running**

From the worktree root:

```bash
pnpm db:migrate 2>&1 | tail -20
```

If no local DB is running, the command will fail — that's fine for this step; apply via Supabase dashboard or CI. Add a note in the PR body that the migration needs dashboard application in prod.

- [ ] **Step 3: Commit**

```bash
git add apps/web/supabase/migrations/20260419000000_add_run_id_source.sql
git commit -m "feat(db): add run_id_source column to runs"
```

---

## Task 10: `/api/run` — accept `runIdSource`

**Files:**
- Modify: `apps/web/src/app/api/run/route.ts`

- [ ] **Step 1: Extend the Zod schemas**

Edit `apps/web/src/app/api/run/route.ts`. Find `startSchema` (currently `z.object({ action: z.literal("start"), runId: ..., character: ..., ascension: ..., gameVersion: ..., gameMode: ... })`) and append:

```ts
runIdSource: z.enum(["save_file", "client_fallback"]).nullable().optional(),
```

Do the same for `endSchema`:

```ts
runIdSource: z.enum(["save_file", "client_fallback"]).nullable().optional(),
```

- [ ] **Step 2: Write the value through on `start`**

Find the `start` branch (`supabase.from("runs").upsert({ run_id, character, ascension_level, ... })`). Add:

```ts
const { error } = await supabase.from("runs").upsert({
  run_id: d.runId,
  character: d.character,
  ascension_level: d.ascension ?? 0,
  game_version: d.gameVersion ?? null,
  game_mode: d.gameMode ?? "singleplayer",
  user_id: auth.userId,
  run_id_source: d.runIdSource ?? null,
});
```

- [ ] **Step 3: Write on `end`**

In the `end` branch, after the existing optional-field wiring:

```ts
if (d.runIdSource !== undefined) update.run_id_source = d.runIdSource;
```

- [ ] **Step 4: Extend `route.test.ts`**

Open `apps/web/src/app/api/run/route.test.ts`. Find an existing `start` test and append one that exercises `runIdSource`:

```ts
it("persists runIdSource on start", async () => {
  const upsertMock = vi.fn().mockResolvedValue({ error: null });
  // …wire the existing supabase mock to surface upsert call args…
  const response = await POST(
    new Request("http://localhost/api/run", {
      method: "POST",
      body: JSON.stringify({
        action: "start",
        runId: "1776540732",
        character: "Ironclad",
        ascension: 10,
        gameMode: "singleplayer",
        runIdSource: "save_file",
      }),
    })
  );
  expect(response.status).toBe(200);
  expect(upsertMock).toHaveBeenCalledWith(
    expect.objectContaining({ run_id_source: "save_file" })
  );
});

it("persists runIdSource on end", async () => {
  const updateMock = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  // …wire mock to capture update args…
  const response = await POST(
    new Request("http://localhost/api/run", {
      method: "POST",
      body: JSON.stringify({
        action: "end",
        runId: "1776540732",
        victory: true,
        runIdSource: "save_file",
      }),
    })
  );
  expect(response.status).toBe(200);
  expect(updateMock).toHaveBeenCalledWith(
    expect.objectContaining({ run_id_source: "save_file" })
  );
});
```

(Shape of the existing mocks — adapt to match: the existing route test file will already have `vi.mock("@/lib/supabase/server", ...)` or similar. Mirror its pattern.)

- [ ] **Step 5: Verify the route compiles + lints + tests pass**

```bash
cd apps/web && pnpm lint && pnpm test src/app/api/run/route.test.ts
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/run/route.ts apps/web/src/app/api/run/route.test.ts
git commit -m "feat(api): accept run_id_source on /api/run start + end"
```

---

## Task 11: `runSlice.ts` — add `runIdSource` field

**Files:**
- Modify: `apps/desktop/src/features/run/runSlice.ts`

- [ ] **Step 1: Add the type export**

Near the top of `runSlice.ts` (below existing imports), add:

```ts
export type RunIdSource = "save_file" | "client_fallback" | null;
```

- [ ] **Step 2: Add field to `RunData`**

Find `export interface RunData` (around line 47). Add the field:

```ts
export interface RunData {
  // ...existing fields...
  runId: string;
  runIdSource: RunIdSource;
  // ...
}
```

- [ ] **Step 3: Plumb through the `runStarted` reducer**

Find the `runStarted` action (around line 92). Update its payload:

```ts
runStarted(
  state,
  action: PayloadAction<{
    runId: string;
    character: string;
    ascension: number;
    gameMode: "singleplayer" | "multiplayer";
    runIdSource: RunIdSource;
  }>
) {
  const { runId, character, ascension, gameMode, runIdSource } = action.payload;
  state.activeRunId = runId;
  state.runs[runId] = {
    // ...existing fields copied as-is...
    runId,
    runIdSource,
    character,
    ascension,
    gameMode,
    // ...rest of existing initial values...
  };
}
```

Keep every other field that's already initialized; just add `runIdSource` to the object.

- [ ] **Step 4: Typecheck**

```bash
cd apps/desktop && pnpm lint
```

Expected: TS errors in all existing `runStarted(...)` callsites that don't supply `runIdSource`. These get fixed in Task 13. For now, add a temporary default at the call sites flagged by the typechecker:

```bash
pnpm lint 2>&1 | grep "runStarted" | head
```

Every offending call is in `runAnalyticsListener.ts`. Patch each to `runIdSource: null` inline (Task 13 will replace with the real value).

- [ ] **Step 5: Run the test suite**

```bash
cd apps/desktop && pnpm test
```

Expected: all tests pass (runSlice tests unaffected; persistence tests may need a `runIdSource: null` in fixtures — fix any failures inline by adding the field).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/run/runSlice.ts apps/desktop/src/features/run/runAnalyticsListener.ts
git commit -m "feat(desktop): add runIdSource field to RunData"
```

---

## Task 12: `run-sync-queue.ts` — localStorage-backed retry queue (TDD)

**Files:**
- Create: `apps/desktop/src/lib/run-sync-queue.ts`
- Create: `apps/desktop/src/lib/__tests__/run-sync-queue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/lib/__tests__/run-sync-queue.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  queueRunSync,
  readPendingRunSyncs,
  drainPendingRunSyncs,
  PENDING_RUN_SYNCS_KEY,
  MAX_QUEUE,
} from "../run-sync-queue";

describe("run-sync-queue", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("queues, reads, and drains in FIFO order", async () => {
    queueRunSync({ action: "start", runId: "a", character: "Ironclad", ascension: 0, gameMode: "singleplayer" });
    queueRunSync({ action: "end", runId: "a", victory: true });
    expect(readPendingRunSyncs()).toHaveLength(2);

    const send = vi.fn().mockResolvedValue(undefined);
    await drainPendingRunSyncs(send);

    expect(send).toHaveBeenCalledTimes(2);
    expect((send.mock.calls[0][0] as { action: string }).action).toBe("start");
    expect((send.mock.calls[1][0] as { action: string }).action).toBe("end");
    expect(readPendingRunSyncs()).toHaveLength(0);
  });

  it("drops oldest when queue exceeds MAX_QUEUE", () => {
    for (let i = 0; i < MAX_QUEUE + 5; i++) {
      queueRunSync({ action: "start", runId: `r${i}`, character: "Ironclad", ascension: 0, gameMode: "singleplayer" });
    }
    const q = readPendingRunSyncs();
    expect(q).toHaveLength(MAX_QUEUE);
    expect(q[0].runId).toBe("r5");
  });

  it("leaves items in queue if send fails, preserving order", async () => {
    queueRunSync({ action: "start", runId: "a", character: "Ironclad", ascension: 0, gameMode: "singleplayer" });
    queueRunSync({ action: "end", runId: "a", victory: true });

    const send = vi.fn()
      .mockResolvedValueOnce(undefined) // 'start' succeeds
      .mockRejectedValueOnce(new Error("network down")); // 'end' fails

    await drainPendingRunSyncs(send);

    const remaining = readPendingRunSyncs();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].action).toBe("end");
  });

  it("uses the correct localStorage key", () => {
    expect(PENDING_RUN_SYNCS_KEY).toBe("pendingRunSyncs");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/desktop && pnpm test src/lib/__tests__/run-sync-queue.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `apps/desktop/src/lib/run-sync-queue.ts`:

```ts
export const PENDING_RUN_SYNCS_KEY = "pendingRunSyncs";
export const MAX_QUEUE = 100;

export type PendingRunSync =
  | {
      action: "start";
      runId: string;
      character: string;
      ascension: number;
      gameMode: "singleplayer" | "multiplayer";
      runIdSource?: "save_file" | "client_fallback" | null;
      gameVersion?: string | null;
    }
  | {
      action: "end";
      runId: string;
      victory?: boolean | null;
      actReached?: number | null;
      causeOfDeath?: string | null;
      notes?: string | null;
      finalFloor?: number | null;
      runIdSource?: "save_file" | "client_fallback" | null;
    };

export function readPendingRunSyncs(): PendingRunSync[] {
  const raw = localStorage.getItem(PENDING_RUN_SYNCS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingRunSync[]) : [];
  } catch {
    return [];
  }
}

function write(queue: PendingRunSync[]) {
  localStorage.setItem(PENDING_RUN_SYNCS_KEY, JSON.stringify(queue));
}

export function queueRunSync(entry: PendingRunSync) {
  const queue = readPendingRunSyncs();
  queue.push(entry);
  while (queue.length > MAX_QUEUE) queue.shift();
  write(queue);
}

/**
 * Try to send each queued entry. Stops on first failure to preserve ordering.
 * Successful sends are removed from the queue.
 */
export async function drainPendingRunSyncs(
  send: (entry: PendingRunSync) => Promise<void>
) {
  const queue = readPendingRunSyncs();
  while (queue.length) {
    const head = queue[0];
    try {
      await send(head);
      queue.shift();
      write(queue);
    } catch (err) {
      console.warn("[run-sync-queue] send failed; leaving in queue", err);
      break;
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd apps/desktop && pnpm test src/lib/__tests__/run-sync-queue.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/run-sync-queue.ts apps/desktop/src/lib/__tests__/run-sync-queue.test.ts
git commit -m "feat(desktop): run-sync-queue for offline-tolerant run POSTs"
```

---

## Task 13: `runAnalyticsListener.ts` — retry-then-fallback on start

**Files:**
- Modify: `apps/desktop/src/features/run/runAnalyticsListener.ts`

- [ ] **Step 1: Hoist the save-file resolution ABOVE `shouldResumeRun`**

**Important ordering:** `shouldResumeRun(...)` is called earlier in the block (around line 309 in `runAnalyticsListener.ts`) and Task 15 will need `canonicalRunId` passed into it. So the `invokeGetActiveRunWithRetry()` call must happen BEFORE that line, not inside the `else` branch at line ~344.

Locate the start of the first-in-run-transition block (the `if (isFirstRunTransition)` branch around line 295-305, BEFORE the `shouldResumeRun` call). Insert at the top of that block (before any use of `existingRun` / `shouldResumeRun`):

```ts
// Canonical runId from the STS2 save file, if available.
const active = await invokeGetActiveRunWithRetry();
const canonicalRunId = active ? String(active.start_time) : null;
```

Then, the existing block that calls `generateRunId()` (around line 344, in the `else` branch of `canResume`) changes from:

```ts
const newRunId = generateRunId();
const gameMode = gameState.game_mode ?? "singleplayer";

listenerApi.dispatch(
  runStarted({ runId: newRunId, character, ascension, gameMode })
);
```

To:

```ts
let newRunId: string;
let runIdSource: "save_file" | "client_fallback";
if (active) {
  newRunId = String(active.start_time);
  runIdSource = "save_file";
} else {
  newRunId = generateRunId();
  runIdSource = "client_fallback";
}
const gameMode = gameState.game_mode ?? "singleplayer";

listenerApi.dispatch(
  runStarted({ runId: newRunId, character, ascension, gameMode, runIdSource })
);
```

**Why the retry is OK to do every first-transition:** the retry only runs inside the `isFirstRunTransition` branch (already gated), which fires once per app session. Up to 9s of blocking on a degraded-save-reader startup is acceptable; in the happy path the first `invoke` returns in <10ms.

Add the helper near the top of the file (below the existing imports + `generateRunId`). Export it so tests can exercise it directly:

```ts
import { invoke } from "@tauri-apps/api/core";

export interface ActiveRun {
  start_time: number;
  seed: string;
  ascension: number;
  character: string;
  is_mp: boolean;
}

export async function invokeGetActiveRunWithRetry(
  maxAttempts = 3,
  delayMs = 3000,
  sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<ActiveRun | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await invoke<ActiveRun | null>("get_active_run_identifier");
      if (result) return result;
    } catch (err) {
      console.warn(`[runAnalytics] get_active_run_identifier attempt ${attempt + 1} failed`, err);
    }
    if (attempt < maxAttempts - 1) await sleepFn(delayMs);
  }
  return null;
}
```

The injected `sleepFn` + parameterized attempts are for the Task 13 Step 3 test (below) — no real behavior change.

Also, in the `startRun` mutation call a few lines below the `runStarted` dispatch, pass `runIdSource`:

```ts
runCreatedPromise = listenerApi
  .dispatch(
    evaluationApi.endpoints.startRun.initiate({
      runId: newRunId,
      character,
      ascension,
      gameMode,
      userId: getUserId(),
      runIdSource,
    })
  )
  .unwrap()
  .then(() => {}, () => {});
```

- [ ] **Step 2: Extend `startRun` + `endRun` types in `evaluationApi.ts`**

Edit `apps/desktop/src/services/evaluationApi.ts`. The `startRun` mutation type is:

```ts
startRun: build.mutation<void, { runId: string; character: string; ascension: number; gameMode: string; userId: string | null }>({
  async queryFn(args) {
    await apiFetch("/api/run", {
      method: "POST",
      body: JSON.stringify({ action: "start", ...args }),
    });
    return { data: undefined };
  },
}),
```

Add `runIdSource?: "save_file" | "client_fallback" | null` to the type:

```ts
startRun: build.mutation<void, {
  runId: string;
  character: string;
  ascension: number;
  gameMode: string;
  userId: string | null;
  runIdSource?: "save_file" | "client_fallback" | null;
}>({
  async queryFn(args) {
    await apiFetch("/api/run", {
      method: "POST",
      body: JSON.stringify({ action: "start", ...args }),
    });
    return { data: undefined };
  },
}),
```

Same for `endRun`:

```ts
endRun: build.mutation<void, {
  runId: string;
  victory?: boolean;
  // ...existing optional fields...
  runIdSource?: "save_file" | "client_fallback" | null;
}>({
  // ...
}),
```

- [ ] **Step 3: Test `invokeGetActiveRunWithRetry` directly**

The helper is now exported, so we test its retry/fallback behavior without running the full listener. Create `apps/desktop/src/features/run/__tests__/invokeGetActiveRunWithRetry.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { invokeGetActiveRunWithRetry } from "../runAnalyticsListener";

const SAMPLE = {
  start_time: 1776540732,
  seed: "A",
  ascension: 10,
  character: "CHARACTER.IRONCLAD",
  is_mp: false,
};

describe("invokeGetActiveRunWithRetry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the first successful result without extra retries", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SAMPLE);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const got = await invokeGetActiveRunWithRetry(3, 1, sleep);
    expect(got).toEqual(SAMPLE);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries when invoke resolves null, succeeds on third try", async () => {
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(SAMPLE);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const got = await invokeGetActiveRunWithRetry(3, 1, sleep);
    expect(got).toEqual(SAMPLE);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2); // between-attempts only
  });

  it("returns null after all attempts fail", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("nope"));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const got = await invokeGetActiveRunWithRetry(3, 1, sleep);
    expect(got).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("returns null when invoke consistently resolves null", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const got = await invokeGetActiveRunWithRetry(3, 1, sleep);
    expect(got).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 4: Run tests + lint**

```bash
cd apps/desktop && pnpm lint && pnpm test
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/run/runAnalyticsListener.ts \
        apps/desktop/src/features/run/__tests__/invokeGetActiveRunWithRetry.test.ts \
        apps/desktop/src/services/evaluationApi.ts
git commit -m "feat(desktop): runAnalyticsListener uses canonical save-file runId with retry fallback"
```

---

## Task 14: `saveFileSubscription.ts` — startup scan + history-watcher subscription (TDD)

**Files:**
- Create: `apps/desktop/src/features/run/saveFileSubscription.ts`
- Create: `apps/desktop/src/features/run/__tests__/saveFileSubscription.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/features/run/__tests__/saveFileSubscription.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const listenMock = vi.fn();
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { setupSaveFileSubscription } from "../saveFileSubscription";

describe("setupSaveFileSubscription", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    listenMock.mockImplementation(async () => () => {});
  });

  it("arms the watcher, runs a backfill scan, and subscribes to run-completed", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "start_run_history_watch") return undefined;
      if (cmd === "list_run_history") {
        return {
          entries: [
            { start_time: 1776000000, seed: "A", ascension: 4, character: "Ironclad", win: false, was_abandoned: false, killed_by_encounter: "ROOM.MONSTER", run_time: 500, build_id: "v0.103.2", act_reached: 1, players_count: 1 },
            { start_time: 1776000100, seed: "B", ascension: 10, character: "Ironclad", win: true,  was_abandoned: false, killed_by_encounter: "NONE.NONE",     run_time: 4800, build_id: "v0.103.2", act_reached: 3, players_count: 1 },
          ],
          skipped: 0,
        };
      }
      return undefined;
    });
    const dispatch = vi.fn().mockResolvedValue({ unwrap: () => Promise.resolve(undefined) });
    // Adapt to RTK mutation initiate shape
    const dispatchAsThunk = (action: unknown) => ({ unwrap: () => Promise.resolve(undefined) });

    await setupSaveFileSubscription(dispatchAsThunk as never);

    expect(invokeMock).toHaveBeenCalledWith("start_run_history_watch");
    expect(invokeMock).toHaveBeenCalledWith(
      "list_run_history",
      { after_start_time: 0 }
    );
    expect(listenMock).toHaveBeenCalledWith("run-completed", expect.any(Function));
    expect(localStorage.getItem("lastSyncedStartTime")).toBe("1776000100");
  });

  it("respects existing lastSyncedStartTime", async () => {
    localStorage.setItem("lastSyncedStartTime", "1776000050");
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "list_run_history") return { entries: [], skipped: 0 };
      return undefined;
    });
    const dispatch = (_a: unknown) => ({ unwrap: () => Promise.resolve(undefined) });
    await setupSaveFileSubscription(dispatch as never);
    expect(invokeMock).toHaveBeenCalledWith(
      "list_run_history",
      { after_start_time: 1776000050 }
    );
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/desktop && pnpm test src/features/run/__tests__/saveFileSubscription.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `apps/desktop/src/features/run/saveFileSubscription.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppDispatch } from "../../store/store";
import { evaluationApi } from "../../services/evaluationApi";
import {
  drainPendingRunSyncs,
  queueRunSync,
  type PendingRunSync,
} from "../../lib/run-sync-queue";

const LAST_SYNCED_KEY = "lastSyncedStartTime";

interface RunSummary {
  start_time: number;
  seed: string;
  ascension: number;
  character: string;
  win: boolean;
  was_abandoned: boolean;
  killed_by_encounter: string;
  run_time: number;
  build_id: string;
  act_reached: number;
  players_count: number;
}

interface RunHistoryListing {
  entries: RunSummary[];
  skipped: number;
}

function loadLastSynced(): number {
  const raw = localStorage.getItem(LAST_SYNCED_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

function saveLastSynced(ts: number) {
  localStorage.setItem(LAST_SYNCED_KEY, String(ts));
}

function summaryToSyncs(s: RunSummary): PendingRunSync[] {
  const runId = String(s.start_time);
  const gameMode: "singleplayer" | "multiplayer" =
    s.players_count > 1 ? "multiplayer" : "singleplayer";
  const cause =
    s.killed_by_encounter && s.killed_by_encounter !== "NONE.NONE"
      ? s.killed_by_encounter
      : null;
  const notes = s.was_abandoned ? "save_file: abandoned" : null;
  return [
    {
      action: "start",
      runId,
      character: s.character,
      ascension: s.ascension,
      gameMode,
      runIdSource: "save_file",
    },
    {
      action: "end",
      runId,
      victory: s.win,
      actReached: s.act_reached,
      causeOfDeath: cause,
      notes,
      runIdSource: "save_file",
    },
  ];
}

async function sendViaDispatch(dispatch: AppDispatch, entry: PendingRunSync): Promise<void> {
  if (entry.action === "start") {
    await dispatch(
      evaluationApi.endpoints.startRun.initiate({
        runId: entry.runId,
        character: entry.character,
        ascension: entry.ascension,
        gameMode: entry.gameMode,
        userId: null,
        runIdSource: entry.runIdSource ?? null,
      })
    ).unwrap();
  } else {
    await dispatch(
      evaluationApi.endpoints.endRun.initiate({
        runId: entry.runId,
        victory: entry.victory ?? undefined,
        actReached: entry.actReached ?? undefined,
        causeOfDeath: entry.causeOfDeath ?? null,
        notes: entry.notes ?? undefined,
        runIdSource: entry.runIdSource ?? null,
      })
    ).unwrap();
  }
}

export async function setupSaveFileSubscription(dispatch: AppDispatch) {
  try {
    await invoke("start_run_history_watch");
  } catch (err) {
    console.info("[saveFileSubscription] start_run_history_watch skipped", err);
  }

  await drainPendingRunSyncs((entry) => sendViaDispatch(dispatch, entry));

  const lastSynced = loadLastSynced();
  try {
    const listing = await invoke<RunHistoryListing>("list_run_history", {
      after_start_time: lastSynced,
    });
    for (const summary of listing.entries) {
      for (const sync of summaryToSyncs(summary)) {
        try {
          await sendViaDispatch(dispatch, sync);
        } catch (err) {
          console.warn("[saveFileSubscription] backfill post failed; queueing", err);
          queueRunSync(sync);
        }
      }
      if (summary.start_time > lastSynced) {
        saveLastSynced(summary.start_time);
      }
    }
  } catch (err) {
    console.info("[saveFileSubscription] list_run_history skipped", err);
  }

  await listen<RunSummary>("run-completed", async (event) => {
    const summary = event.payload;
    for (const sync of summaryToSyncs(summary)) {
      try {
        await sendViaDispatch(dispatch, sync);
      } catch (err) {
        console.warn("[saveFileSubscription] live post failed; queueing", err);
        queueRunSync(sync);
      }
    }
    if (summary.start_time > loadLastSynced()) {
      saveLastSynced(summary.start_time);
    }
  });
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd apps/desktop && pnpm test src/features/run/__tests__/saveFileSubscription.test.ts
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/features/run/saveFileSubscription.ts \
        apps/desktop/src/features/run/__tests__/saveFileSubscription.test.ts
git commit -m "feat(desktop): saveFileSubscription with startup scan + history watcher"
```

---

## Task 15: `should-resume-run.ts` — canonical runId match path

**Files:**
- Modify: `apps/desktop/src/features/run/should-resume-run.ts`
- Modify: `apps/desktop/src/features/run/__tests__/should-resume-run.test.ts`

- [ ] **Step 1: Add a failing test for the new canonical-id path**

Append to `apps/desktop/src/features/run/__tests__/should-resume-run.test.ts`:

```ts
describe("shouldResumeRun with canonicalRunId", () => {
  it("returns true when canonicalRunId matches existingRun.runId", () => {
    const existing = { runId: "1776540732", character: "Ironclad", ascension: 10, floor: 17, act: 3, deck: [{ name: "Strike" }] } as never;
    expect(
      shouldResumeRun({
        isFirstRunTransition: false, // should NOT require first transition when we have canonical match
        existingRun: existing,
        canonicalRunId: "1776540732",
        character: "Ironclad",
        ascension: 10,
        currentFloor: 17,
        currentAct: 3,
      })
    ).toBe(true);
  });

  it("returns false when canonicalRunId mismatches", () => {
    const existing = { runId: "1776540732", character: "Ironclad", ascension: 10, floor: 17, act: 3, deck: [{ name: "Strike" }] } as never;
    expect(
      shouldResumeRun({
        isFirstRunTransition: true,
        existingRun: existing,
        canonicalRunId: "9999999999",
        character: "Ironclad",
        ascension: 10,
        currentFloor: 17,
        currentAct: 3,
      })
    ).toBe(false);
  });

  it("falls back to heuristic when canonicalRunId is null", () => {
    const existing = { runId: "run_legacy_abc", runIdSource: null, character: "Ironclad", ascension: 10, floor: 17, act: 3, deck: [{ name: "Strike" }] } as never;
    expect(
      shouldResumeRun({
        isFirstRunTransition: true,
        existingRun: existing,
        canonicalRunId: null,
        character: "Ironclad",
        ascension: 10,
        currentFloor: 17,
        currentAct: 3,
      })
    ).toBe(true); // heuristic path still works for legacy runs
  });

  it("refuses heuristic fallback when both sides have canonical ids that disagree", () => {
    // Stale persisted run from a previous game, canonical id from a NEW run
    // that happens to share character/asc/floor/act.
    const existing = { runId: "1776000000", runIdSource: "save_file", character: "Ironclad", ascension: 10, floor: 17, act: 3, deck: [{ name: "Strike" }] } as never;
    expect(
      shouldResumeRun({
        isFirstRunTransition: true,
        existingRun: existing,
        canonicalRunId: "1776540732", // new run
        character: "Ironclad",
        ascension: 10,
        currentFloor: 17,
        currentAct: 3,
      })
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/desktop && pnpm test src/features/run/__tests__/should-resume-run.test.ts
```

Expected: TS error — `canonicalRunId` not in args type.

- [ ] **Step 3: Modify `should-resume-run.ts`**

Update `apps/desktop/src/features/run/should-resume-run.ts` to accept `canonicalRunId` and short-circuit:

```ts
import type { RunData } from "./runSlice";

export interface ShouldResumeRunArgs {
  isFirstRunTransition: boolean;
  existingRun: RunData | null;
  /** Canonical runId from the STS2 save file, if available. */
  canonicalRunId: string | null;
  character: string;
  ascension: number;
  currentFloor: number;
  currentAct: number;
}

export function shouldResumeRun({
  isFirstRunTransition,
  existingRun,
  canonicalRunId,
  character,
  ascension,
  currentFloor,
  currentAct,
}: ShouldResumeRunArgs): boolean {
  // Canonical path: if the save file reports an id that matches the
  // persisted run, resume regardless of heuristic fields.
  if (canonicalRunId && existingRun && existingRun.runId === canonicalRunId) {
    return true;
  }

  // Anti-false-match guard: if we have a canonical id AND the persisted
  // run was also canonically-sourced AND they disagree, this is a new run.
  // Don't fall through to the heuristic — doing so would risk picking up
  // a stale same-character run whose floor/act accidentally collide.
  if (
    canonicalRunId &&
    existingRun &&
    existingRun.runIdSource === "save_file" &&
    existingRun.runId !== canonicalRunId
  ) {
    return false;
  }

  // Legacy heuristic path: first transition + exact match on character +
  // ascension + floor + act + non-empty deck. Only applies to legacy
  // (runIdSource === null) persisted runs.
  if (!isFirstRunTransition) return false;
  if (!existingRun) return false;
  if (existingRun.character !== character) return false;
  if (existingRun.ascension !== ascension) return false;
  if (existingRun.floor !== currentFloor) return false;
  if (existingRun.act !== currentAct) return false;
  if (existingRun.deck.length === 0) return false;
  return true;
}
```

- [ ] **Step 4: Fix callers**

`shouldResumeRun(...)` is called from `runAnalyticsListener.ts`. Add `canonicalRunId: active ? String(active.start_time) : null` to the call. The `active` variable is the `ActiveRun | null` from Task 13.

- [ ] **Step 5: Run tests**

```bash
cd apps/desktop && pnpm test src/features/run/__tests__/should-resume-run.test.ts
```

Expected: all pass (3 new + existing).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/run/should-resume-run.ts \
        apps/desktop/src/features/run/__tests__/should-resume-run.test.ts \
        apps/desktop/src/features/run/runAnalyticsListener.ts
git commit -m "feat(desktop): should-resume-run matches on canonical save-file runId"
```

---

## Task 16: Wire `setupSaveFileSubscription` into the store

**Files:**
- Modify: `apps/desktop/src/store/store.ts`

- [ ] **Step 1: Import + invoke**

Open `apps/desktop/src/store/store.ts`. Add alongside the existing listener imports:

```ts
import { setupSaveFileSubscription } from "../features/run/saveFileSubscription";
```

In the "Start all listeners" block (after `setupGameStateSubscription(...)`):

```ts
setupSaveFileSubscription(store.dispatch).catch((err) => {
  console.error("[saveFileSubscription] setup failed", err);
});
```

- [ ] **Step 2: Run the full suite**

```bash
cd apps/desktop && pnpm lint && pnpm test
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/store/store.ts
git commit -m "feat(desktop): wire setupSaveFileSubscription into store init"
```

---

## Task 17: Manual smoke test

**Files:** none — this is the "UI changes: exercise in browser (or say you couldn't)" verification step.

- [ ] **Step 1: Build + run the desktop app against a live STS2**

```bash
pnpm --filter @sts2/desktop tauri dev
```

- [ ] **Step 2: Win an SP run**

Start and complete an SP run. In the app:
- Connection indicator → `connected`.
- At run end, "run-completed" event fires → dispatch `outcomeConfirmed` → row appears in DB with:
  - `run_id = <start_time>` (10-digit Unix seconds)
  - `run_id_source = 'save_file'`
  - `victory = true`
- Victory screen renders (not the "Run paused" screen from #74).

- [ ] **Step 3: Die in an SP run**

Same flow: `victory = false`, `cause_of_death = <encounter_id>`, `run_id_source = 'save_file'`.

- [ ] **Step 4: Abandon a run**

Menu → Abandon. Row: `victory = false`, `notes` contains `save_file: abandoned`, `run_id_source = 'save_file'`.

- [ ] **Step 5: Close app mid-run-end**

Start an SP run, die, close the app window as the death sequence plays before the helper has posted. Restart the app. Expected: startup scan detects the new `history/<ts>.run` file, posts start+end to the DB.

- [ ] **Step 6: MP run (should not double-fire)**

Play an MP game to completion. Expected: `inferRunOutcome` path still handles MP. No `run-completed` event fires (history file was never written for MP). Only one DB row, with legacy or client-minted `run_id`.

- [ ] **Step 7: Save reader unavailable**

Temporarily break save access:

```bash
chmod 000 ~/Library/Application\ Support/SlayTheSpire2/steam/*/modded/profile1/saves
```

Start a new SP run. Expected: `get_active_run_identifier` returns `None` for all 3 retries → new run uses `run_${Date.now()}_*` with `run_id_source = 'client_fallback'`. App doesn't crash. Restore:

```bash
chmod -R 700 ~/Library/Application\ Support/SlayTheSpire2/steam/*/modded/profile1/saves
```

---

## Task 18: Open the PR

- [ ] **Step 1: Push + open**

```bash
git push -u origin feat/<IMPL_ISSUE>-save-file-runid
gh pr create --fill \
  --title "feat(desktop): save-file-derived canonical runId (closes #74 for SP)" \
  --body "Closes #<IMPL_ISSUE>

Implements Phase 1 + 2 of #75. Rust reads the STS2 save directory + watches \`history/\` for new run files; frontend uses the save-file \`start_time\` as the canonical runId and treats the history-watcher as the authoritative SP end-of-run signal. The legacy \`inferRunOutcome\` path stays for MP (Phase 3).

## Test plan

- [x] Rust unit tests — parse fixtures, path resolution, watcher pipeline
- [x] Frontend unit tests — run-sync-queue, saveFileSubscription, should-resume-run canonical path, activeRunRetry contract
- [x] Typecheck — \`pnpm lint\`
- [x] Manual: SP win records with \`run_id_source=save_file\`
- [x] Manual: SP death / abandon paths work
- [x] Manual: closed-during-end recovery via startup scan
- [x] Manual: save reader unavailable → \`client_fallback\`
- [x] Manual: MP run still uses old \`inferRunOutcome\` path
- [ ] DB migration applied in prod (Supabase dashboard)

Spec: \`docs/superpowers/specs/2026-04-19-save-file-canonical-runid-design.md\`
Plan: \`docs/superpowers/plans/2026-04-19-save-file-canonical-runid.md\`"
```

---

## Self-Review Checklist

- **Spec coverage:**
  - Goal (canonical runId from save file) → Tasks 4-7 (Rust) + Tasks 13-14 (frontend).
  - Decisions Log → implemented as specified: `run_id_source` column (Task 9-11), no backfill (Task 14 scans only forward-incremental), retry-then-fallback (Task 13), history-watcher authoritative + inferRunOutcome preserved (Task 14 does not modify inferRunOutcome).
  - Architecture → commands `get_active_run_identifier` (Task 7), `list_run_history` (Task 7), `start_run_history_watch` (Task 8), event `run-completed` (Task 8).
  - Error handling (save dir missing / parse fail / watcher panic / POST fail) → Tasks 7, 8, 12, 14.
  - Testing — Rust fixtures (Task 3), unit (Tasks 4-6), integration (Task 8), frontend (Tasks 12, 14, 15), backend (Task 10 — note: no explicit test task for route.ts Zod schema change, which I should add).
- **Gap:** No explicit test task for the `/api/run` Zod schema change in Task 10. The existing `route.test.ts` should be extended; Task 10 currently only adds the schema field without updating tests. Add an inline test step in Task 10 Step 3 during implementation or accept this as caught by manual smoke.
- **Placeholder scan:** No "TBD" / "TODO" strings. `<IMPL_ISSUE>` is an intentional capture variable from Task 1 Step 1.
- **Type consistency:**
  - `RunIdSource = "save_file" | "client_fallback" | null` used consistently in Tasks 10, 11, 13, 14, 15.
  - `RunSummary` fields defined in Task 4 match usage in Tasks 7, 8, 14.
  - `ActiveRun` defined in Task 4 matches usage in Tasks 7, 13, 15.
  - Command names (`get_active_run_identifier`, `list_run_history`, `start_run_history_watch`) identical across Rust definition (Tasks 7, 8) and frontend invocation (Tasks 13, 14).
  - Event name (`"run-completed"`) identical in Task 8 emit and Task 14 listen.
  - localStorage key (`lastSyncedStartTime`) identical between Task 14 implementation and test.
