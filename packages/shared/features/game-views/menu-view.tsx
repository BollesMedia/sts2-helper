"use client";

import { useState, type ReactNode } from "react";
import { apiFetch } from "../../lib/api-client";
import type { RunState } from "../connection/use-run-tracker";

interface MenuViewProps {
  runState: RunState;
  footer?: ReactNode;
}

export function MenuView({ runState, footer }: MenuViewProps) {
  const [notes, setNotes] = useState("");
  const [lastConfirmed, setLastConfirmed] = useState<{ runId: string; victory: boolean } | null>(null);

  const handleOutcome = (victory: boolean) => {
    if (notes.trim() && runState.endedRunId) {
      apiFetch("/api/run", {
        method: "POST",
        body: JSON.stringify({
          action: "end",
          runId: runState.endedRunId,
          notes: notes.trim(),
        }),
      }).catch(console.error);
    }
    setLastConfirmed({ runId: runState.endedRunId!, victory });
    runState.confirmOutcome(victory);
  };

  const handleCorrectOutcome = (victory: boolean) => {
    if (!lastConfirmed) return;
    apiFetch("/api/run", {
      method: "POST",
      body: JSON.stringify({
        action: "end",
        runId: lastConfirmed.runId,
        victory,
      }),
    }).catch(console.error);
    setLastConfirmed({ ...lastConfirmed, victory });
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
              placeholder="What went wrong? What would you do differently? Any card picks you regret?"
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
            {lastConfirmed && (
              <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-900/50 p-3 space-y-2">
                <p className="text-xs text-zinc-500">
                  Last run recorded as {lastConfirmed.victory ? "Victory" : "Defeat"}
                </p>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xs text-zinc-600">Wrong? Correct to:</span>
                  <button
                    onClick={() => handleCorrectOutcome(!lastConfirmed.victory)}
                    className="text-xs text-zinc-400 hover:text-zinc-200 underline transition-colors"
                  >
                    {lastConfirmed.victory ? "Defeat" : "Victory"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {footer}
      </div>
    </div>
  );
}
