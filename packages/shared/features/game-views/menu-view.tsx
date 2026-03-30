"use client";

import { useState } from "react";
import { apiUrl } from "../../lib/api-client";
import type { RunState } from "../connection/use-run-tracker";

export function MenuView({ runState }: { runState: RunState }) {
  const [notes, setNotes] = useState("");

  const handleOutcome = (victory: boolean) => {
    if (notes.trim() && runState.endedRunId) {
      fetch(apiUrl("/api/run"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "end",
          runId: runState.endedRunId,
          notes: notes.trim(),
        }),
      }).catch(console.error);
    }
    runState.confirmOutcome(victory);
  };

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center space-y-4 max-w-md w-full">
        {runState.pendingOutcome ? (
          <>
            <h2 className="text-2xl font-semibold text-zinc-200">
              Run ended on floor {runState.finalFloor}
            </h2>
            <p className="text-sm text-zinc-500">How did it go?</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What went wrong? What would you do differently?"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
              rows={3}
            />
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => handleOutcome(true)}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-6 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
              >
                Victory
              </button>
              <button
                onClick={() => handleOutcome(false)}
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-6 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Defeat
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-semibold text-zinc-200">
              Waiting for run
            </h2>
            <p className="text-sm text-zinc-500">
              Start a new run in Slay the Spire 2
            </p>
          </>
        )}
      </div>
    </div>
  );
}
