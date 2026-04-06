import { describe, it, expect, beforeEach } from "vitest";
import {
  __setFsAdapterForTest,
  __setDevModeForTest,
  __resetForTest,
  logDevEvent,
  flushDevLogger,
  getCurrentSessionPath,
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
});
