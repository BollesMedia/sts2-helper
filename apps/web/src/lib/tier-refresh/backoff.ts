import type { RefreshStatus } from "./types";

export interface Counters {
  failures: number;
  queueOnly: number;
}

export interface BackoffUpdate {
  consecutive_failures: number;
  consecutive_queue_only: number;
  dormant: boolean;
  next_refresh_at: string;
}

const days = (now: Date, n: number) =>
  new Date(now.getTime() + n * 86_400_000).toISOString();

export function computeBackoff(
  status: RefreshStatus,
  counters: Counters,
  now: Date,
): BackoffUpdate {
  if (status === "applied" || status === "partial") {
    return {
      consecutive_failures: 0,
      consecutive_queue_only: 0,
      dormant: false,
      next_refresh_at: days(now, 7),
    };
  }
  if (status === "queued") {
    const queueOnly = counters.queueOnly + 1;
    return {
      consecutive_failures: counters.failures,
      consecutive_queue_only: queueOnly,
      dormant: queueOnly >= 3,
      next_refresh_at: days(now, 7),
    };
  }
  // "failed" or "no_data"
  const failures = counters.failures + 1;
  return {
    consecutive_failures: failures,
    consecutive_queue_only: counters.queueOnly,
    dormant: failures >= 6,
    next_refresh_at: failures < 3 ? days(now, 1) : days(now, 14),
  };
}
