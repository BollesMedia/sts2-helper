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
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushInFlight = null;
  isDev = import.meta.env.DEV;
  delete (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride;
}
