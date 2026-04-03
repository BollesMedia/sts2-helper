import { useState, type ReactNode } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { selectPendingOutcome, outcomeConfirmed, saveAndQuitDismissed } from "../../features/run/runSlice";
import { apiFetch } from "@sts2/shared/lib/api-client";

interface MenuViewProps {
  footer?: ReactNode;
}

export function MenuView({ footer }: MenuViewProps) {
  const dispatch = useAppDispatch();
  const pendingOutcome = useAppSelector(selectPendingOutcome);
  const [notes, setNotes] = useState("");
  const [lastConfirmed, setLastConfirmed] = useState<{ runId: string; victory: boolean } | null>(null);

  const handleOutcome = (victory: boolean) => {
    if (!pendingOutcome) return;

    if (notes.trim()) {
      apiFetch("/api/run", {
        method: "POST",
        body: JSON.stringify({
          action: "end",
          runId: pendingOutcome.runId,
          notes: notes.trim(),
        }),
      }).catch(console.error);
    }

    setLastConfirmed({ runId: pendingOutcome.runId, victory });
    dispatch(outcomeConfirmed({ runId: pendingOutcome.runId, victory }));
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
        {pendingOutcome ? (
          <>
            <h2 className="text-2xl font-display font-semibold text-spire-text">
              Run paused on floor {pendingOutcome.finalFloor}
            </h2>
            <p className="text-sm text-spire-text-tertiary">Did the run end, or just saving for later?</p>
            <button
              onClick={() => dispatch(saveAndQuitDismissed())}
              className="w-full rounded-lg border border-spire-border bg-spire-surface px-6 py-2.5 text-sm font-medium text-spire-text hover:bg-spire-elevated transition-colors"
            >
              Save & Quit — I'll be back
            </button>
            <div className="border-t border-spire-border pt-4 space-y-3">
              <p className="text-xs text-spire-text-muted">Run over? Record the outcome:</p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional: What went wrong? Any card picks you regret?"
                className="w-full rounded-lg border border-spire-border bg-spire-surface px-4 py-3 text-sm text-spire-text placeholder-spire-text-muted focus:outline-none focus:border-spire-border-emphasis resize-none"
                rows={2}
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
            </div>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-display font-semibold text-spire-text">
              Waiting for run
            </h2>
            <p className="text-sm text-spire-text-tertiary">
              Start a new run in Slay the Spire 2
            </p>
            {lastConfirmed && (
              <div className="mt-4 rounded-lg border border-spire-border bg-spire-surface/50 p-3 space-y-2">
                <p className="text-xs text-spire-text-tertiary">
                  Last run recorded as {lastConfirmed.victory ? "Victory" : "Defeat"}
                </p>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xs text-spire-text-muted">Wrong? Correct to:</span>
                  <button
                    onClick={() => handleCorrectOutcome(!lastConfirmed.victory)}
                    className="text-xs text-spire-text-tertiary hover:text-spire-text underline transition-colors"
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
