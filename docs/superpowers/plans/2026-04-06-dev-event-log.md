# Dev Event Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dev-only JSONL event log under Tauri's `appLogDir` capturing every game state poll, eval API request/response, run lifecycle decision, and Redux state snapshot, so the assistant can `Read` recent activity directly without round-tripping through DevTools.

**Architecture:** A single `apps/desktop/src/lib/dev-logger.ts` module with a buffered `logDevEvent(category, name, data)` API. Tauri FS plugin handles disk writes; an injected adapter keeps the module unit-testable. All entry points are gated on `import.meta.env.DEV` so production builds tree-shake the subsystem out. Existing eval listeners and `poll-log.ts` get one-line instrumentation calls at their decision boundaries.

**Tech Stack:** TypeScript, Vitest, Redux Toolkit, Tauri 2.x with `@tauri-apps/plugin-fs` and `tauri-plugin-fs`, `@tauri-apps/api/path` for `appLogDir` resolution.

**Spec:** `docs/superpowers/specs/2026-04-06-dev-event-log-design.md`

---

## File Structure

**Created:**
- `apps/desktop/src/lib/dev-logger.ts` — main logger module (single responsibility: buffer + flush JSONL events with injectable FS adapter)
- `apps/desktop/src/lib/__tests__/dev-logger.test.ts` — unit tests using fake adapter

**Modified (logger setup):**
- `apps/desktop/package.json` — add `@tauri-apps/plugin-fs`
- `apps/desktop/src-tauri/Cargo.toml` — add `tauri-plugin-fs`
- `apps/desktop/src-tauri/src/lib.rs` — register `tauri_plugin_fs::init()`
- `apps/desktop/src-tauri/capabilities/default.json` — grant `fs:default` and AppLog scope
- `apps/desktop/src/main.tsx` — call `initDevLogger()` inside `import.meta.env.DEV` block; log uncaught errors via `logDevEvent`

**Modified (instrumentation):**
- `apps/desktop/src/lib/poll-log.ts` — add `logDevEvent("poll","game_state",...)` call
- `apps/desktop/src/features/run/runAnalyticsListener.ts` — log run/started, run/resume_decision, run/ended + Redux snapshots
- `apps/desktop/src/features/map/mapListeners.ts` — log map_should_eval, map_api_request, map_api_response, map_tracer_result, map_tier1_retrace + Redux snapshot
- `apps/desktop/src/features/evaluation/cardRewardEvalListener.ts` — log card_reward_api_request/response + snapshot
- `apps/desktop/src/features/evaluation/shopEvalListener.ts` — log shop_api_request/response + snapshot
- `apps/desktop/src/features/evaluation/restSiteEvalListener.ts` — log rest_site_api_request/response + snapshot
- `apps/desktop/src/features/evaluation/eventEvalListener.ts` — log event_api_request/response + snapshot
- `apps/desktop/src/features/evaluation/cardSelectEvalListener.ts` — log card_select_api_request/response + snapshot
- `apps/desktop/src/features/evaluation/cardUpgradeEvalListener.ts` — log card_upgrade_api_request/response + snapshot
- `apps/desktop/src/features/evaluation/cardRemovalEvalListener.ts` — log card_removal_api_request/response + snapshot
- `apps/desktop/src/features/evaluation/relicSelectEvalListener.ts` — log relic_select_api_request/response + snapshot
- `apps/desktop/src/views/combat/boss-briefing.tsx` — log boss_briefing_api_request/response + snapshot

---

## Task 1: Add Tauri FS plugin dependencies (JS + Rust + capabilities)

**Files:**
- Modify: `apps/desktop/package.json` (add `@tauri-apps/plugin-fs` to `dependencies`)
- Modify: `apps/desktop/src-tauri/Cargo.toml` (add `tauri-plugin-fs = "2"` to `[dependencies]`)
- Modify: `apps/desktop/src-tauri/src/lib.rs:120` (register plugin)
- Modify: `apps/desktop/src-tauri/capabilities/default.json` (add fs permissions)

- [ ] **Step 1: Install JS dependency**

```bash
npm install @tauri-apps/plugin-fs -w apps/desktop
```

Expected: `added 1 package` (or similar). `package-lock.json` updates.

- [ ] **Step 2: Add Rust dependency to Cargo.toml**

Add this line to `apps/desktop/src-tauri/Cargo.toml` after the existing `tauri-plugin-shell = "2"` line (around line 27):

```toml
tauri-plugin-fs = "2"
```

- [ ] **Step 3: Register plugin in lib.rs**

In `apps/desktop/src-tauri/src/lib.rs`, after the line `.plugin(tauri_plugin_http::init())` (around line 120), add:

```rust
.plugin(tauri_plugin_fs::init())
```

- [ ] **Step 4: Grant fs permissions in capabilities**

Replace the `permissions` array in `apps/desktop/src-tauri/capabilities/default.json` to add `fs:default` and AppLog scope. The full updated permissions array should be:

```json
"permissions": [
  "core:default",
  "updater:default",
  "process:default",
  "deep-link:default",
  "shell:allow-open",
  "fs:default",
  "fs:allow-applog-write-recursive",
  "fs:allow-applog-read-recursive",
  "fs:allow-applog-meta-recursive",
  {
    "identifier": "http:default",
    "allow": [
      { "url": "https://sts2-helper.vercel.app/**" },
      { "url": "https://sts2replay.com/**" },
      { "url": "https://api.sts2replay.com/**" },
      { "url": "https://*.supabase.co/**" },
      { "url": "wss://*.supabase.co/**" }
    ]
  }
]
```

- [ ] **Step 5: Verify Rust compile**

Run: `cd apps/desktop/src-tauri && cargo check 2>&1 | tail -20`
Expected: `Finished \`dev\` profile` with no errors. If permissions identifiers don't match what plugin-fs 2.x ships, cargo check still succeeds (capabilities are validated at runtime by Tauri build, not by cargo). The runtime check happens in Step 6.

- [ ] **Step 6: Verify Tauri build passes capability validation**

Run: `cd apps/desktop && npx tauri build --debug --no-bundle 2>&1 | tail -30`
Expected: Build completes. If a permission identifier is invalid, Tauri prints `The permission "fs:allow-applog-write-recursive" does not exist` (or similar) and you must consult the plugin-fs README for the correct names. Edit `default.json` and re-run until clean.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/package.json package-lock.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/capabilities/default.json
git commit -m "chore: add tauri plugin-fs dependency and AppLog capability"
```

---

## Task 2: Create dev-logger.ts skeleton with no-op behavior

**Files:**
- Create: `apps/desktop/src/lib/dev-logger.ts`
- Create: `apps/desktop/src/lib/__tests__/dev-logger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/lib/__tests__/dev-logger.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  __setFsAdapterForTest,
  __setDevModeForTest,
  __resetForTest,
  logDevEvent,
  flushDevLogger,
  getCurrentSessionPath,
} from "../dev-logger";

interface FakeFs {
  appendCalls: { path: string; content: string }[];
  existsCalls: string[];
  files: Map<string, string>;
  fileSizes: Map<string, number>;
  dirEntries: { name: string; mtime: number }[];
  removed: string[];
}

function makeFakeFs(): FakeFs & {
  appLogDir: () => Promise<string>;
  exists: (p: string) => Promise<boolean>;
  mkdir: (p: string, opts: { recursive: boolean }) => Promise<void>;
  appendTextFile: (p: string, content: string) => Promise<void>;
  stat: (p: string) => Promise<{ size: number }>;
  readDir: (p: string) => Promise<{ name: string; mtime: number }[]>;
  remove: (p: string) => Promise<void>;
} {
  const state: FakeFs = {
    appendCalls: [],
    existsCalls: [],
    files: new Map(),
    fileSizes: new Map(),
    dirEntries: [],
    removed: [],
  };
  return {
    ...state,
    appLogDir: async () => "/tmp/fake-applog",
    exists: async (p) => {
      state.existsCalls.push(p);
      return state.files.has(p);
    },
    mkdir: async () => {},
    appendTextFile: async (p, content) => {
      state.appendCalls.push({ path: p, content });
      state.files.set(p, (state.files.get(p) ?? "") + content);
      state.fileSizes.set(p, (state.fileSizes.get(p) ?? 0) + content.length);
    },
    stat: async (p) => ({ size: state.fileSizes.get(p) ?? 0 }),
    readDir: async () => state.dirEntries,
    remove: async (p) => {
      state.removed.push(p);
      state.files.delete(p);
    },
  };
}

describe("dev-logger", () => {
  beforeEach(() => {
    __resetForTest();
    __setDevModeForTest(true);
    __setFsAdapterForTest(makeFakeFs());
  });

  it("is a no-op when DEV mode is off", async () => {
    __setDevModeForTest(false);
    logDevEvent("poll", "game_state", { hp: 80 });
    await flushDevLogger();
    expect(getCurrentSessionPath()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w apps/desktop -- --run dev-logger 2>&1 | tail -20`
Expected: FAIL — `Cannot find module '../dev-logger'`

- [ ] **Step 3: Create the skeleton**

Create `apps/desktop/src/lib/dev-logger.ts`:

```ts
/**
 * Dev-only event logger. Buffers structured events as JSONL and flushes
 * to a per-session file under Tauri's appLogDir. All public functions
 * are no-ops when import.meta.env.DEV is false so the production bundle
 * tree-shakes this module out.
 *
 * See: docs/superpowers/specs/2026-04-06-dev-event-log-design.md
 */

export type DevLogCategory = "poll" | "eval" | "run" | "state" | "error";

export interface DevLogEvent {
  t: number;
  category: DevLogCategory;
  name: string;
  data: unknown;
}

export interface FsAdapter {
  appLogDir(): Promise<string>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, opts: { recursive: boolean }): Promise<void>;
  appendTextFile(path: string, content: string): Promise<void>;
  stat(path: string): Promise<{ size: number }>;
  readDir(path: string): Promise<{ name: string; mtime: number }[]>;
  remove(path: string): Promise<void>;
}

let isDev = import.meta.env.DEV;
let fsAdapter: FsAdapter | null = null;
let buffer: string[] = [];
let sessionPath: string | null = null;

export function logDevEvent(
  _category: DevLogCategory,
  _name: string,
  _data: unknown
): void {
  if (!isDev) return;
  // Implemented in Task 3.
}

export async function flushDevLogger(): Promise<void> {
  if (!isDev) return;
  // Implemented in Task 3.
}

export async function initDevLogger(): Promise<void> {
  if (!isDev) return;
  // Implemented in Task 4.
}

export function getCurrentSessionPath(): string | null {
  if (!isDev) return null;
  return sessionPath;
}

// --- Test hooks ---
// These are gated to test usage only. Do not call from production code.

export function __setDevModeForTest(value: boolean): void {
  isDev = value;
}

export function __setFsAdapterForTest(adapter: FsAdapter): void {
  fsAdapter = adapter;
}

export function __resetForTest(): void {
  buffer = [];
  sessionPath = null;
  fsAdapter = null;
  isDev = import.meta.env.DEV;
}

// Silence unused-var lint until later tasks fill these in.
void buffer;
void fsAdapter;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w apps/desktop -- --run dev-logger 2>&1 | tail -10`
Expected: 1 test passed.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/dev-logger.ts apps/desktop/src/lib/__tests__/dev-logger.test.ts
git commit -m "feat: dev-logger skeleton with no-op DEV gating"
```

---

## Task 3: Implement event buffering and JSONL serialization

**Files:**
- Modify: `apps/desktop/src/lib/dev-logger.ts`
- Modify: `apps/desktop/src/lib/__tests__/dev-logger.test.ts`

- [ ] **Step 1: Add failing tests for buffering**

Append to `apps/desktop/src/lib/__tests__/dev-logger.test.ts` inside the `describe("dev-logger", ...)` block:

```ts
  it("buffers events as JSONL lines and writes them on flush", async () => {
    const fs = makeFakeFs();
    __setFsAdapterForTest(fs);
    // Pre-set sessionPath so logDevEvent doesn't need init
    // (init is tested separately in Task 4)
    (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride = "/tmp/fake-applog/dev-session-test.jsonl";

    logDevEvent("poll", "game_state", { hp: 80, floor: 12 });
    logDevEvent("eval", "map_api_response", { rankings: [] });

    await flushDevLogger();

    expect(fs.appendCalls).toHaveLength(1);
    const lines = fs.appendCalls[0].content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.category).toBe("poll");
    expect(first.name).toBe("game_state");
    expect(first.data).toEqual({ hp: 80, floor: 12 });
    expect(typeof first.t).toBe("number");

    const second = JSON.parse(lines[1]);
    expect(second.category).toBe("eval");
    expect(second.name).toBe("map_api_response");

    delete (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride;
  });

  it("flushes automatically when buffer reaches 50 entries", async () => {
    const fs = makeFakeFs();
    __setFsAdapterForTest(fs);
    (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride = "/tmp/fake-applog/dev-session-test.jsonl";

    for (let i = 0; i < 50; i++) {
      logDevEvent("poll", "game_state", { i });
    }
    // Allow microtask flush
    await new Promise((r) => setTimeout(r, 10));

    expect(fs.appendCalls.length).toBeGreaterThan(0);
    const totalLines = fs.appendCalls
      .flatMap((c) => c.content.trim().split("\n"))
      .filter(Boolean).length;
    expect(totalLines).toBe(50);

    delete (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride;
  });

  it("drops events silently when fs append throws", async () => {
    const fs = makeFakeFs();
    fs.appendTextFile = async () => {
      throw new Error("disk full");
    };
    __setFsAdapterForTest(fs);
    (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride = "/tmp/fake-applog/dev-session-test.jsonl";

    logDevEvent("poll", "game_state", { hp: 80 });
    // Should not throw
    await expect(flushDevLogger()).resolves.toBeUndefined();

    delete (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride;
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w apps/desktop -- --run dev-logger 2>&1 | tail -20`
Expected: 3 new tests fail.

- [ ] **Step 3: Implement buffering and flushing**

Replace the body of `dev-logger.ts` (keeping the same exports). The full file contents:

```ts
/**
 * Dev-only event logger. Buffers structured events as JSONL and flushes
 * to a per-session file under Tauri's appLogDir. All public functions
 * are no-ops when import.meta.env.DEV is false so the production bundle
 * tree-shakes this module out.
 *
 * See: docs/superpowers/specs/2026-04-06-dev-event-log-design.md
 */

export type DevLogCategory = "poll" | "eval" | "run" | "state" | "error";

export interface DevLogEvent {
  t: number;
  category: DevLogCategory;
  name: string;
  data: unknown;
}

export interface FsAdapter {
  appLogDir(): Promise<string>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, opts: { recursive: boolean }): Promise<void>;
  appendTextFile(path: string, content: string): Promise<void>;
  stat(path: string): Promise<{ size: number }>;
  readDir(path: string): Promise<{ name: string; mtime: number }[]>;
  remove(path: string): Promise<void>;
}

const FLUSH_THRESHOLD_LINES = 50;
const FLUSH_INTERVAL_MS = 1000;

let isDev = import.meta.env.DEV;
let fsAdapter: FsAdapter | null = null;
let buffer: string[] = [];
let sessionPath: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight: Promise<void> | null = null;

function resolveSessionPath(): string | null {
  // Test override hook — bypasses initDevLogger.
  const override = (globalThis as Record<string, unknown>)
    .__devLoggerSessionPathOverride;
  if (typeof override === "string") return override;
  return sessionPath;
}

function scheduleFlush(): void {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushDevLogger();
  }, FLUSH_INTERVAL_MS);
}

export function logDevEvent(
  category: DevLogCategory,
  name: string,
  data: unknown
): void {
  if (!isDev) return;
  const event: DevLogEvent = { t: Date.now(), category, name, data };
  let line: string;
  try {
    line = JSON.stringify(event);
  } catch {
    // Unserializable payload — drop silently to avoid feedback loops.
    return;
  }
  buffer.push(line);
  if (buffer.length >= FLUSH_THRESHOLD_LINES) {
    void flushDevLogger();
  } else {
    scheduleFlush();
  }
}

export async function flushDevLogger(): Promise<void> {
  if (!isDev) return;
  if (flushInFlight) return flushInFlight;
  if (buffer.length === 0) return;

  const path = resolveSessionPath();
  if (!path || !fsAdapter) {
    // Not initialized yet — keep buffering.
    return;
  }

  const toWrite = buffer.join("\n") + "\n";
  buffer = [];

  flushInFlight = (async () => {
    try {
      await fsAdapter!.appendTextFile(path, toWrite);
    } catch {
      // Drop silently — logging an error here would loop.
    }
  })();

  try {
    await flushInFlight;
  } finally {
    flushInFlight = null;
  }
}

export async function initDevLogger(): Promise<void> {
  if (!isDev) return;
  // Implemented in Task 4.
}

export function getCurrentSessionPath(): string | null {
  if (!isDev) return null;
  return sessionPath;
}

// --- Test hooks ---

export function __setDevModeForTest(value: boolean): void {
  isDev = value;
}

export function __setFsAdapterForTest(adapter: FsAdapter): void {
  fsAdapter = adapter;
}

export function __resetForTest(): void {
  buffer = [];
  sessionPath = null;
  fsAdapter = null;
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushInFlight = null;
  isDev = import.meta.env.DEV;
  delete (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w apps/desktop -- --run dev-logger 2>&1 | tail -15`
Expected: 4 tests pass (skeleton no-op + 3 new buffering tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/dev-logger.ts apps/desktop/src/lib/__tests__/dev-logger.test.ts
git commit -m "feat: dev-logger event buffering and JSONL flush"
```

---

## Task 4: Implement initDevLogger session file resolution and pruning

**Files:**
- Modify: `apps/desktop/src/lib/dev-logger.ts`
- Modify: `apps/desktop/src/lib/__tests__/dev-logger.test.ts`

- [ ] **Step 1: Add failing tests for init and pruning**

Append inside the `describe("dev-logger", ...)` block:

```ts
  it("initDevLogger creates a session file path under appLogDir", async () => {
    const fs = makeFakeFs();
    __setFsAdapterForTest(fs);

    await initDevLogger();
    const path = getCurrentSessionPath();
    expect(path).toMatch(/^\/tmp\/fake-applog\/dev-session-/);
    expect(path).toMatch(/\.jsonl$/);
  });

  it("initDevLogger prunes session files beyond the most recent 20", async () => {
    const fs = makeFakeFs();
    // Pretend 25 existing session files of varying ages
    fs.dirEntries = Array.from({ length: 25 }, (_, i) => ({
      name: `dev-session-2026-04-0${(i % 9) + 1}T10-00-00.jsonl`,
      mtime: 1000 + i,
    }));
    __setFsAdapterForTest(fs);

    await initDevLogger();

    // 25 existing - 20 to keep = 5 deleted (the oldest by mtime)
    expect(fs.removed).toHaveLength(5);
    // The 5 oldest (mtime 1000-1004) should be the ones removed
    const removedNames = fs.removed.map((p) => p.split("/").pop());
    expect(removedNames).toContain("dev-session-2026-04-01T10-00-00.jsonl");
  });

  it("initDevLogger ignores non-session files in the log dir", async () => {
    const fs = makeFakeFs();
    fs.dirEntries = [
      { name: "tauri.log", mtime: 1000 },
      { name: "dev-session-2026-04-06T10-00-00.jsonl", mtime: 2000 },
      { name: "other-file.txt", mtime: 3000 },
    ];
    __setFsAdapterForTest(fs);

    await initDevLogger();

    expect(fs.removed).toHaveLength(0);
  });

  it("initDevLogger is a no-op when DEV mode is off", async () => {
    __setDevModeForTest(false);
    const fs = makeFakeFs();
    __setFsAdapterForTest(fs);
    await initDevLogger();
    expect(getCurrentSessionPath()).toBeNull();
    expect(fs.removed).toHaveLength(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w apps/desktop -- --run dev-logger 2>&1 | tail -20`
Expected: 4 new tests fail with `getCurrentSessionPath()` returning null after init.

- [ ] **Step 3: Implement initDevLogger and pruning**

In `dev-logger.ts`, replace the empty `initDevLogger` function with the full implementation. Add a `MAX_SESSIONS` constant near the other constants and a `pruneSessions` helper. The new pieces:

```ts
const MAX_SESSIONS = 20;
const SESSION_FILE_PREFIX = "dev-session-";
const SESSION_FILE_EXT = ".jsonl";

function buildSessionFileName(timestamp: Date): string {
  // ISO timestamp with colons → dashes for filesystem safety
  const iso = timestamp.toISOString().replace(/:/g, "-").replace(/\..+$/, "");
  return `${SESSION_FILE_PREFIX}${iso}${SESSION_FILE_EXT}`;
}

async function pruneOldSessions(adapter: FsAdapter, dir: string): Promise<void> {
  let entries: { name: string; mtime: number }[];
  try {
    entries = await adapter.readDir(dir);
  } catch {
    return;
  }
  const sessions = entries.filter(
    (e) => e.name.startsWith(SESSION_FILE_PREFIX) && e.name.endsWith(SESSION_FILE_EXT)
  );
  if (sessions.length <= MAX_SESSIONS) return;

  sessions.sort((a, b) => b.mtime - a.mtime); // newest first
  const toDelete = sessions.slice(MAX_SESSIONS);
  for (const entry of toDelete) {
    try {
      await adapter.remove(`${dir}/${entry.name}`);
    } catch {
      // Best-effort cleanup; ignore individual failures.
    }
  }
}

export async function initDevLogger(): Promise<void> {
  if (!isDev) return;
  if (sessionPath != null) return; // Already initialized.
  if (!fsAdapter) {
    // Production code path: lazy-load the real Tauri adapter.
    fsAdapter = await loadTauriFsAdapter();
  }
  if (!fsAdapter) return;

  let dir: string;
  try {
    dir = await fsAdapter.appLogDir();
  } catch {
    return;
  }

  try {
    const dirExists = await fsAdapter.exists(dir);
    if (!dirExists) {
      await fsAdapter.mkdir(dir, { recursive: true });
    }
  } catch {
    // mkdir failures are non-fatal; appendTextFile will surface real errors.
  }

  await pruneOldSessions(fsAdapter, dir);

  const fileName = buildSessionFileName(new Date());
  sessionPath = `${dir}/${fileName}`;
  // eslint-disable-next-line no-console
  console.info(`[dev-logger] Session file: ${sessionPath}`);
}

async function loadTauriFsAdapter(): Promise<FsAdapter | null> {
  // Real adapter implemented in Task 5. For now, return null so unit tests
  // (which inject their own adapter) drive coverage.
  return null;
}
```

Also update the `resolveSessionPath` helper to use the actual `sessionPath` after init (no behavior change — it already returns `sessionPath`, so the existing implementation stands).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w apps/desktop -- --run dev-logger 2>&1 | tail -15`
Expected: 8 tests pass (4 prior + 4 new).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/dev-logger.ts apps/desktop/src/lib/__tests__/dev-logger.test.ts
git commit -m "feat: dev-logger init with session path and 20-file pruning"
```

---

## Task 5: Implement the real Tauri FS adapter

**Files:**
- Modify: `apps/desktop/src/lib/dev-logger.ts`

- [ ] **Step 1: Implement loadTauriFsAdapter using @tauri-apps/plugin-fs**

Replace the placeholder `loadTauriFsAdapter` in `dev-logger.ts` with the real implementation:

```ts
async function loadTauriFsAdapter(): Promise<FsAdapter | null> {
  // Only attempt to load Tauri APIs in a Tauri runtime.
  if (typeof window === "undefined") return null;
  if (!(window as Record<string, unknown>).__TAURI_INTERNALS__) return null;

  try {
    const [pathMod, fsMod] = await Promise.all([
      import("@tauri-apps/api/path"),
      import("@tauri-apps/plugin-fs"),
    ]);

    return {
      appLogDir: () => pathMod.appLogDir(),
      exists: (p) => fsMod.exists(p),
      mkdir: (p, opts) => fsMod.mkdir(p, opts),
      appendTextFile: async (p, content) => {
        // Tauri's writeTextFile doesn't have a native append flag in
        // plugin-fs 2.x — read existing then write back. For our usage
        // (small per-flush batches), the read cost is negligible.
        let existing = "";
        try {
          if (await fsMod.exists(p)) {
            existing = await fsMod.readTextFile(p);
          }
        } catch {
          existing = "";
        }
        await fsMod.writeTextFile(p, existing + content);
      },
      stat: async (p) => {
        const meta = await fsMod.stat(p);
        return { size: Number(meta.size) };
      },
      readDir: async (p) => {
        const entries = await fsMod.readDir(p);
        // plugin-fs 2.x DirEntry doesn't include mtime — need a stat per file
        const enriched = await Promise.all(
          entries.map(async (e) => {
            try {
              const meta = await fsMod.stat(`${p}/${e.name}`);
              const mtimeMs = meta.mtime ? new Date(meta.mtime).getTime() : 0;
              return { name: e.name, mtime: mtimeMs };
            } catch {
              return { name: e.name, mtime: 0 };
            }
          })
        );
        return enriched;
      },
      remove: (p) => fsMod.remove(p),
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `npm test -w apps/desktop -- --run dev-logger 2>&1 | tail -10`
Expected: 8 tests pass (no new tests; this code path is exercised in real runtime).

- [ ] **Step 3: Verify TypeScript compiles with the new imports**

Run: `npm run lint -w apps/desktop 2>&1 | tail -10`
Expected: No errors. If `@tauri-apps/plugin-fs` types are missing, Task 1 was incomplete — go back and verify the install.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/dev-logger.ts
git commit -m "feat: dev-logger Tauri FS adapter via @tauri-apps/plugin-fs"
```

---

## Task 6: Add 50MB file rotation

**Files:**
- Modify: `apps/desktop/src/lib/dev-logger.ts`
- Modify: `apps/desktop/src/lib/__tests__/dev-logger.test.ts`

- [ ] **Step 1: Add failing test for rotation**

Append inside the `describe("dev-logger", ...)` block:

```ts
  it("rotates session file when it exceeds 50MB", async () => {
    const fs = makeFakeFs();
    __setFsAdapterForTest(fs);

    // Pre-populate session at 49.9MB
    const path = "/tmp/fake-applog/dev-session-2026-04-06T10-00-00.jsonl";
    fs.fileSizes.set(path, 49.9 * 1024 * 1024);
    fs.files.set(path, "x");
    (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride = path;

    // Push enough events to push past 50MB on flush
    const big = "y".repeat(200 * 1024); // 200KB per event
    for (let i = 0; i < 5; i++) {
      logDevEvent("poll", "game_state", { payload: big });
    }
    await flushDevLogger();
    // Trigger another event that should land on a part2 file
    logDevEvent("poll", "game_state", { after: "rotation" });
    await flushDevLogger();

    const writtenPaths = new Set(fs.appendCalls.map((c) => c.path));
    const part2 = [...writtenPaths].find((p) => p.includes("-part2.jsonl"));
    expect(part2).toBeDefined();

    delete (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride;
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w apps/desktop -- --run dev-logger 2>&1 | tail -15`
Expected: New test fails — no part2 file created.

- [ ] **Step 3: Implement rotation in flushDevLogger**

In `dev-logger.ts`, add a constant and update the flush logic. Add near the other constants:

```ts
const MAX_FILE_BYTES = 50 * 1024 * 1024;
```

Update `resolveSessionPath` to handle a per-file rotation index. Add a module-level `rotationIndex` and update the resolver:

```ts
let rotationIndex = 1;

function rotatedPath(basePath: string, index: number): string {
  if (index <= 1) return basePath;
  // Inject -partN before the .jsonl extension
  return basePath.replace(/\.jsonl$/, `-part${index}.jsonl`);
}
```

Update `flushDevLogger` to check size before appending and bump `rotationIndex` if needed. Replace the existing `flushDevLogger` body:

```ts
export async function flushDevLogger(): Promise<void> {
  if (!isDev) return;
  if (flushInFlight) return flushInFlight;
  if (buffer.length === 0) return;

  const basePath = resolveSessionPath();
  if (!basePath || !fsAdapter) return;

  const toWrite = buffer.join("\n") + "\n";
  buffer = [];

  flushInFlight = (async () => {
    try {
      let targetPath = rotatedPath(basePath, rotationIndex);
      // Check current file size; rotate if it would exceed the cap.
      try {
        if (await fsAdapter!.exists(targetPath)) {
          const meta = await fsAdapter!.stat(targetPath);
          if (meta.size + toWrite.length > MAX_FILE_BYTES) {
            rotationIndex += 1;
            targetPath = rotatedPath(basePath, rotationIndex);
          }
        }
      } catch {
        // stat failures are non-fatal; just write to current target.
      }
      await fsAdapter!.appendTextFile(targetPath, toWrite);
    } catch {
      // Drop silently.
    }
  })();

  try {
    await flushInFlight;
  } finally {
    flushInFlight = null;
  }
}
```

Also update `__resetForTest` to reset `rotationIndex`:

```ts
export function __resetForTest(): void {
  buffer = [];
  sessionPath = null;
  fsAdapter = null;
  rotationIndex = 1;
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushInFlight = null;
  isDev = import.meta.env.DEV;
  delete (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w apps/desktop -- --run dev-logger 2>&1 | tail -15`
Expected: 9 tests pass (8 prior + 1 rotation).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/dev-logger.ts apps/desktop/src/lib/__tests__/dev-logger.test.ts
git commit -m "feat: dev-logger 50MB file rotation"
```

---

## Task 7: Add logReduxSnapshot helper

**Files:**
- Modify: `apps/desktop/src/lib/dev-logger.ts`
- Modify: `apps/desktop/src/lib/__tests__/dev-logger.test.ts`

- [ ] **Step 1: Add failing test**

Append to the test file:

```ts
import { logReduxSnapshot } from "../dev-logger";

// ... add inside describe block ...

  it("logReduxSnapshot logs a state/snapshot event with reason and full state", async () => {
    const fs = makeFakeFs();
    __setFsAdapterForTest(fs);
    (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride = "/tmp/fake-applog/dev-session-test.jsonl";

    const fakeStore = {
      getState: () => ({ run: { activeRunId: "abc" }, evaluation: { evals: {} } }),
    };
    logReduxSnapshot(fakeStore, "after_map_eval");
    await flushDevLogger();

    expect(fs.appendCalls).toHaveLength(1);
    const event = JSON.parse(fs.appendCalls[0].content.trim());
    expect(event.category).toBe("state");
    expect(event.name).toBe("snapshot");
    expect(event.data.reason).toBe("after_map_eval");
    expect(event.data.run.activeRunId).toBe("abc");
    expect(event.data.evaluation).toBeDefined();

    delete (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride;
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w apps/desktop -- --run dev-logger 2>&1 | tail -15`
Expected: Fails — `logReduxSnapshot` is not exported.

- [ ] **Step 3: Implement logReduxSnapshot**

Append to `dev-logger.ts`:

```ts
/**
 * Capture a full Redux state snapshot. Called from listeners at meaningful
 * checkpoints (after each eval, after run lifecycle changes, on uncaught
 * errors). Not auto-fired on every action — combat polls would generate
 * an unmanageable volume.
 */
export function logReduxSnapshot(
  store: { getState: () => unknown },
  reason: string
): void {
  if (!isDev) return;
  let state: unknown;
  try {
    state = store.getState();
  } catch {
    return;
  }
  logDevEvent("state", "snapshot", { reason, ...(state as object) });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w apps/desktop -- --run dev-logger 2>&1 | tail -15`
Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/dev-logger.ts apps/desktop/src/lib/__tests__/dev-logger.test.ts
git commit -m "feat: logReduxSnapshot helper for state captures"
```

---

## Task 8: Wire initDevLogger into main.tsx and add beforeunload flush

**Files:**
- Modify: `apps/desktop/src/main.tsx`
- Modify: `apps/desktop/src/lib/dev-logger.ts`

- [ ] **Step 1: Add beforeunload flush in dev-logger.ts**

In `dev-logger.ts`, register a `beforeunload` listener inside `initDevLogger` after the session path is set. Add this just before the `console.info` line:

```ts
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      void flushDevLogger();
    });
  }
```

- [ ] **Step 2: Wire init into main.tsx**

In `apps/desktop/src/main.tsx`, after the existing imports and before the `Sentry.init` call, add the dev-logger import and DEV-gated init. Add to the imports near the top:

```ts
import { initDevLogger, logDevEvent } from "./lib/dev-logger";
```

Then, after the `initErrorReporter({...})` call (around line 31, just before the `// Configure shared package for desktop environment` comment), add:

```ts
if (import.meta.env.DEV) {
  initDevLogger().catch((err) => {
    console.error("[dev-logger] init failed", err);
  });
}
```

- [ ] **Step 3: Add error event logging to existing handlers**

In the same `main.tsx`, locate the existing `window.onerror` and `window.addEventListener("unhandledrejection", ...)` blocks (around line 69-80). Add a `logDevEvent` call to each so unhandled errors hit the dev log too.

Replace the existing `window.onerror` block with:

```ts
window.onerror = (message, source, lineno, colno, error) => {
  reportError("unhandled_error", String(message), {
    source, lineno, colno,
    stack: error?.stack,
  });
  logDevEvent("error", "unhandled_error", {
    message: String(message),
    source, lineno, colno,
    stack: error?.stack,
  });
};
```

Replace the existing `unhandledrejection` block with:

```ts
window.addEventListener("unhandledrejection", (e) => {
  reportError("unhandled_rejection", e.reason?.message ?? String(e.reason), {
    stack: e.reason?.stack,
  });
  logDevEvent("error", "unhandled_rejection", {
    message: e.reason?.message ?? String(e.reason),
    stack: e.reason?.stack,
  });
});
```

- [ ] **Step 4: Verify tests still pass and lint is clean**

Run: `npm test -w apps/desktop -- --run dev-logger 2>&1 | tail -10 && npm run lint -w apps/desktop 2>&1 | tail -10`
Expected: 10 tests pass, lint clean.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/dev-logger.ts apps/desktop/src/main.tsx
git commit -m "feat: initialize dev-logger in main.tsx and wire error handlers"
```

---

## Task 9: Instrument poll-log.ts

**Files:**
- Modify: `apps/desktop/src/lib/poll-log.ts`

- [ ] **Step 1: Add logDevEvent call in logPoll**

In `apps/desktop/src/lib/poll-log.ts`, import the logger and call it inside `logPoll` after the dedupe check. The full updated `logPoll` function:

```ts
import { logDevEvent } from "./dev-logger";

// ... existing code ...

export function logPoll(state: GameState): void {
  const json = JSON.stringify(state);
  if (json === lastJson) return;
  lastJson = json;

  entries.push({
    timestamp: Date.now(),
    stateType: state.state_type,
    snapshot: state,
  });

  if (entries.length > MAX_ENTRIES) {
    entries.shift();
  }

  logDevEvent("poll", "game_state", state);
}
```

- [ ] **Step 2: Verify tests still pass**

Run: `npm test -w apps/desktop 2>&1 | tail -10`
Expected: All tests pass (190 + 10 dev-logger = 200, give or take).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/lib/poll-log.ts
git commit -m "feat: log unique game state polls to dev event log"
```

---

## Task 10: Instrument runAnalyticsListener.ts (run lifecycle + snapshots)

**Files:**
- Modify: `apps/desktop/src/features/run/runAnalyticsListener.ts`

- [ ] **Step 1: Add imports and instrumentation**

In `apps/desktop/src/features/run/runAnalyticsListener.ts`, add the import near the other imports (around line 30-31):

```ts
import { logDevEvent, logReduxSnapshot } from "../../lib/dev-logger";
```

- [ ] **Step 2: Log resume decision in the resume branch**

Find the resume block (around lines 289-308 — the `shouldResumeRun` call site). After the `const canResume = shouldResumeRun({...})` call, add:

```ts
        logDevEvent("run", "resume_decision", {
          input: {
            isFirstRunTransition,
            existingRunId,
            existingRunCharacter: existingRun?.character ?? null,
            existingRunDeckLen: existingRun?.deck.length ?? 0,
            character,
            ascension,
            currentFloor,
            currentAct,
          },
          canResume,
        });
```

- [ ] **Step 3: Log run/started after the new run dispatch**

In the `else` branch where `runStarted` is dispatched (around line 313), add right after `listenerApi.dispatch(runStarted({...}))`:

```ts
          logDevEvent("run", "started", {
            runId: newRunId,
            character,
            ascension,
            gameMode,
          });
          logReduxSnapshot(listenerApi as unknown as { getState: () => unknown }, "run_started");
```

Note: `listenerApi` exposes `getState` so it can be cast to the `{ getState }` shape `logReduxSnapshot` expects. The cast is intentional — Redux listener middleware doesn't expose a typed store but does expose `getState`.

- [ ] **Step 4: Log run/ended in both victory and defeat paths**

Find the victory dispatch block (around line 195 — where `runEnded` is dispatched with `inferred: true`). After the `clearEvaluationRegistry()` call but before `runActive = false`, add:

```ts
          logDevEvent("run", "ended", {
            runId: activeRunId,
            outcome: "victory",
            finalFloor: lastFloor,
            actReached: lastAct,
            bossesFought: [...bossesFought],
            finalDeckSize: lastDeckNames.length,
          });
          logReduxSnapshot(listenerApi as unknown as { getState: () => unknown }, "run_ended");
```

Find the defeat dispatch block (around line 229 — `outcomeResult === "defeat"`). After the `clearEvaluationRegistry()` call there, add the same pattern with `outcome: "defeat"` and `causeOfDeath: lastCombatEnemyName`:

```ts
          logDevEvent("run", "ended", {
            runId: activeRunId,
            outcome: "defeat",
            finalFloor: lastFloor,
            actReached: lastAct,
            causeOfDeath: lastCombatEnemyName,
            bossesFought: [...bossesFought],
            finalDeckSize: lastDeckNames.length,
          });
          logReduxSnapshot(listenerApi as unknown as { getState: () => unknown }, "run_ended");
```

Find the menu transition block (around line 364 — where `runEnded` is dispatched on menu transition). After `clearEvaluationRegistry()` there, add:

```ts
          logDevEvent("run", "ended", {
            runId: endRunId,
            outcome: "menu_transition",
            inferredVictory: victory,
            finalFloor: lastFloor,
          });
          logReduxSnapshot(listenerApi as unknown as { getState: () => unknown }, "run_ended");
```

- [ ] **Step 5: Verify tests still pass and lint is clean**

Run: `npm test -w apps/desktop 2>&1 | tail -10 && npm run lint -w apps/desktop 2>&1 | tail -10`
Expected: All tests pass, lint clean.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/run/runAnalyticsListener.ts
git commit -m "feat: log run lifecycle events to dev event log"
```

---

## Task 11: Instrument mapListeners.ts (full eval pipeline)

**Files:**
- Modify: `apps/desktop/src/features/map/mapListeners.ts`

- [ ] **Step 1: Add imports**

Add to the imports near the top of `mapListeners.ts`:

```ts
import { logDevEvent, logReduxSnapshot } from "../../lib/dev-logger";
```

- [ ] **Step 2: Log shouldEvaluateMap decision**

Find the existing pair of lines (around lines 191-192):

```ts
        const shouldEval = shouldEvaluateMap(input);
        if (!shouldEval) return;
```

Insert one new line **between** them so the log fires before the early return. Final state:

```ts
        const shouldEval = shouldEvaluateMap(input);
        logDevEvent("eval", "map_should_eval", { input, shouldEval });
        if (!shouldEval) return;
```

- [ ] **Step 3: Log Tier 1 retrace path**

Find the Tier 1 retrace block (around line 195 — the `if (currentPos && !isOnPath && storedPrefs && ...)` block). Right before `listenerApi.dispatch(mapPathRetraced(...))` near line 249, add:

```ts
          logDevEvent("eval", "map_tier1_retrace", {
            currentPos,
            storedPrefs,
            retracedPath,
            recommendedNodes: [...recommendedNodes],
          });
```

- [ ] **Step 4: Log API request before the evaluateMap dispatch**

Find the `parsed = await listenerApi.dispatch(evaluationApi.endpoints.evaluateMap.initiate({...}))` call (around line 334-344). Right before this dispatch, add:

```ts
        logDevEvent("eval", "map_api_request", {
          context: ctx,
          mapPrompt,
          floor: ctx.floor,
          act: ctx.act,
          ascension: ctx.ascension,
          hpPercent: ctx.hpPercent,
          deckSize: ctx.deckSize,
        });
```

- [ ] **Step 5: Log API response after the unwrap**

Right after the `.unwrap()` call (line 344) and before `// --- Post-API path tracing ---`, add:

```ts
        logDevEvent("eval", "map_api_response", parsed);
```

- [ ] **Step 6: Log tracer result**

Find the `const tracedPath = traceStart ? traceConstraintAwarePath({...}) : parsed.recommendedPath;` block (around line 376-382). Right after that block, add:

```ts
        logDevEvent("eval", "map_tracer_result", {
          tracerInput,
          tracedPath,
        });
```

- [ ] **Step 7: Log Redux snapshot after persisting the map eval**

Find the `listenerApi.dispatch(mapEvalUpdated({...}))` call near line 423. Right after this dispatch but before `registerLastEvaluation(...)`, add:

```ts
        logReduxSnapshot(listenerApi as unknown as { getState: () => unknown }, "after_map_eval");
```

- [ ] **Step 8: Verify tests still pass and lint is clean**

Run: `npm test -w apps/desktop 2>&1 | tail -10 && npm run lint -w apps/desktop 2>&1 | tail -10`
Expected: All tests pass, lint clean.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/features/map/mapListeners.ts
git commit -m "feat: log map eval pipeline events to dev event log"
```

---

## Task 12: Instrument the eight simpler eval listeners

This task applies the **same instrumentation pattern** to each of the eight remaining eval listeners. The pattern adds three log calls per file: one before the API dispatch, one after the unwrap, and one Redux snapshot after the success branch. Apply this pattern to **every file in the table below**.

**Files:**
- Modify: `apps/desktop/src/features/evaluation/cardRewardEvalListener.ts` (`<type>` = `card_reward`)
- Modify: `apps/desktop/src/features/evaluation/shopEvalListener.ts` (`<type>` = `shop`)
- Modify: `apps/desktop/src/features/evaluation/restSiteEvalListener.ts` (`<type>` = `rest_site`)
- Modify: `apps/desktop/src/features/evaluation/eventEvalListener.ts` (`<type>` = `event`)
- Modify: `apps/desktop/src/features/evaluation/cardSelectEvalListener.ts` (`<type>` = `card_select`)
- Modify: `apps/desktop/src/features/evaluation/cardUpgradeEvalListener.ts` (`<type>` = `card_upgrade`)
- Modify: `apps/desktop/src/features/evaluation/cardRemovalEvalListener.ts` (`<type>` = `card_removal`)
- Modify: `apps/desktop/src/features/evaluation/relicSelectEvalListener.ts` (`<type>` = `relic_select`)

### Pattern

For each file:

- [ ] **Step 1: Add imports**

Add to the imports near the top of the file:

```ts
import { logDevEvent, logReduxSnapshot } from "../../lib/dev-logger";
```

- [ ] **Step 2: Log API request before the dispatch**

Locate the `evaluationApi.endpoints.evaluateGeneric.initiate(...)` (or `evaluateCardReward`, `evaluateShop`, etc. — exact name varies per file) call inside the listener's `effect`. Immediately before the `await listenerApi.dispatch(...)` line, add:

```ts
        logDevEvent("eval", "<type>_api_request", {
          context: ctx,
          mapPrompt, // or whatever variable holds the prompt in this file
        });
```

Replace `<type>` with the value from the file table above. If the variable name for the prompt differs (e.g., `prompt`, `genericPrompt`), use the actual name from the file.

- [ ] **Step 3: Log API response after the unwrap**

Immediately after the `.unwrap()` call returns and assigns to a variable (typically `raw` or `parsed` or `evaluation`), add:

```ts
        logDevEvent("eval", "<type>_api_response", parsed); // or `raw` or `evaluation` — match the file's variable
```

- [ ] **Step 4: Log Redux snapshot after the success dispatch**

Immediately after the `listenerApi.dispatch(evalSucceeded({...}))` call near the end of the try block, add:

```ts
        logReduxSnapshot(listenerApi as unknown as { getState: () => unknown }, "after_<type>_eval");
```

Replace `<type>` with the file's value.

- [ ] **Step 5: Repeat steps 1-4 for every file in the table**

There are eight files. After each file is updated, do not commit yet — finish all eight, then run lint and tests, then commit once.

- [ ] **Step 6: Verify tests and lint**

Run: `npm test -w apps/desktop 2>&1 | tail -10 && npm run lint -w apps/desktop 2>&1 | tail -10`
Expected: All tests pass, lint clean. If any file uses a different variable name and TypeScript errors, fix the log call to match the actual variable.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/features/evaluation/cardRewardEvalListener.ts apps/desktop/src/features/evaluation/shopEvalListener.ts apps/desktop/src/features/evaluation/restSiteEvalListener.ts apps/desktop/src/features/evaluation/eventEvalListener.ts apps/desktop/src/features/evaluation/cardSelectEvalListener.ts apps/desktop/src/features/evaluation/cardUpgradeEvalListener.ts apps/desktop/src/features/evaluation/cardRemovalEvalListener.ts apps/desktop/src/features/evaluation/relicSelectEvalListener.ts
git commit -m "feat: log eval API request/response/snapshot for all eval listeners"
```

---

## Task 13: Instrument boss-briefing.tsx

**Files:**
- Modify: `apps/desktop/src/views/combat/boss-briefing.tsx`

- [ ] **Step 1: Find the evaluateBossBriefing call site**

Open `apps/desktop/src/views/combat/boss-briefing.tsx`. Locate the call to `useEvaluateBossBriefingMutation` (or wherever `evaluateBossBriefing` is invoked from this file).

- [ ] **Step 2: Add imports and instrumentation**

Add to the imports at the top:

```ts
import { logDevEvent } from "../../lib/dev-logger";
```

Wrap the mutation call site to log request and response. The exact shape depends on whether it uses an RTK Query hook or `dispatch(...)`. For a hook pattern with `unwrap()`:

```ts
// Before the call
logDevEvent("eval", "boss_briefing_api_request", { mapPrompt, runId });

// After unwrap
const result = await trigger({ mapPrompt, runId, gameVersion: null }).unwrap();
logDevEvent("eval", "boss_briefing_api_response", result);
```

If the file uses a different pattern (e.g., `useEffect` + lazy query), instrument the `then`/`await` site equivalently.

- [ ] **Step 3: Verify tests and lint**

Run: `npm test -w apps/desktop 2>&1 | tail -10 && npm run lint -w apps/desktop 2>&1 | tail -10`
Expected: All tests pass, lint clean.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/views/combat/boss-briefing.tsx
git commit -m "feat: log boss briefing eval to dev event log"
```

---

## Task 14: Smoke-test end to end

**Files:** none modified — verification only.

- [ ] **Step 1: Start the desktop app in dev mode**

Run: `npm run dev -w apps/desktop`
Expected: Vite dev server starts, Tauri opens the app window. Console should print `[dev-logger] Session file: /Users/<you>/Library/Logs/com.sts2replay.desktop/dev-session-...jsonl`.

- [ ] **Step 2: Trigger some game state**

Either play the game for a couple of polls or, if STS2 isn't running, just let the app sit for ~10 seconds while it polls. The logger will capture poll events and any errors.

- [ ] **Step 3: Read the log file**

Read the path printed in Step 1. Confirm it contains JSONL lines, each with `t`, `category`, `name`, and `data` fields.

- [ ] **Step 4: Verify pruning works**

Re-launch the app (Ctrl+C the dev server, then `npm run dev -w apps/desktop` again). A new session file appears. If you've been running this app for a while, older session files should remain (up to 20 total).

- [ ] **Step 5: Verify production build is clean**

Run: `npm run build -w apps/desktop 2>&1 | tail -10`
Expected: Build succeeds. Inspect `apps/desktop/dist/assets/*.js` and confirm `dev-logger` symbols are absent (search for `logDevEvent` in the build output — should not appear). If they do appear, the `import.meta.env.DEV` gates aren't tree-shaking properly and the implementation needs revisiting.

```bash
grep -l "logDevEvent" apps/desktop/dist/assets/*.js 2>&1 || echo "OK: dev-logger tree-shaken from production build"
```

Expected: `OK: dev-logger tree-shaken from production build`

- [ ] **Step 6: No commit needed for this verification task.**

---

## Self-Review Notes

- **Spec coverage:** All sections of the spec map to tasks. Polls → Task 9. Eval listeners (9 of 10) → Tasks 11 + 12. Boss briefing → Task 13. Run lifecycle → Task 10. Redux snapshots → embedded in Tasks 10/11/12/13. File location/format/buffering/rotation/pruning → Tasks 1-7. Production safety → enforced by `import.meta.env.DEV` guards in Task 2 and verified in Task 14 Step 5. Test coverage → Tasks 2-7 (every logger feature TDD'd against a fake adapter).
- **Type consistency:** `logDevEvent`, `logReduxSnapshot`, `initDevLogger`, `flushDevLogger`, `getCurrentSessionPath`, `FsAdapter`, `DevLogCategory`, `DevLogEvent` — names are stable across all tasks.
- **Listener variable names:** Task 12 explicitly notes the unwrap variable name varies (`raw`/`parsed`/`evaluation`) and tells the engineer to use the actual variable from the file. This is the only place where I can't show exact code without reading every listener — but the pattern is unambiguous.
- **Risk:** Task 5's `appendTextFile` implementation reads the entire file before writing, which is wasteful for large files. This is a deliberate trade-off because plugin-fs 2.x's `writeTextFile` doesn't expose a native append flag. If the rotation cap (50MB) starts feeling slow in practice, follow-up work can switch to a Tauri Rust command that calls `tokio::fs::OpenOptions::new().append(true)`. Noted but not blocking.
