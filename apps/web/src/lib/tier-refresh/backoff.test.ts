import { describe, it, expect } from "vitest";
import { computeBackoff } from "./backoff";

const NOW = new Date("2026-06-01T04:00:00Z");
const day = (n: number) =>
  new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe("computeBackoff", () => {
  it("applied resets both counters and schedules +7d", () => {
    expect(computeBackoff("applied", { failures: 4, queueOnly: 2 }, NOW))
      .toMatchObject({
        consecutive_failures: 0,
        consecutive_queue_only: 0,
        dormant: false,
        next_refresh_at: day(7),
      });
  });

  it("partial resets queueOnly and schedules +7d", () => {
    expect(computeBackoff("partial", { failures: 0, queueOnly: 2 }, NOW))
      .toMatchObject({
        consecutive_queue_only: 0,
        next_refresh_at: day(7),
      });
  });

  it("queued increments queueOnly, +7d, dormant at 3", () => {
    expect(computeBackoff("queued", { failures: 0, queueOnly: 1 }, NOW))
      .toMatchObject({
        consecutive_queue_only: 2,
        dormant: false,
      });
    expect(computeBackoff("queued", { failures: 0, queueOnly: 2 }, NOW))
      .toMatchObject({
        consecutive_queue_only: 3,
        dormant: true,
      });
  });

  it("failure <3 schedules +1d", () => {
    expect(computeBackoff("failed", { failures: 0, queueOnly: 0 }, NOW))
      .toMatchObject({
        consecutive_failures: 1,
        next_refresh_at: day(1),
        dormant: false,
      });
  });

  it("failure 3..5 schedules +14d", () => {
    expect(computeBackoff("failed", { failures: 2, queueOnly: 0 }, NOW))
      .toMatchObject({
        consecutive_failures: 3,
        next_refresh_at: day(14),
      });
  });

  it("failure >=6 goes dormant", () => {
    expect(computeBackoff("failed", { failures: 5, queueOnly: 0 }, NOW))
      .toMatchObject({
        consecutive_failures: 6,
        dormant: true,
      });
  });

  it("no_data counts as a failure", () => {
    expect(computeBackoff("no_data", { failures: 0, queueOnly: 0 }, NOW))
      .toMatchObject({
        consecutive_failures: 1,
        next_refresh_at: day(1),
      });
  });
});
