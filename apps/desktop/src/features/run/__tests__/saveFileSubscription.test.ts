import { describe, it, expect, vi, beforeEach } from "vitest";

const { listenMock, invokeMock } = vi.hoisted(() => ({
  listenMock: vi.fn(),
  invokeMock: vi.fn(),
}));
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
    const dispatchAsThunk = (_a: unknown) => ({ unwrap: () => Promise.resolve(undefined) });

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
