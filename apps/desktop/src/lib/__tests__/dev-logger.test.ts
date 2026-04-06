import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  __setFsAdapterForTest,
  __setDevModeForTest,
  __resetForTest,
  logDevEvent,
  flushDevLogger,
  getCurrentSessionPath,
  initDevLogger,
} from "../dev-logger";
import type { FsAdapter } from "../dev-logger";

interface FakeFs {
  appendCalls: { path: string; content: string }[];
  existsCalls: string[];
  files: Map<string, string>;
  fileSizes: Map<string, number>;
  dirEntries: { name: string; mtime: number }[];
  removed: string[];
}

function makeFakeFs(): { state: FakeFs; adapter: FsAdapter } {
  const state: FakeFs = {
    appendCalls: [],
    existsCalls: [],
    files: new Map(),
    fileSizes: new Map(),
    dirEntries: [],
    removed: [],
  };
  const adapter: FsAdapter = {
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
  return { state, adapter };
}

describe("dev-logger", () => {
  beforeEach(() => {
    __resetForTest();
    __setDevModeForTest(true);
    const { adapter } = makeFakeFs();
    __setFsAdapterForTest(adapter);
  });

  it("is a no-op when DEV mode is off", async () => {
    __setDevModeForTest(false);
    logDevEvent("poll", "game_state", { hp: 80 });
    await flushDevLogger();
    expect(getCurrentSessionPath()).toBeNull();
  });

  it("buffers events as JSONL lines and writes them on flush", async () => {
    const { state, adapter } = makeFakeFs();
    __setFsAdapterForTest(adapter);
    // Pre-set sessionPath so logDevEvent doesn't need init
    // (init is tested separately in Task 4)
    (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride = "/tmp/fake-applog/dev-session-test.jsonl";

    logDevEvent("poll", "game_state", { hp: 80, floor: 12 });
    logDevEvent("eval", "map_api_response", { rankings: [] });

    await flushDevLogger();

    expect(state.appendCalls).toHaveLength(1);
    const lines = state.appendCalls[0].content.trim().split("\n");
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
    const { state, adapter } = makeFakeFs();
    __setFsAdapterForTest(adapter);
    (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride = "/tmp/fake-applog/dev-session-test.jsonl";

    for (let i = 0; i < 50; i++) {
      logDevEvent("poll", "game_state", { i });
    }
    // Allow microtask flush
    await new Promise((r) => setTimeout(r, 10));

    expect(state.appendCalls.length).toBeGreaterThan(0);
    const totalLines = state.appendCalls
      .flatMap((c) => c.content.trim().split("\n"))
      .filter(Boolean).length;
    expect(totalLines).toBe(50);

    delete (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride;
  });

  it("drops events silently when fs append throws", async () => {
    const { adapter } = makeFakeFs();
    adapter.appendTextFile = async () => {
      throw new Error("disk full");
    };
    __setFsAdapterForTest(adapter);
    (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride = "/tmp/fake-applog/dev-session-test.jsonl";

    logDevEvent("poll", "game_state", { hp: 80 });
    // Should not throw
    await expect(flushDevLogger()).resolves.toBeUndefined();

    delete (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride;
  });

  it("initDevLogger creates a session file path under appLogDir", async () => {
    const { adapter } = makeFakeFs();
    __setFsAdapterForTest(adapter);

    await initDevLogger();
    const path = getCurrentSessionPath();
    expect(path).toMatch(/^\/tmp\/fake-applog\/dev-session-/);
    expect(path).toMatch(/\.jsonl$/);
  });

  it("initDevLogger prunes session files beyond the most recent 20", async () => {
    const { state, adapter } = makeFakeFs();
    // Pretend 25 existing session files of varying ages
    state.dirEntries = Array.from({ length: 25 }, (_, i) => ({
      name: `dev-session-2026-04-${String(i + 1).padStart(2, "0")}T10-00-00.jsonl`,
      mtime: 1000 + i,
    }));
    __setFsAdapterForTest(adapter);

    await initDevLogger();

    // 25 existing - 20 to keep = 5 deleted (the oldest by mtime)
    expect(state.removed).toHaveLength(5);
    // The 5 oldest (mtime 1000-1004) should be removed
    const removedNames = state.removed.map((p) => p.split("/").pop());
    expect(removedNames).toContain("dev-session-2026-04-01T10-00-00.jsonl");
  });

  it("initDevLogger ignores non-session files in the log dir", async () => {
    const { state, adapter } = makeFakeFs();
    state.dirEntries = [
      { name: "tauri.log", mtime: 1000 },
      { name: "dev-session-2026-04-06T10-00-00.jsonl", mtime: 2000 },
      { name: "other-file.txt", mtime: 3000 },
    ];
    __setFsAdapterForTest(adapter);

    await initDevLogger();

    expect(state.removed).toHaveLength(0);
  });

  it("initDevLogger is a no-op when DEV mode is off", async () => {
    __setDevModeForTest(false);
    const { state, adapter } = makeFakeFs();
    __setFsAdapterForTest(adapter);
    await initDevLogger();
    expect(getCurrentSessionPath()).toBeNull();
    expect(state.removed).toHaveLength(0);
  });

  it("rotates session file when it exceeds 50MB", async () => {
    const { state, adapter } = makeFakeFs();
    __setFsAdapterForTest(adapter);

    // Pre-populate session at 49.9MB
    const path = "/tmp/fake-applog/dev-session-2026-04-06T10-00-00.jsonl";
    state.fileSizes.set(path, 49.9 * 1024 * 1024);
    state.files.set(path, "x");
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

    const writtenPaths = new Set(state.appendCalls.map((c) => c.path));
    const part2 = [...writtenPaths].find((p) => p.includes("-part2.jsonl"));
    expect(part2).toBeDefined();

    delete (globalThis as Record<string, unknown>).__devLoggerSessionPathOverride;
  });

  it("initDevLogger drains pre-init buffered events on the next flush tick", async () => {
    vi.useFakeTimers();
    try {
      const { state, adapter } = makeFakeFs();
      __setFsAdapterForTest(adapter);

      // Log events BEFORE init — they should buffer but not flush
      logDevEvent("poll", "game_state", { early: 1 });
      logDevEvent("poll", "game_state", { early: 2 });

      // Pre-init: nothing written yet
      expect(state.appendCalls).toHaveLength(0);

      // Init resolves the session path AND should re-arm the flush timer
      await initDevLogger();

      // Advance fake timers past the 1000ms flush interval
      await vi.advanceTimersByTimeAsync(1100);

      // The buffered pre-init events should now be on disk
      expect(state.appendCalls.length).toBeGreaterThan(0);
      const totalLines = state.appendCalls
        .flatMap((c) => c.content.trim().split("\n"))
        .filter(Boolean).length;
      expect(totalLines).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
