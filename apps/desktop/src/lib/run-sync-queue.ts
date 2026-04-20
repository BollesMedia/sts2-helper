export const PENDING_RUN_SYNCS_KEY = "pendingRunSyncs";
export const MAX_QUEUE = 100;

export type PendingRunSync =
  | {
      action: "start";
      runId: string;
      character: string;
      ascension: number;
      gameMode: "singleplayer" | "multiplayer";
      runIdSource?: "save_file" | "client_fallback" | null;
      gameVersion?: string | null;
    }
  | {
      action: "end";
      runId: string;
      victory?: boolean | null;
      actReached?: number | null;
      causeOfDeath?: string | null;
      notes?: string | null;
      finalFloor?: number | null;
      runIdSource?: "save_file" | "client_fallback" | null;
    };

export function readPendingRunSyncs(): PendingRunSync[] {
  const raw = localStorage.getItem(PENDING_RUN_SYNCS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingRunSync[]) : [];
  } catch {
    return [];
  }
}

function write(queue: PendingRunSync[]) {
  localStorage.setItem(PENDING_RUN_SYNCS_KEY, JSON.stringify(queue));
}

export function queueRunSync(entry: PendingRunSync) {
  const queue = readPendingRunSyncs();
  queue.push(entry);
  while (queue.length > MAX_QUEUE) queue.shift();
  write(queue);
}

/**
 * Try to send each queued entry. Stops on first failure to preserve ordering.
 * Successful sends are removed from the queue.
 */
export async function drainPendingRunSyncs(
  send: (entry: PendingRunSync) => Promise<void>
) {
  const queue = readPendingRunSyncs();
  while (queue.length) {
    const head = queue[0];
    try {
      await send(head);
      queue.shift();
      write(queue);
    } catch (err) {
      console.warn("[run-sync-queue] send failed; leaving in queue", err);
      break;
    }
  }
}
