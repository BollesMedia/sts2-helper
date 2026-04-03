import { useState, type ReactNode } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { selectPendingOutcome, selectLastCompletedRun, saveAndQuitDismissed } from "../../features/run/runSlice";
import { apiFetch } from "@sts2/shared/lib/api-client";

interface MenuViewProps {
  footer?: ReactNode;
}

export function MenuView({ footer }: MenuViewProps) {
  const dispatch = useAppDispatch();
  const pendingOutcome = useAppSelector(selectPendingOutcome);
  const lastRun = useAppSelector(selectLastCompletedRun);
  const [notes, setNotes] = useState("");
  const [notesSent, setNotesSent] = useState(false);

  const handleSendNotes = () => {
    if (!lastRun || !notes.trim()) return;
    apiFetch("/api/run", {
      method: "POST",
      body: JSON.stringify({
        action: "end",
        runId: lastRun.runId,
        notes: notes.trim(),
      }),
    }).catch(console.error);
    setNotesSent(true);
  };

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center space-y-4 max-w-md w-full">
        {pendingOutcome ? (
          <>
            <h2 className="text-2xl font-display font-semibold text-spire-text">
              Run paused on floor {pendingOutcome.finalFloor}
            </h2>
            <p className="text-sm text-spire-text-tertiary">
              Saving for later? Your run will resume when you relaunch.
            </p>
            <button
              onClick={() => dispatch(saveAndQuitDismissed())}
              className="w-full rounded-lg border border-spire-border bg-spire-surface px-6 py-2.5 text-sm font-medium text-spire-text hover:bg-spire-elevated transition-colors"
            >
              Save & Quit — I'll be back
            </button>
          </>
        ) : (
          <>
            {lastRun ? (
              <>
                <h2 className={`text-3xl font-display font-bold ${lastRun.victory ? "text-emerald-400" : "text-spire-text"}`}>
                  {lastRun.victory ? "Victory!" : "Run Complete"}
                </h2>
                <p className="text-sm text-spire-text-tertiary">
                  Floor {lastRun.finalFloor}
                </p>
                {!notesSent ? (
                  <div className="space-y-2">
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={lastRun.victory
                        ? "What worked well? Key cards or turning points?"
                        : "What went wrong? Any card picks you regret?"}
                      className="w-full rounded-lg border border-spire-border bg-spire-surface px-4 py-3 text-sm text-spire-text placeholder-spire-text-muted focus:outline-none focus:border-spire-border-emphasis resize-none"
                      rows={3}
                    />
                    {notes.trim() && (
                      <button
                        onClick={handleSendNotes}
                        className="rounded-lg border border-spire-border bg-spire-surface px-4 py-1.5 text-xs font-medium text-spire-text-secondary hover:bg-spire-elevated transition-colors"
                      >
                        Save notes
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-spire-text-muted">Notes saved</p>
                )}
              </>
            ) : (
              <>
                <h2 className="text-2xl font-display font-semibold text-spire-text">
                  Waiting for run
                </h2>
                <p className="text-sm text-spire-text-tertiary">
                  Start a new run in Slay the Spire 2
                </p>
              </>
            )}
          </>
        )}
        {footer}
      </div>
    </div>
  );
}
