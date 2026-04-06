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
