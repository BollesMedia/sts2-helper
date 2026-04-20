import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { invokeGetActiveRunWithRetry } from "../runAnalyticsListener";

const SAMPLE = {
  start_time: 1776540732,
  seed: "A",
  ascension: 10,
  character: "CHARACTER.IRONCLAD",
  is_mp: false,
};

describe("invokeGetActiveRunWithRetry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the first successful result without extra retries", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SAMPLE);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const got = await invokeGetActiveRunWithRetry(3, 1, sleep);
    expect(got).toEqual(SAMPLE);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries when invoke resolves null, succeeds on third try", async () => {
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(SAMPLE);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const got = await invokeGetActiveRunWithRetry(3, 1, sleep);
    expect(got).toEqual(SAMPLE);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("returns null after all attempts fail", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("nope"));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const got = await invokeGetActiveRunWithRetry(3, 1, sleep);
    expect(got).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("returns null when invoke consistently resolves null", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const got = await invokeGetActiveRunWithRetry(3, 1, sleep);
    expect(got).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});
