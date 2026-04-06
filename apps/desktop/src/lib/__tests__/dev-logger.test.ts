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
});
