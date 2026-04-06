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
const MAX_SESSIONS = 20;
const SESSION_FILE_PREFIX = "dev-session-";
const SESSION_FILE_EXT = ".jsonl";

let isDev = import.meta.env.DEV;
let fsAdapter: FsAdapter | null = null;
let buffer: string[] = [];
let sessionPath: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight: Promise<void> | null = null;

function resolveSessionPath(): string | null {
  // TEST-ONLY override: setting `globalThis.__devLoggerSessionPathOverride`
  // bypasses initDevLogger and forces flushes to the given path. Used by
  // unit tests to exercise buffering/flush logic without standing up a
  // session file. Always cleared by __resetForTest in beforeEach.
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
      // Drop silently — logging an error here would loop. The events
      // in this batch are discarded, not re-queued: persistent fs
      // failures would otherwise create an infinite retry loop.
    }
  })();

  try {
    await flushInFlight;
  } finally {
    flushInFlight = null;
  }
}

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

async function loadTauriFsAdapter(): Promise<FsAdapter | null> {
  // Only attempt to load Tauri APIs in a real Tauri runtime.
  // jsdom-based unit tests don't have __TAURI_INTERNALS__ set, so the
  // dynamic imports below would fail — bail out cleanly instead.
  if (typeof window === "undefined") return null;
  if (!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__) return null;

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
        // Tauri's plugin-fs 2.x does not expose a native append flag.
        // For our usage (small per-flush batches), read-then-write is fine.
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
        // plugin-fs 2.x DirEntry doesn't include mtime — stat per file.
        const entries = await fsMod.readDir(p);
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
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[dev-logger] Failed to load Tauri FS adapter:", err);
    return null;
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

  // T3 review fix: drain any events buffered before init by re-arming
  // the flush timer. flushDevLogger's pre-init early-return left them
  // sitting in the buffer with no scheduled flush.
  if (buffer.length > 0) {
    scheduleFlush();
  }

  // eslint-disable-next-line no-console
  console.info(`[dev-logger] Session file: ${sessionPath}`);
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
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushInFlight = null;
  isDev = import.meta.env.DEV;
  delete (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride;
}
