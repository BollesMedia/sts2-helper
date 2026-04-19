import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  queueRunSync,
  readPendingRunSyncs,
  drainPendingRunSyncs,
  PENDING_RUN_SYNCS_KEY,
  MAX_QUEUE,
} from "../run-sync-queue";

describe("run-sync-queue", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("queues, reads, and drains in FIFO order", async () => {
    queueRunSync({ action: "start", runId: "a", character: "Ironclad", ascension: 0, gameMode: "singleplayer" });
    queueRunSync({ action: "end", runId: "a", victory: true });
    expect(readPendingRunSyncs()).toHaveLength(2);

    const send = vi.fn().mockResolvedValue(undefined);
    await drainPendingRunSyncs(send);

    expect(send).toHaveBeenCalledTimes(2);
    expect((send.mock.calls[0][0] as { action: string }).action).toBe("start");
    expect((send.mock.calls[1][0] as { action: string }).action).toBe("end");
    expect(readPendingRunSyncs()).toHaveLength(0);
  });

  it("drops oldest when queue exceeds MAX_QUEUE", () => {
    for (let i = 0; i < MAX_QUEUE + 5; i++) {
      queueRunSync({ action: "start", runId: `r${i}`, character: "Ironclad", ascension: 0, gameMode: "singleplayer" });
    }
    const q = readPendingRunSyncs();
    expect(q).toHaveLength(MAX_QUEUE);
    expect(q[0].runId).toBe("r5");
  });

  it("leaves items in queue if send fails, preserving order", async () => {
    queueRunSync({ action: "start", runId: "a", character: "Ironclad", ascension: 0, gameMode: "singleplayer" });
    queueRunSync({ action: "end", runId: "a", victory: true });

    const send = vi.fn()
      .mockResolvedValueOnce(undefined) // 'start' succeeds
      .mockRejectedValueOnce(new Error("network down")); // 'end' fails

    await drainPendingRunSyncs(send);

    const remaining = readPendingRunSyncs();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].action).toBe("end");
  });

  it("uses the correct localStorage key", () => {
    expect(PENDING_RUN_SYNCS_KEY).toBe("pendingRunSyncs");
  });
});
