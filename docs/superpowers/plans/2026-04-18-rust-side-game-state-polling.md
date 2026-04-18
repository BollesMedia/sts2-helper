# Rust-Side Game State Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move STS2MCP game-state polling from the React frontend into a Tauri/Rust background task so the helper keeps up with the game while the window is unfocused or minimized (WKWebView timer throttling no longer applies).

**Architecture:** A tokio task inside the Tauri process owns the poll loop, owns singleplayer/multiplayer mode state, owns per-`state_type` interval selection, and owns 409 mode-swap retry logic. After every fetch it caches the latest result in a shared `RwLock` and emits a Tauri event (`game-state-updated` on success, `game-state-error` on failure). The frontend `gameStateApi` RTK Query endpoint keeps its existing shape — all downstream `matchFulfilled`/`matchRejected` listeners stay intact — but its `queryFn` now calls a Rust `get_latest_game_state` command instead of `fetch`, and a new event subscription dispatches `endpoints.getGameState.initiate(undefined, { forceRefetch: true, subscribe: false })` whenever Rust emits a fresh state. The frontend no longer sets a `pollingInterval` — Rust is the clock.

**Tech Stack:** Tauri 2, Rust (tokio, reqwest, serde_json), React 19 + Redux Toolkit 2 (RTK Query), Vitest, `@tauri-apps/api/core` + `@tauri-apps/api/event`.

---

## File Structure

### Create
- `apps/desktop/src-tauri/src/game_state_poller.rs` — polling task, shared cache, commands, event-emit helpers, embedded `#[cfg(test)]` tests
- `apps/desktop/src/features/connection/gameStateSubscription.ts` — Tauri event listener that dispatches `initiate({ forceRefetch: true, subscribe: false })`
- `apps/desktop/src/features/connection/__tests__/gameStateSubscription.test.ts`
- `apps/desktop/src/services/__tests__/gameStateApi.test.ts`

### Modify
- `apps/desktop/src-tauri/src/lib.rs` — declare `game_state_poller` module, register two new commands, spawn the poller in the `setup` hook
- `apps/desktop/src-tauri/Cargo.toml` — enable extra `tokio` features (`sync`, `time`, `rt-multi-thread`, `macros`) + `wiremock` dev-dep
- `apps/desktop/src/services/gameStateApi.ts` — replace `fetch`-based `queryFn` with `invoke('get_latest_game_state')`; drop module-level `activeMode` (owned by Rust now)
- `apps/desktop/src/hooks/useGameState.ts` — drop `pollingInterval` and per-state interval selection; keep everything else (error reporting, return shape)
- `apps/desktop/src/store/store.ts` — call `setupGameStateSubscription(store.dispatch)` after the existing listeners are wired up

### Delete
- `apps/desktop/src/views/connection/polling-config.ts` — only `useGameState.ts` imports it; intervals move to Rust

### Constants (ported to Rust, keep exact values)
Source: `apps/desktop/src/views/connection/polling-config.ts` (current values).

```
monster/elite/boss/hand_select          = 500ms
combat_rewards/card_reward/shop/event/
  card_select/relic_select              = 2000ms
map/rest_site/treasure                  = 3000ms
menu                                    = 5000ms
overlay                                 = 2000ms
(default, unknown state_type)           = 2000ms
(error)                                 = 3000ms
(offline / no data yet)                 = 5000ms
```

---

## Task 1: Create Git Issue and Worktree

**Files:**
- No code changes — this sets up the workspace.

- [ ] **Step 1: Create issue**

Run (from main checkout):

```bash
gh issue create \
  --repo BollesMedia/sts2-helper \
  --title "Poll STS2MCP from Rust so the helper keeps up when the window is unfocused" \
  --body "When the STS2 Replay desktop window loses focus (e.g. the player tabs into the game), WKWebView throttles JS timers and the frontend poll loop slows to ~1Hz. This lags the in-game helper. Move polling into a tokio task on the Rust side — it isn't throttled by window focus/visibility — and push state to the frontend via Tauri events. Plan: docs/superpowers/plans/2026-04-18-rust-side-game-state-polling.md"
```

Expected: prints the issue URL and number, e.g. `https://github.com/BollesMedia/sts2-helper/issues/142`. Capture the number as `<ISSUE_NUM>` for later steps.

- [ ] **Step 2: Create worktree on a typed branch**

Run:

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git worktree add .worktrees/feat/<ISSUE_NUM>-rust-polling -b feat/<ISSUE_NUM>-rust-polling
cd .worktrees/feat/<ISSUE_NUM>-rust-polling
scripts/setup-worktree.sh
pnpm install
```

Expected: worktree at `.worktrees/feat/<ISSUE_NUM>-rust-polling`, symlinked `.vercel/` and `.env.local`, and `pnpm install` completes without version drift. All remaining tasks run inside that worktree.

---

## Task 2: Cargo deps — enable required tokio features

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml` (dependencies section)

- [ ] **Step 1: Update the `tokio` feature list and add `wiremock` as a dev-dep**

Replace the existing `tokio = ...` line (currently `tokio = { version = "1", features = ["fs", "io-util"] }`) and add a `[dev-dependencies]` block:

```toml
tokio = { version = "1", features = ["fs", "io-util", "sync", "time", "rt-multi-thread", "macros"] }

# ...leave other deps unchanged...

[dev-dependencies]
wiremock = "0.6"
tokio = { version = "1", features = ["macros", "rt-multi-thread", "test-util"] }
```

- [ ] **Step 2: Verify Cargo still resolves**

Run (from the worktree root):

```bash
cd apps/desktop/src-tauri && cargo check
```

Expected: compiles clean with no new warnings. If it fails, fix before proceeding.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock
git commit -m "chore(desktop): enable tokio sync/time/rt features for rust poller"
```

---

## Task 3: Rust poller module — types and skeleton (TDD: write failing test first)

**Files:**
- Create: `apps/desktop/src-tauri/src/game_state_poller.rs`

- [ ] **Step 1: Write the failing test (interval selection)**

Create `apps/desktop/src-tauri/src/game_state_poller.rs` with just the test module:

```rust
//! Background poller that fetches STS2MCP game state and pushes it to the
//! frontend via Tauri events. Owns mode (single vs multi) and per-state_type
//! polling cadence so the JS side doesn't have to run a timer.

use serde::Serialize;
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Mode {
    Singleplayer,
    Multiplayer,
}

impl Mode {
    pub fn toggle(self) -> Self {
        match self {
            Mode::Singleplayer => Mode::Multiplayer,
            Mode::Multiplayer => Mode::Singleplayer,
        }
    }
}

/// Returns how long to wait before the NEXT fetch, given the last fetch outcome.
pub fn next_interval(state_type: Option<&str>, had_error: bool) -> Duration {
    if had_error {
        return Duration::from_millis(3000);
    }
    match state_type {
        Some("monster") | Some("elite") | Some("boss") | Some("hand_select") => {
            Duration::from_millis(500)
        }
        Some("combat_rewards") | Some("card_reward") | Some("shop") | Some("event")
        | Some("card_select") | Some("relic_select") | Some("overlay") => {
            Duration::from_millis(2000)
        }
        Some("map") | Some("rest_site") | Some("treasure") => Duration::from_millis(3000),
        Some("menu") => Duration::from_millis(5000),
        Some(_) => Duration::from_millis(2000), // known-other → default
        None => Duration::from_millis(5000),    // no data yet → offline
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interval_500ms_for_combat_states() {
        for st in ["monster", "elite", "boss", "hand_select"] {
            assert_eq!(
                next_interval(Some(st), false),
                Duration::from_millis(500),
                "{st}"
            );
        }
    }

    #[test]
    fn interval_3000ms_on_error_regardless_of_state() {
        assert_eq!(next_interval(Some("monster"), true), Duration::from_millis(3000));
        assert_eq!(next_interval(None, true), Duration::from_millis(3000));
    }

    #[test]
    fn interval_5000ms_when_no_state_yet() {
        assert_eq!(next_interval(None, false), Duration::from_millis(5000));
    }

    #[test]
    fn interval_defaults_to_2000ms_for_unknown_state() {
        assert_eq!(
            next_interval(Some("totally_new_state"), false),
            Duration::from_millis(2000)
        );
    }

    #[test]
    fn mode_toggle_round_trips() {
        assert_eq!(Mode::Singleplayer.toggle(), Mode::Multiplayer);
        assert_eq!(Mode::Multiplayer.toggle().toggle(), Mode::Multiplayer);
    }
}
```

Also add `mod game_state_poller;` to `apps/desktop/src-tauri/src/lib.rs` at the top (next to the existing `mod mods;` / `mod steam;` lines), otherwise `cargo test` won't see the module.

- [ ] **Step 2: Run tests — expect PASS**

This is pure logic, no external deps, so tests should pass on first run.

```bash
cd apps/desktop/src-tauri && cargo test --lib next_interval mode_toggle
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/game_state_poller.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): scaffold game_state_poller module with interval logic"
```

---

## Task 4: Poller core — fetch + mode swap, against a mock HTTP server

**Files:**
- Modify: `apps/desktop/src-tauri/src/game_state_poller.rs`

- [ ] **Step 1: Add the failing test**

Append inside the `mod tests {}` block:

```rust
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn fetch_once(
    client: &reqwest::Client,
    base_url: &str,
    mode: Mode,
) -> FetchOutcome {
    super::fetch_once_against(client, base_url, mode).await
}

#[tokio::test]
async fn fetch_once_swaps_mode_on_409_and_retries() {
    let server = MockServer::start().await;

    // singleplayer → 409
    Mock::given(method("GET"))
        .and(path("/api/v1/singleplayer"))
        .respond_with(ResponseTemplate::new(409))
        .mount(&server)
        .await;

    // multiplayer → 200 with a minimal state_type body
    Mock::given(method("GET"))
        .and(path("/api/v1/multiplayer"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "state_type": "menu"
        })))
        .mount(&server)
        .await;

    let client = reqwest::Client::new();
    let out = fetch_once(&client, &server.uri(), Mode::Singleplayer).await;

    match out {
        FetchOutcome::Ok { mode, body } => {
            assert_eq!(mode, Mode::Multiplayer);
            assert_eq!(body.get("state_type").and_then(|v| v.as_str()), Some("menu"));
        }
        other => panic!("expected Ok, got {other:?}"),
    }
}

#[tokio::test]
async fn fetch_once_returns_err_on_non_409_http_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/singleplayer"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;

    let client = reqwest::Client::new();
    let out = fetch_once(&client, &server.uri(), Mode::Singleplayer).await;
    match out {
        FetchOutcome::HttpError { status, .. } => assert_eq!(status, 500),
        other => panic!("expected HttpError, got {other:?}"),
    }
}

#[tokio::test]
async fn fetch_once_returns_network_err_when_server_down() {
    let client = reqwest::Client::new();
    let out = fetch_once(&client, "http://127.0.0.1:1", Mode::Singleplayer).await;
    assert!(matches!(out, FetchOutcome::Network(_)));
}
```

- [ ] **Step 2: Run tests — verify they fail for the right reason**

```bash
cd apps/desktop/src-tauri && cargo test --lib game_state_poller::tests::fetch_once
```

Expected: FAIL — `fetch_once_against` / `FetchOutcome` not defined.

- [ ] **Step 3: Implement `FetchOutcome` + `fetch_once_against`**

Above the `#[cfg(test)]` block in `game_state_poller.rs`:

```rust
#[derive(Debug)]
pub enum FetchOutcome {
    Ok {
        mode: Mode,
        body: serde_json::Value,
    },
    HttpError {
        status: u16,
        message: String,
    },
    Network(String),
}

/// Fetch once against `base_url`, honoring a single 409 mode-swap retry.
/// Extracted so tests can point at a wiremock server without global state.
pub(crate) async fn fetch_once_against(
    client: &reqwest::Client,
    base_url: &str,
    starting_mode: Mode,
) -> FetchOutcome {
    let mut mode = starting_mode;
    let url = format!("{base_url}{}", endpoint_path(mode));

    let first = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => return FetchOutcome::Network(e.to_string()),
    };

    if first.status().as_u16() == 409 {
        mode = mode.toggle();
        let retry_url = format!("{base_url}{}", endpoint_path(mode));
        let retry = match client.get(&retry_url).send().await {
            Ok(r) => r,
            Err(e) => return FetchOutcome::Network(e.to_string()),
        };
        if !retry.status().is_success() {
            return FetchOutcome::HttpError {
                status: retry.status().as_u16(),
                message: format!("STS2MCP responded with {}", retry.status().as_u16()),
            };
        }
        return match retry.json::<serde_json::Value>().await {
            Ok(body) => FetchOutcome::Ok { mode, body },
            Err(e) => FetchOutcome::Network(format!("json parse: {e}")),
        };
    }

    if !first.status().is_success() {
        return FetchOutcome::HttpError {
            status: first.status().as_u16(),
            message: format!("STS2MCP responded with {}", first.status().as_u16()),
        };
    }

    match first.json::<serde_json::Value>().await {
        Ok(body) => FetchOutcome::Ok { mode, body },
        Err(e) => FetchOutcome::Network(format!("json parse: {e}")),
    }
}

fn endpoint_path(mode: Mode) -> &'static str {
    match mode {
        Mode::Singleplayer => "/api/v1/singleplayer",
        Mode::Multiplayer => "/api/v1/multiplayer",
    }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd apps/desktop/src-tauri && cargo test --lib game_state_poller
```

Expected: all poller tests pass (5 sync + 3 async).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/game_state_poller.rs
git commit -m "feat(desktop): fetch_once_against handles 409 mode-swap retry"
```

---

## Task 5: Poller state cache + run loop + Tauri event emission

**Files:**
- Modify: `apps/desktop/src-tauri/src/game_state_poller.rs`

- [ ] **Step 1: Add the shared-state + spawn-helper code**

Append above the `#[cfg(test)]` block:

```rust
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type")]
pub enum PollResult {
    #[serde(rename = "ok")]
    Ok { data: serde_json::Value },
    #[serde(rename = "error")]
    Error { status: String, message: String },
}

#[derive(Default)]
pub struct PollerState {
    pub latest: RwLock<Option<PollResult>>,
}

pub type PollerHandle = Arc<PollerState>;

pub fn spawn_poller(app: AppHandle, base_url: String) {
    let state: PollerHandle = Arc::new(PollerState::default());
    app.manage(state.clone());

    tauri::async_runtime::spawn(async move {
        run_poll_loop(app, base_url, state).await;
    });
}

async fn run_poll_loop(app: AppHandle, base_url: String, state: PollerHandle) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .expect("reqwest client build");

    let mut mode = Mode::Singleplayer;

    loop {
        let outcome = fetch_once_against(&client, &base_url, mode).await;

        let (next_state_type, had_error, poll_result) = match outcome {
            FetchOutcome::Ok { mode: new_mode, body } => {
                mode = new_mode;
                let state_type = body
                    .get("state_type")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let result = PollResult::Ok { data: body };
                (state_type, false, result)
            }
            FetchOutcome::HttpError { status, message } => (
                None,
                true,
                PollResult::Error {
                    status: status.to_string(),
                    message,
                },
            ),
            FetchOutcome::Network(msg) => (
                None,
                true,
                PollResult::Error {
                    status: "FETCH_ERROR".to_string(),
                    message: msg,
                },
            ),
        };

        *state.latest.write().await = Some(poll_result.clone());

        let event_name = match &poll_result {
            PollResult::Ok { .. } => "game-state-updated",
            PollResult::Error { .. } => "game-state-error",
        };
        if let Err(e) = app.emit(event_name, &poll_result) {
            log::warn!("[poller] emit {event_name} failed: {e}");
        }

        tokio::time::sleep(next_interval(next_state_type.as_deref(), had_error)).await;
    }
}
```

- [ ] **Step 2: Verify Rust still compiles + existing tests still pass**

```bash
cd apps/desktop/src-tauri && cargo test --lib game_state_poller
```

Expected: all existing poller tests still pass. (We haven't added new tests for the loop yet — integration-testing the loop requires a live Tauri app, which we'll smoke-test manually in Task 9.)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/game_state_poller.rs
git commit -m "feat(desktop): add poller run loop + shared PollerState cache"
```

---

## Task 6: Wire `get_latest_game_state` command and spawn poller in `setup`

**Files:**
- Modify: `apps/desktop/src-tauri/src/game_state_poller.rs` (add command)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (register command + spawn on setup)

- [ ] **Step 1: Add the command to `game_state_poller.rs`**

Append above `#[cfg(test)]`:

```rust
#[tauri::command]
pub async fn get_latest_game_state(
    state: tauri::State<'_, PollerHandle>,
) -> Result<PollResult, String> {
    match state.latest.read().await.clone() {
        Some(result) => Ok(result),
        None => Ok(PollResult::Error {
            status: "NOT_READY".to_string(),
            message: "Poller has not completed a fetch yet".to_string(),
        }),
    }
}
```

- [ ] **Step 2: Register it and spawn the poller from `lib.rs`**

Edit `apps/desktop/src-tauri/src/lib.rs`:

1. Top of the file, add:

```rust
mod game_state_poller;
```

2. In the `run()` `Builder`, extend `invoke_handler` to include the new command and add a `setup` hook:

```rust
.invoke_handler(tauri::generate_handler![
    detect_game,
    get_mod_status,
    install_required_mods,
    game_state_poller::get_latest_game_state,
])
.setup(|app| {
    let handle = app.handle().clone();
    game_state_poller::spawn_poller(
        handle,
        "http://127.0.0.1:15526".to_string(),
    );
    Ok(())
})
.run(tauri::generate_context!())
```

(Preserve every existing `.plugin(...)` call exactly as-is.)

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/desktop/src-tauri && cargo check
```

Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/game_state_poller.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): register poller + get_latest_game_state command on setup"
```

---

## Task 7: Frontend — replace fetch queryFn with Rust `invoke`

**Files:**
- Modify: `apps/desktop/src/services/gameStateApi.ts`
- Create: `apps/desktop/src/services/__tests__/gameStateApi.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/services/__tests__/gameStateApi.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { gameStateApi } from "../gameStateApi";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

function makeStore() {
  return configureStore({
    reducer: { [gameStateApi.reducerPath]: gameStateApi.reducer },
    middleware: (gdm) => gdm().concat(gameStateApi.middleware),
  });
}

describe("gameStateApi.getGameState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns data when Rust reports ok", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: "ok",
      data: { state_type: "menu", game_mode: "singleplayer" },
    });

    const store = makeStore();
    const result = await store.dispatch(
      gameStateApi.endpoints.getGameState.initiate()
    );

    expect(invoke).toHaveBeenCalledWith("get_latest_game_state");
    expect(result.data).toMatchObject({ state_type: "menu" });
    expect(result.error).toBeUndefined();
  });

  it("returns error when Rust reports error", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: "error",
      status: "FETCH_ERROR",
      message: "connection refused",
    });

    const store = makeStore();
    const result = await store.dispatch(
      gameStateApi.endpoints.getGameState.initiate()
    );

    expect(result.error).toMatchObject({
      status: "FETCH_ERROR",
      data: "connection refused",
    });
  });

  it("returns error when invoke itself throws", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));

    const store = makeStore();
    const result = await store.dispatch(
      gameStateApi.endpoints.getGameState.initiate()
    );

    expect(result.error).toMatchObject({ status: "FETCH_ERROR" });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd apps/desktop && pnpm test src/services/__tests__/gameStateApi.test.ts
```

Expected: all three fail because `gameStateApi` still uses `fetch` and won't match the mocked invoke shape.

- [ ] **Step 3: Rewrite `gameStateApi.ts`**

Replace the full contents of `apps/desktop/src/services/gameStateApi.ts` with:

```ts
import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { invoke } from "@tauri-apps/api/core";
import type { GameState } from "@sts2/shared/types/game-state";
import { reportError } from "@sts2/shared/lib/error-reporter";
import {
  validateGameStateStructure,
  snapshotShape,
} from "@sts2/shared/lib/validate-game-state";

type PollResult =
  | { type: "ok"; data: GameState }
  | { type: "error"; status: string; message: string };

/** Rate-limit validation error reports — one per stateType+errors combo per session */
const reportedValidationErrors = new Set<string>();

function validateAndReturn(data: unknown): GameState {
  const result = validateGameStateStructure(data);

  if (!result.stateType) {
    throw new Error("Mod response missing state_type");
  }

  if (!result.valid) {
    const errorKey = `v2:${result.stateType}:${result.errors.join(",")}`;
    console.warn(
      `[GameState] Validation failed for "${result.stateType}":`,
      result.errors,
      "Raw keys:",
      data && typeof data === "object" ? Object.keys(data) : "N/A",
    );

    if (!reportedValidationErrors.has(errorKey)) {
      reportedValidationErrors.add(errorKey);
      reportError(
        "game_state_validation",
        `Invalid ${result.stateType} response`,
        {
          stateType: result.stateType,
          errors: result.errors,
          rawKeys:
            data && typeof data === "object" ? Object.keys(data) : [],
          responseShape: snapshotShape(data, 3),
        },
      );
    }
  }

  return data as GameState;
}

export const gameStateApi = createApi({
  reducerPath: "gameStateApi",
  baseQuery: fakeBaseQuery(),
  endpoints: (build) => ({
    getGameState: build.query<GameState, void>({
      async queryFn() {
        try {
          const result = await invoke<PollResult>("get_latest_game_state");
          if (result.type === "error") {
            return {
              error: { status: result.status, data: result.message },
            };
          }
          return { data: validateAndReturn(result.data) };
        } catch (err) {
          return {
            error: {
              status: "FETCH_ERROR",
              data: err instanceof Error ? err.message : String(err),
            },
          };
        }
      },
      keepUnusedDataFor: 0,
    }),
  }),
});

export const { useGetGameStateQuery } = gameStateApi;
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
cd apps/desktop && pnpm test src/services/__tests__/gameStateApi.test.ts
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/services/gameStateApi.ts apps/desktop/src/services/__tests__/gameStateApi.test.ts
git commit -m "feat(desktop): gameStateApi reads from rust poller via invoke"
```

---

## Task 8: Frontend — drop `pollingInterval`, add Tauri event subscription

**Files:**
- Modify: `apps/desktop/src/hooks/useGameState.ts`
- Delete: `apps/desktop/src/views/connection/polling-config.ts`
- Create: `apps/desktop/src/features/connection/gameStateSubscription.ts`
- Create: `apps/desktop/src/features/connection/__tests__/gameStateSubscription.test.ts`
- Modify: `apps/desktop/src/store/store.ts`

- [ ] **Step 1: Rewrite `useGameState.ts` without the per-state polling interval**

Key change beyond dropping `pollingInterval`: treat the Rust-side `NOT_READY` status as **connecting**, not disconnected. Otherwise the app boots straight into a Sentry "disconnected" report on every startup because `get_latest_game_state` returns `NOT_READY` before the Rust poller's first fetch completes.

Replace file contents with:

```ts
import { useRef } from "react";
import { useGetGameStateQuery, gameStateApi } from "../services/gameStateApi";
import { reportError } from "@sts2/shared/lib/error-reporter";
import { STS2MCP_BASE_URL } from "@sts2/shared/lib/constants";
import { useAppSelector } from "../store/hooks";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

const selectGameStateResult = gameStateApi.endpoints.getGameState.select();

function isNotReady(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: unknown }).status === "NOT_READY"
  );
}

/**
 * Game state hook. Polling cadence lives in the Rust-side poller —
 * the frontend just reads the latest cached result and re-renders
 * when the poller emits a Tauri event (see gameStateSubscription).
 */
export function useGameState() {
  useAppSelector((state) => selectGameStateResult(state).data?.state_type);

  const { data, error, isLoading } = useGetGameStateQuery();

  const notReady = isNotReady(error);
  const connectionStatus: ConnectionStatus =
    error && !notReady ? "disconnected" : isLoading || notReady ? "connecting" : "connected";

  const disconnectReported = useRef(false);
  if (error && !notReady && !disconnectReported.current) {
    disconnectReported.current = true;
    reportError("connection", "Game API disconnected", {
      errorMessage: String(error),
      url: STS2MCP_BASE_URL,
    });
  }
  if (!error || notReady) {
    disconnectReported.current = false;
  }

  return {
    gameState: data ?? null,
    connectionStatus,
    error: notReady ? null : (error ?? null),
    gameMode: (data?.game_mode ?? "singleplayer") as
      | "singleplayer"
      | "multiplayer",
  };
}
```

Also update `connectionListeners.ts`: the `matchRejected` listener should also treat `NOT_READY` as a non-event, so the connection slice doesn't flash to `disconnected` on boot.

Edit `apps/desktop/src/features/connection/connectionListeners.ts` — replace the disconnected listener block (currently around lines 60–65) with:

```ts
  // Disconnected: query rejected (but NOT_READY is just "Rust hasn't fetched yet" → ignore)
  startAppListening({
    matcher: gameStateApi.endpoints.getGameState.matchRejected,
    effect: (action, listenerApi) => {
      const status = (action.payload as { status?: unknown } | undefined)?.status;
      if (status === "NOT_READY") return;
      listenerApi.dispatch(statusChanged("disconnected"));
    },
  });
```

- [ ] **Step 2: Delete `polling-config.ts`**

Run:

```bash
git rm apps/desktop/src/views/connection/polling-config.ts
```

Expected: file removed; `git status` shows a staged deletion.

- [ ] **Step 3: Write the failing test for the event subscription**

The test uses a real `configureStore` with `gameStateApi` middleware so we assert on the actual `matchFulfilled` / `matchRejected` matchers firing (the load-bearing behavior for every downstream listener) — not on the type of the dispatched thunk. `invoke` is mocked to return whatever the test dictates.

Create `apps/desktop/src/features/connection/__tests__/gameStateSubscription.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";

const listenMock = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { setupGameStateSubscription } from "../gameStateSubscription";
import { gameStateApi } from "../../../services/gameStateApi";

function makeStore() {
  return configureStore({
    reducer: { [gameStateApi.reducerPath]: gameStateApi.reducer },
    middleware: (gdm) => gdm().concat(gameStateApi.middleware),
  });
}

describe("setupGameStateSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes to both events and triggers matchFulfilled / matchRejected on each emit", async () => {
    const handlers: Record<string, () => void> = {};
    listenMock.mockImplementation(async (name: string, cb: () => void) => {
      handlers[name] = cb;
      return () => {};
    });

    const store = makeStore();
    const fulfilledSpy = vi.fn();
    const rejectedSpy = vi.fn();
    store.subscribe(() => {
      // no-op — matchers are checked via dispatched action observation below
    });

    // Intercept dispatched actions via a custom middleware-less path:
    const origDispatch = store.dispatch;
    (store as { dispatch: typeof origDispatch }).dispatch = ((action) => {
      const result = origDispatch(action);
      if (typeof action === "object" && action !== null && "type" in action) {
        if (gameStateApi.endpoints.getGameState.matchFulfilled(action as never)) {
          fulfilledSpy();
        }
        if (gameStateApi.endpoints.getGameState.matchRejected(action as never)) {
          rejectedSpy();
        }
      }
      return result;
    }) as typeof origDispatch;

    await setupGameStateSubscription(store.dispatch);

    expect(listenMock).toHaveBeenCalledWith(
      "game-state-updated",
      expect.any(Function),
    );
    expect(listenMock).toHaveBeenCalledWith(
      "game-state-error",
      expect.any(Function),
    );

    // Emit success → matchFulfilled must fire
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      type: "ok",
      data: { state_type: "menu", game_mode: "singleplayer" },
    });
    handlers["game-state-updated"]();
    await new Promise((r) => setTimeout(r, 0));
    expect(fulfilledSpy).toHaveBeenCalledTimes(1);

    // Emit error → matchRejected must fire
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      type: "error",
      status: "500",
      message: "nope",
    });
    handlers["game-state-error"]();
    await new Promise((r) => setTimeout(r, 0));
    expect(rejectedSpy).toHaveBeenCalledTimes(1);
  });

  it("kicks off one immediate backfill so downstream listeners catch the first cached state", async () => {
    listenMock.mockImplementation(async () => () => {});
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: "ok",
      data: { state_type: "menu", game_mode: "singleplayer" },
    });

    const store = makeStore();
    const dispatchSpy = vi.spyOn(store, "dispatch");
    await setupGameStateSubscription(store.dispatch);
    await new Promise((r) => setTimeout(r, 0));

    // Backfill call — invoke must have been asked for current state at setup time
    expect(invoke).toHaveBeenCalledWith("get_latest_game_state");
    expect(dispatchSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run — expect FAIL**

```bash
cd apps/desktop && pnpm test src/features/connection/__tests__/gameStateSubscription.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5: Implement `gameStateSubscription.ts`**

Create `apps/desktop/src/features/connection/gameStateSubscription.ts`:

```ts
import { listen } from "@tauri-apps/api/event";
import { gameStateApi } from "../../services/gameStateApi";
import type { AppDispatch } from "../../store/store";

/**
 * Register once at app init. Every time the Rust poller finishes a
 * fetch, force-refetch the RTK Query endpoint so the existing
 * matchFulfilled / matchRejected listeners see a new result without
 * the JS side running its own timer (which WKWebView throttles when
 * the window is unfocused).
 *
 * We also start ONE persistent subscription so the cache entry stays
 * alive for the full app lifetime — otherwise `keepUnusedDataFor: 0`
 * would garbage-collect it between events on routes that don't
 * currently render useGameState, and downstream listeners would miss
 * updates.
 */
export async function setupGameStateSubscription(dispatch: AppDispatch) {
  // Persistent subscription — holds the RTK Query cache entry alive
  // for the lifetime of the app. The returned promise resolves to
  // { unsubscribe } but we intentionally never call it.
  dispatch(gameStateApi.endpoints.getGameState.initiate());

  const refetch = () =>
    dispatch(
      gameStateApi.endpoints.getGameState.initiate(undefined, {
        forceRefetch: true,
        subscribe: false,
      }),
    );

  await listen("game-state-updated", refetch);
  await listen("game-state-error", refetch);

  // Backfill: grab whatever Rust already has in case its first emit
  // fired before our listeners were registered.
  refetch();
}
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
cd apps/desktop && pnpm test src/features/connection/__tests__/gameStateSubscription.test.ts
```

Expected: 1/1 pass.

- [ ] **Step 7: Wire it up in `store.ts`**

Edit `apps/desktop/src/store/store.ts`. Add the import near the other listener imports:

```ts
import { setupGameStateSubscription } from "../features/connection/gameStateSubscription";
```

And call it at the bottom of the existing "Start all listeners" block (after `setupEvaluationListeners();`):

```ts
setupGameStateSubscription(store.dispatch).catch((err) => {
  console.error("[gameStateSubscription] setup failed", err);
});
```

- [ ] **Step 8: Typecheck + run the whole test suite**

```bash
cd apps/desktop && pnpm lint && pnpm test
```

Expected: typecheck clean, all tests green.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/hooks/useGameState.ts \
        apps/desktop/src/features/connection/gameStateSubscription.ts \
        apps/desktop/src/features/connection/__tests__/gameStateSubscription.test.ts \
        apps/desktop/src/features/connection/connectionListeners.ts \
        apps/desktop/src/store/store.ts
git rm --cached apps/desktop/src/views/connection/polling-config.ts 2>/dev/null || true
git commit -m "feat(desktop): drop js poll timer, subscribe to rust-emitted state events"
```

---

## Task 9: Manual smoke test in the live app

**Files:** no code changes — this is the "UI changes: exercise in browser (or say you couldn't)" verification step.

- [ ] **Step 1: Run the desktop app against a live STS2MCP instance**

```bash
cd apps/desktop && pnpm tauri dev
```

- [ ] **Step 2: Happy path**

With STS2 running + STS2MCP responding on `127.0.0.1:15526`:

- Open the devtools console. Confirm no `[poller]` warnings.
- Confirm the connection indicator goes `connecting` → `connected` within ~1s.
- Start a run, advance past the menu screen, check that `state_type` shown in the UI updates roughly as fast as the game (≤500ms lag during combat).

- [ ] **Step 3: The actual bug — unfocused window keeps up**

- Drag the helper window so it's visible next to the STS2 window.
- Focus the STS2 window (click into the game).
- Play through at least one combat round. The helper should stay within ~1 round of the real game state. Before this change it would be ≥5–10s behind.
- Minimize the helper, leave for 30s, restore — it should show the current state (not the state from 30s ago).

- [ ] **Step 4: Error path**

- Stop STS2 / STS2MCP. The connection indicator should flip to `disconnected` within ~3s.
- Restart STS2MCP — indicator should flip back to `connected` within ~3s.

- [ ] **Step 5: Mode swap**

- Launch a multiplayer lobby. The helper should auto-switch without user action (Rust handles the 409 swap). Confirm `gameMode` in the UI flips to `multiplayer`.

If all five steps behave as described, the fix works. If not, debug by running the tauri dev console with `RUST_LOG=info` and checking `[poller]` log lines.

---

## Task 10: Open the PR

- [ ] **Step 1: Push branch + open PR**

```bash
git push -u origin feat/<ISSUE_NUM>-rust-polling
gh pr create \
  --fill \
  --title "feat(desktop): poll game state from rust so unfocused window keeps up" \
  --body "Closes #<ISSUE_NUM>

WKWebView throttles JS timers when the window loses focus, which made the helper drift 5-10s behind the live game during combat. This moves the poll loop into a tokio task on the Rust side. The frontend RTK Query endpoint now reads the last cached result via \`invoke('get_latest_game_state')\` and force-refetches whenever Rust emits a \`game-state-updated\` / \`game-state-error\` event. All downstream \`matchFulfilled\` / \`matchRejected\` listeners are unchanged.

## Test plan

- [x] Rust unit tests (interval map, 409 retry, error paths) — \`cargo test --lib game_state_poller\`
- [x] Frontend unit tests (queryFn via invoke, event subscription) — \`pnpm test\`
- [x] Typecheck — \`pnpm lint\`
- [x] Manual: helper stays within 1 round of the live game while STS2 is focused
- [x] Manual: mode swap (singleplayer → multiplayer) works without re-focus
- [x] Manual: disconnect/reconnect flips indicator within ~3s

> Note: the core behavior change (no timer throttling when unfocused) has no automated regression test — manual smoke is the primary gate. If this ever breaks again, consider a Rust integration test using \`tauri::test::mock_app()\`."
```

Expected: PR URL printed.

---

## Self-Review Checklist

- **Spec coverage:**
  - "Continue polling when window is unfocused" → Task 5 spawns a tokio task, independent of JS timers. Task 9 Step 3 verifies.
  - "Most robust" → Rust owns mode, intervals, retries; frontend has zero timer state; validated by integration tests against a mock HTTP server.
- **Placeholders:** none — every step has real code or a concrete command. `<ISSUE_NUM>` is an intentional capture variable from Task 1 Step 1.
- **Type consistency:** `PollResult` discriminator is `"ok" | "error"` in both Rust (`#[serde(rename)]`) and TS (`type` field). `status` is a `string` on both sides (Rust stringifies HTTP status, TS expects string). Command name `get_latest_game_state` is identical across Task 6, Task 7, and the test.
- **Risk:** Removing `polling-config.ts` — grep confirms only `useGameState.ts` imports it.

## Post-Review Fixes (folded in from code-reviewer pass)

- **Subscription lifecycle:** `setupGameStateSubscription` now starts one persistent subscription (no `subscribe: false`) so the RTK Query cache entry stays alive for the full app lifetime. Prevents `keepUnusedDataFor: 0` from garbage-collecting the entry between events on routes that don't render `useGameState`.
- **Startup race:** Same function also dispatches an immediate `refetch()` after registering listeners, backfilling whatever Rust already has in case the first `emit` fired before `listen()` resolved.
- **`NOT_READY` handling:** `useGameState` + `connectionListeners` both now treat `NOT_READY` (returned by `get_latest_game_state` before Rust's first fetch) as "connecting" rather than a disconnect — prevents a false-positive Sentry report + UI flash on every boot.
- **`spawn_poller` simplification:** Dropped the `try_state` guard; `setup` is called exactly once, so just create + manage directly.
- **Dead code:** Removed `Mode::url()` — the run loop uses `endpoint_path()` + `base_url`.
- **Vitest CLI:** Use `pnpm test <path>` not `pnpm test -- <path>` (pnpm forwards `--` raw; vitest treats it as an arg).
- **Test strength:** `gameStateSubscription.test.ts` now asserts on `matchFulfilled` / `matchRejected` firing against a real store — not `typeof` of a thunk.
