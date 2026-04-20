import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppDispatch } from "../../store/store";
import { evaluationApi } from "../../services/evaluationApi";
import {
  drainPendingRunSyncs,
  queueRunSync,
  type PendingRunSync,
} from "../../lib/run-sync-queue";

const LAST_SYNCED_KEY = "lastSyncedStartTime";

interface RunSummary {
  start_time: number;
  seed: string;
  ascension: number;
  character: string;
  win: boolean;
  was_abandoned: boolean;
  killed_by_encounter: string;
  run_time: number;
  build_id: string;
  act_reached: number;
  players_count: number;
}

interface RunHistoryListing {
  entries: RunSummary[];
  skipped: number;
}

function loadLastSynced(): number {
  const raw = localStorage.getItem(LAST_SYNCED_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

function saveLastSynced(ts: number) {
  localStorage.setItem(LAST_SYNCED_KEY, String(ts));
}

function summaryToSyncs(s: RunSummary): PendingRunSync[] {
  const runId = String(s.start_time);
  const gameMode: "singleplayer" | "multiplayer" =
    s.players_count > 1 ? "multiplayer" : "singleplayer";
  const cause =
    s.killed_by_encounter && s.killed_by_encounter !== "NONE.NONE"
      ? s.killed_by_encounter
      : null;
  const notes = s.was_abandoned ? "save_file: abandoned" : null;
  return [
    {
      action: "start",
      runId,
      character: s.character,
      ascension: s.ascension,
      gameMode,
      runIdSource: "save_file",
    },
    {
      action: "end",
      runId,
      victory: s.win,
      actReached: s.act_reached,
      causeOfDeath: cause,
      notes,
      runIdSource: "save_file",
    },
  ];
}

async function sendViaDispatch(dispatch: AppDispatch, entry: PendingRunSync): Promise<void> {
  if (entry.action === "start") {
    await dispatch(
      evaluationApi.endpoints.startRun.initiate({
        runId: entry.runId,
        character: entry.character,
        ascension: entry.ascension,
        gameMode: entry.gameMode,
        userId: null,
        runIdSource: entry.runIdSource ?? null,
      })
    ).unwrap();
  } else {
    await dispatch(
      evaluationApi.endpoints.endRun.initiate({
        runId: entry.runId,
        victory: entry.victory ?? undefined,
        actReached: entry.actReached ?? undefined,
        causeOfDeath: entry.causeOfDeath ?? null,
        notes: entry.notes ?? undefined,
        runIdSource: entry.runIdSource ?? null,
      })
    ).unwrap();
  }
}

export async function setupSaveFileSubscription(dispatch: AppDispatch) {
  try {
    await invoke("start_run_history_watch");
  } catch (err) {
    console.info("[saveFileSubscription] start_run_history_watch skipped", err);
  }

  await drainPendingRunSyncs((entry) => sendViaDispatch(dispatch, entry));

  const lastSynced = loadLastSynced();
  try {
    const listing = await invoke<RunHistoryListing>("list_run_history", {
      after_start_time: lastSynced,
    });
    for (const summary of listing.entries) {
      for (const sync of summaryToSyncs(summary)) {
        try {
          await sendViaDispatch(dispatch, sync);
        } catch (err) {
          console.warn("[saveFileSubscription] backfill post failed; queueing", err);
          queueRunSync(sync);
        }
      }
      if (summary.start_time > lastSynced) {
        saveLastSynced(summary.start_time);
      }
    }
  } catch (err) {
    console.info("[saveFileSubscription] list_run_history skipped", err);
  }

  await listen<RunSummary>("run-completed", async (event) => {
    const summary = event.payload;
    for (const sync of summaryToSyncs(summary)) {
      try {
        await sendViaDispatch(dispatch, sync);
      } catch (err) {
        console.warn("[saveFileSubscription] live post failed; queueing", err);
        queueRunSync(sync);
      }
    }
    if (summary.start_time > loadLastSynced()) {
      saveLastSynced(summary.start_time);
    }
  });
}
