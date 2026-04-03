import type { GameState } from "@sts2/shared/types/game-state";

interface PollEntry {
  timestamp: number;
  stateType: string;
  snapshot: GameState;
}

const MAX_ENTRIES = 100;
const entries: PollEntry[] = [];
let lastJson = "";

/**
 * Log a unique game state poll response. Deduplicates by JSON equality
 * so only state changes are stored. Keeps the last 100 unique snapshots
 * in memory for debugging.
 */
export function logPoll(state: GameState): void {
  const json = JSON.stringify(state);
  if (json === lastJson) return;
  lastJson = json;

  entries.push({
    timestamp: Date.now(),
    stateType: state.state_type,
    snapshot: state,
  });

  if (entries.length > MAX_ENTRIES) {
    entries.shift();
  }
}

/** Get all logged poll entries (most recent last). */
export function getPollLog(): readonly PollEntry[] {
  return entries;
}

/** Get the last N entries. */
export function getRecentPolls(n = 10): readonly PollEntry[] {
  return entries.slice(-n);
}

/** Clear the log. */
export function clearPollLog(): void {
  entries.length = 0;
  lastJson = "";
}

// Expose on window for console debugging in dev
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__pollLog = {
    get entries() { return entries; },
    recent: (n = 10) => getRecentPolls(n),
    clear: clearPollLog,
  };
}
