# Dev Event Log

**Date:** 2026-04-06
**Status:** Approved
**Context:** Debugging the desktop app currently requires the user to paste localStorage / DevTools snapshots into the chat for the assistant to inspect. This is slow, lossy (snapshots are after-the-fact), and forces context-switching mid-investigation. A persistent, file-based event log would let the assistant `Read` recent game state polls, eval pipeline activity, and Redux state directly without round-tripping through the user.

## Problem

1. `apps/desktop/src/lib/poll-log.ts` keeps the last 100 unique game state snapshots, but only in memory under `window.__pollLog`. The assistant cannot access them without the user pasting from DevTools.
2. Eval listeners (`mapListeners.ts`, `cardRewardEvalListener.ts`, `restSiteEvalListener.ts`, etc.) make API calls to `apps/web/src/app/api/evaluate` and dispatch results to Redux, but neither the request payloads, the parsed responses, nor the post-processing decisions are persisted.
3. Run lifecycle decisions (resume vs. fresh start, victory/defeat detection, deck repopulation) live in closure state inside `runAnalyticsListener.ts` and `runListeners.ts` and are only observable as console logs that vanish when DevTools is closed.
4. There is no single chronological timeline that ties polls → eval triggers → API responses → Redux mutations together, which is exactly what the assistant needs to reproduce a bug from real game data.
5. Today's "elites are over-avoided" investigation stalled because the assistant could not see the LLM-returned `nodePreferences` for past evals — the user had to expand a `localStorage` blob in DevTools and paste a partial result, blocking iteration on the actual tuning question.

## Goals

- Capture every event needed to debug map evals, eval triggers, run lifecycle, and Redux state changes into a single chronological log.
- Make the log file directly readable by the assistant via the `Read` tool with no permissions friction.
- Zero overhead in production builds — the entire subsystem must compile out.
- No new user actions required: the log starts on app launch, rotates and prunes automatically.

## Non-Goals

- No log levels (info/warn/error) — JSONL `category` fields are sufficient.
- No remote shipping. Sentry already handles error telemetry; this log is local-only.
- No browsing UI. `Read` and `Grep` are enough for the assistant; the user is not the primary consumer.
- No structured query language. Plain JSONL + `Grep` covers the use cases.
- No retroactive logging. Anything that happened before the first call to `initDevLogger()` is lost.

## Approach

A single dev-only logging module in `apps/desktop/src/lib/dev-logger.ts` exposes a `logDevEvent(category, name, data)` function that any code in the desktop app can call. Internally it buffers events and flushes them as JSONL to a per-session file under Tauri's `appLogDir()`. All entry points are gated on `import.meta.env.DEV` so the production bundle tree-shakes the entire subsystem out.

Existing eval listeners and `poll-log.ts` are instrumented at their decision boundaries to call `logDevEvent` for: every unique game state poll, every eval API request and response, every map tracer invocation, every run lifecycle transition, and Redux state snapshots taken at the same trigger points.

## Architecture

### File location

Path is resolved via `@tauri-apps/plugin-fs`'s `BaseDirectory.AppLog` — Tauri's official "app log directory" base. On the developer's macOS machine this resolves to:

```
~/Library/Logs/com.sts2replay.desktop/dev-session-<ISO timestamp>.jsonl
```

Windows and Linux developers will see Tauri's platform-specific equivalent under the same `BaseDirectory.AppLog` resolution; the spec does not commit to a specific Windows path string because the canonical source is the Tauri runtime, not this document.

Tauri's FS plugin pre-allows writes to `AppLog`, so no `tauri.conf.json` capability changes are required. macOS does not restrict the assistant from reading from `~/Library/Logs/`, so the `Read` tool works directly against the resolved path.

If `appLogDir()` ever proves problematic (e.g., a future Tauri permissions tightening), the documented fallback is `<project>/.dev-logs/` (gitignored). This is recorded here so future investigators do not have to re-derive it.

### File format

JSONL — one JSON object per line. Each line is a complete event record:

```json
{"t":1775454324846,"category":"poll","name":"game_state","data":{...}}
{"t":1775454324900,"category":"eval","name":"map_should_eval","data":{"input":{...},"shouldEval":true,"reason":"actChanged"}}
{"t":1775454325120,"category":"eval","name":"map_api_request","data":{"prompt":"...","contextSummary":{...}}}
{"t":1775454327500,"category":"eval","name":"map_api_response","data":{"rankings":[...],"nodePreferences":{...},"overallAdvice":"..."}}
{"t":1775454327510,"category":"eval","name":"map_tracer_result","data":{"input":{"hpPercent":0.43,"act":2,"ascension":8},"path":[...]}}
{"t":1775454327520,"category":"state","name":"snapshot","data":{"reason":"after_map_eval","run":{...},"evaluation":{...}}}
```

Fields:

- `t` — `Date.now()` integer timestamp at log time.
- `category` — coarse bucket. Allowed values: `"poll" | "eval" | "run" | "state" | "error"`.
- `name` — fine-grained event name within the category. Convention: `<surface>_<phase>` (e.g., `map_api_response`, `card_reward_api_request`).
- `data` — opaque JSON payload. Shape depends on `name`. Not validated by the logger; consumers (the assistant) interpret per `name`.

JSONL was chosen over a single JSON array because it can be appended to incrementally without re-parsing the whole file, survives mid-write crashes, and is trivially `Grep`-able by line.

### Module surface

`apps/desktop/src/lib/dev-logger.ts`:

```ts
export function logDevEvent(
  category: "poll" | "eval" | "run" | "state" | "error",
  name: string,
  data: unknown
): void;

/** Called once at app startup. Resolves the session file path, prunes
 *  old sessions to the most recent 20, and registers the beforeunload
 *  flush handler. Safe to call multiple times — second call is a no-op. */
export async function initDevLogger(): Promise<void>;

/** Returns the current session file path, or null if init has not run
 *  or DEV mode is off. Useful for surfacing the path in console.log on
 *  first write so the user knows where the file lives. */
export function getCurrentSessionPath(): string | null;

/** Forces a flush of the buffer. Used by beforeunload and tests. */
export async function flushDevLogger(): Promise<void>;
```

In production builds (`!import.meta.env.DEV`), `logDevEvent` is a no-op that returns immediately, `initDevLogger` resolves without doing anything, and `getCurrentSessionPath` returns `null`. The module's Tauri imports are tree-shaken because every call site that touches them is wrapped in a `DEV` guard.

### Buffering and flushing

Events are appended to an in-memory `string[]` buffer (one stringified JSON line per entry). The buffer flushes when **any** of the following is true:

- Buffer length reaches **50** entries.
- **1000ms** has elapsed since the last flush (timer-based, only running while buffer is non-empty).
- Browser `beforeunload` event fires (best-effort synchronous flush — Tauri windows do fire this).

Flushing performs an `appendTextFile` against the session file. Failures are caught and dropped silently to avoid feedback loops where logging an error generates another error.

### Session lifecycle

- A new session file is created on the first `logDevEvent` call after `initDevLogger()` resolves. Filename: `dev-session-<ISO timestamp with colons replaced by dashes>.jsonl`.
- One file per app launch. App restarts produce a new file.
- File rotation: if the current session file exceeds **50MB**, the logger transparently switches to `dev-session-<timestamp>-part2.jsonl` (and `-part3`, etc.). This keeps marathon sessions from producing one unmanageable file.
- Pruning runs once at `initDevLogger()` time. Lists files matching `dev-session-*.jsonl` in the log dir, sorts by mtime descending, deletes anything beyond the **20 most recent**. Part files count toward the 20.

### Production safety

- All public functions short-circuit when `!import.meta.env.DEV`.
- The Tauri FS plugin import is dynamic (`await import("@tauri-apps/plugin-fs")`) inside the `DEV` branch so the production bundle can tree-shake it.
- `main.tsx` calls `initDevLogger()` from inside an `if (import.meta.env.DEV)` block.
- Unit tests that import the module without Tauri available will see `logDevEvent` as a no-op (the module checks for `window.__TAURI_INTERNALS__` before attempting filesystem ops).

### Phase 1 instrumentation

Every surface listed below gets wired up in this initial implementation. The pattern is mechanical: at the API request site, log the request payload; at the response site, log the parsed response.

#### Polls (one surface)

`apps/desktop/src/lib/poll-log.ts:logPoll` — already the choke-point for unique game states. Add a single `logDevEvent("poll", "game_state", state)` call alongside the existing in-memory append. This captures every distinct STS2 mod payload exactly once.

#### Eval pipelines (ten surfaces)

For each of the nine eval listeners below, log a `<type>_api_request` event before the `evaluationApi` dispatch and a `<type>_api_response` event after the `unwrap()` succeeds. The `data` payload includes whatever the listener already constructed: prompt, context, and any pre-eval inputs for the request; parsed response object for the response.

| Listener file | `<type>` |
|---|---|
| `features/map/mapListeners.ts` | `map` |
| `features/evaluation/cardRewardEvalListener.ts` | `card_reward` |
| `features/evaluation/shopEvalListener.ts` | `shop` |
| `features/evaluation/restSiteEvalListener.ts` | `rest_site` |
| `features/evaluation/eventEvalListener.ts` | `event` |
| `features/evaluation/cardSelectEvalListener.ts` | `card_select` |
| `features/evaluation/cardUpgradeEvalListener.ts` | `card_upgrade` |
| `features/evaluation/cardRemovalEvalListener.ts` | `card_removal` |
| `features/evaluation/relicSelectEvalListener.ts` | `relic_select` |

Boss briefing is the tenth eval surface but is invoked from a view component via the `evaluateBossBriefing` RTK Query mutation rather than from a dedicated listener. Instrumentation point: wrap the `evaluateBossBriefing` call site (`apps/desktop/src/views/combat/boss-briefing.tsx` per current grep) with the same `<type>_api_request` / `<type>_api_response` log pair.

#### Map eval pipeline extras (mapListeners.ts only)

In addition to the standard request/response pair:

- `eval/map_should_eval` — the `shouldEvaluateMap` input object plus the boolean result and the deciding reason.
- `eval/map_tier1_retrace` — when local re-trace runs instead of an API call (input prefs, tracer output path).
- `eval/map_tracer_result` — the tracer input (HP, gold, ascension, currentRemovalCost, prefs) and the resulting `recommendedPath`. Logged after the post-API tracer call.

#### Run lifecycle (one surface)

`runAnalyticsListener.ts`:

- `run/started` — `{runId, character, ascension, gameMode}` from the `runStarted` dispatch site.
- `run/resume_decision` — the `shouldResumeRun` args object plus the boolean result. Logged on the first menu→in-run transition of a session.
- `run/ended` — `{runId, victory, finalFloor, lastAct, causeOfDeath}` from the `runEnded`/`outcomeConfirmed` site.

#### Redux state snapshots (`state/snapshot`)

A single helper `logReduxSnapshot(store, reason)` lives in `dev-logger.ts`. It takes a Redux store reference, calls `store.getState()`, and logs the entire state under `category: "state"`, `name: "snapshot"`, with `data: { reason, ...state }`.

Trigger points:

- After every successful eval (all ten types), with `reason: "after_<type>_eval"`.
- After `runStarted`, `runEnded`, `runResumed` (resume case is detected inside the listener), with `reason: "run_<lifecycle>"`.
- Inside the global `window.onerror` and `unhandledrejection` handlers in `main.tsx`, with `reason: "uncaught_error"`.

The snapshot is **not** taken on every poll or every Redux action. Combat polls fire many times per second and would produce a uselessly large file.

#### Errors (`error/*`)

The existing `reportError` calls in `main.tsx` (uncaught errors and rejections) get a parallel `logDevEvent("error", "unhandled_<error|rejection>", {...})` call so the local log captures errors that Sentry also receives.

## Data flow

```
STS2 mod HTTP poll
        │
        ▼
gameStateApi.getGameState (RTK Query)
        │
        ▼
gameStateReceived action  ──▶  poll-log.logPoll  ──▶  logDevEvent("poll", "game_state", state)
        │
        ▼
   listeners fan out
        │
        ├─▶ runAnalyticsListener  ──▶  logDevEvent("run", "started" | "resume_decision" | "ended", {...})
        │                          ──▶  logReduxSnapshot(store, "run_lifecycle")
        │
        ├─▶ runListeners (deck/player/floor sync)  ──▶  no logging (read-mostly)
        │
        ├─▶ mapListeners
        │       ├─ logDevEvent("eval", "map_should_eval", {...})
        │       ├─ logDevEvent("eval", "map_api_request", {...})
        │       ├─ logDevEvent("eval", "map_api_response", {...})
        │       ├─ logDevEvent("eval", "map_tracer_result", {...})
        │       └─ logReduxSnapshot(store, "after_map_eval")
        │
        └─▶ other eval listeners (one per type)
                ├─ logDevEvent("eval", "<type>_api_request", {...})
                ├─ logDevEvent("eval", "<type>_api_response", {...})
                └─ logReduxSnapshot(store, "after_<type>_eval")

logDevEvent appends to in-memory buffer
        │
        ▼
flushDevLogger (batched every 50 entries / 1s / beforeunload)
        │
        ▼
@tauri-apps/plugin-fs.appendTextFile
        │
        ▼
~/Library/Logs/com.sts2replay.desktop/dev-session-<ts>.jsonl
        │
        ▼
Read tool consumes it directly
```

## Testing

- Unit tests for `dev-logger.ts` covering: no-op behavior in non-DEV builds, buffer batching by size, buffer batching by time, file rotation past 50MB, pruning past 20 sessions.
- Tauri FS calls are stubbed via dependency injection — `dev-logger.ts` accepts an optional `fsAdapter` parameter so tests can pass a fake.
- One end-to-end smoke test in `apps/desktop` that asserts a single `logDevEvent` call followed by `flushDevLogger` produces a readable JSONL line. This runs against the fake adapter, not real Tauri.
- No test instrumenting every listener — the listener changes are mechanical one-line additions and the assistant verifies by `Read`-ing actual session files after a real game session.

## Risks and mitigations

- **Risk:** Tauri FS plugin scope changes in a future Tauri version, breaking writes to `appLogDir`.
  **Mitigation:** Documented fallback to `<project>/.dev-logs/`. The `appLogDir` choice is also Tauri's official recommendation, so a regression would be a Tauri-side bug we report upstream.

- **Risk:** Snapshot payloads are large (full Redux state including run history). 50MB rotation may trip earlier than expected during long sessions.
  **Mitigation:** Rotation is automatic and the assistant can read `dev-session-<ts>-part2.jsonl` exactly the same as part1. If files become unwieldy in practice, a follow-up can strip noisy slices (e.g., omit `evaluation.evals` from snapshots after an initial full one per session).

- **Risk:** Logging-induced perf regressions on hot poll paths.
  **Mitigation:** All `logDevEvent` calls are append-to-array (O(1)). Stringification happens during flush, not during call. Production builds tree-shake the entire module. Worst case in dev: a 1ms-per-poll overhead is acceptable for an opt-in dev tool.

- **Risk:** Sensitive data (auth tokens, user IDs) leaks into the log.
  **Mitigation:** This is dev-only on the developer's own machine. The log files never leave the host. Sentry already has the same data with the same trust boundary.

## Open questions

None. Design approved 2026-04-06.
