import { useState, type ReactNode } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { selectPendingOutcome, selectLastCompletedRun, saveAndQuitDismissed } from "../../features/run/runSlice";
import { apiFetch } from "@sts2/shared/lib/api-client";

interface MenuViewProps {
  footer?: ReactNode;
}

const DEFEAT_FLAVOR = [
  "The Spire claims another.",
  "Not every climb ends at the top.",
  "Dust yourself off. The Spire waits.",
  "A lesson paid in blood.",
  "The cards were not in your favor.",
  "Death is but a doorway.",
  "Even the mightiest fall.",
  "The Spire remembers your attempt.",
];

const VICTORY_FLAVOR = [
  "The Spire bows before you.",
  "A legend forged in battle.",
  "The Architect falls. You ascend.",
  "Your deck was unstoppable.",
  "Mastery earned through every floor.",
  "The summit is yours.",
];

function pickFlavor(lines: string[], runId: string): string {
  // Deterministic from runId so it doesn't change on re-render
  let hash = 0;
  for (let i = 0; i < runId.length; i++) {
    hash = ((hash << 5) - hash + runId.charCodeAt(i)) | 0;
  }
  return lines[Math.abs(hash) % lines.length];
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

  // --- Save & Quit ---
  if (pendingOutcome) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-4 max-w-md w-full">
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
          {footer}
        </div>
      </div>
    );
  }

  // --- Victory / Defeat ---
  if (lastRun) {
    const isVictory = lastRun.victory === true;
    const flavor = pickFlavor(
      isVictory ? VICTORY_FLAVOR : DEFEAT_FLAVOR,
      lastRun.runId
    );

    return (
      <div className="flex flex-1 items-center justify-center relative overflow-hidden">
        {/* Atmospheric background glow */}
        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            background: isVictory
              ? "radial-gradient(ellipse at 50% 30%, rgba(212,168,67,0.25) 0%, rgba(212,168,67,0.08) 40%, transparent 70%)"
              : "radial-gradient(ellipse at 50% 30%, rgba(220,38,38,0.15) 0%, rgba(220,38,38,0.05) 40%, transparent 70%)",
          }}
        />

        {/* Animated particles (CSS-only) */}
        {isVictory && (
          <>
            <div className="absolute top-[15%] left-[20%] w-1 h-1 rounded-full bg-spire-gold/40 animate-pulse" style={{ animationDelay: "0s", animationDuration: "3s" }} />
            <div className="absolute top-[25%] right-[25%] w-1.5 h-1.5 rounded-full bg-spire-gold/30 animate-pulse" style={{ animationDelay: "1s", animationDuration: "4s" }} />
            <div className="absolute top-[10%] left-[60%] w-1 h-1 rounded-full bg-spire-gold-light/20 animate-pulse" style={{ animationDelay: "2s", animationDuration: "3.5s" }} />
            <div className="absolute top-[35%] left-[15%] w-0.5 h-0.5 rounded-full bg-amber-400/25 animate-pulse" style={{ animationDelay: "0.5s", animationDuration: "2.5s" }} />
          </>
        )}

        <div
          className="relative z-10 text-center max-w-lg w-full px-6 animate-[fadeInUp_0.6s_ease-out]"
        >
          {/* Icon */}
          <div
            className="text-5xl mb-4 animate-[fadeInUp_0.8s_ease-out]"
            style={{ animationDelay: "0.1s", animationFillMode: "both" }}
          >
            {isVictory ? "👑" : "💀"}
          </div>

          {/* Title banner */}
          <div className="relative inline-block mb-3">
            <h1
              className={`text-4xl font-display font-bold tracking-tight ${
                isVictory
                  ? "text-spire-gold drop-shadow-[0_0_20px_rgba(212,168,67,0.4)]"
                  : "text-red-400 drop-shadow-[0_0_15px_rgba(220,38,38,0.3)]"
              }`}
              style={{ animationDelay: "0.2s", animationFillMode: "both" }}
            >
              {isVictory ? "Victory" : "Defeat"}
            </h1>
            {/* Decorative line under title */}
            <div
              className={`mx-auto mt-2 h-px w-24 ${
                isVictory
                  ? "bg-gradient-to-r from-transparent via-spire-gold/60 to-transparent"
                  : "bg-gradient-to-r from-transparent via-red-500/40 to-transparent"
              }`}
            />
          </div>

          {/* Flavor text */}
          <p
            className="text-sm italic text-spire-text-tertiary mb-6 font-body animate-[fadeInUp_0.8s_ease-out]"
            style={{ animationDelay: "0.4s", animationFillMode: "both" }}
          >
            {flavor}
          </p>

          {/* Stats card */}
          <div
            className={`rounded-xl border p-5 mb-5 backdrop-blur-sm animate-[fadeInUp_0.8s_ease-out] ${
              isVictory
                ? "border-spire-gold/20 bg-spire-gold/[0.04]"
                : "border-red-500/15 bg-red-500/[0.03]"
            }`}
            style={{ animationDelay: "0.5s", animationFillMode: "both" }}
          >
            <div className="flex items-center justify-center gap-6 text-sm">
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] uppercase tracking-widest text-spire-text-muted font-medium">Character</span>
                <span className="text-spire-text font-display font-semibold">{lastRun.character}</span>
              </div>
              <div className={`w-px h-8 ${isVictory ? "bg-spire-gold/15" : "bg-red-500/10"}`} />
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] uppercase tracking-widest text-spire-text-muted font-medium">Floor</span>
                <span className="text-spire-text font-display font-bold text-lg">{lastRun.finalFloor}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div
            className="animate-[fadeInUp_0.8s_ease-out]"
            style={{ animationDelay: "0.7s", animationFillMode: "both" }}
          >
            {!notesSent ? (
              <div className="space-y-2.5">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={
                    isVictory
                      ? "What worked well? Key cards or turning points?"
                      : "What went wrong? Any card picks you regret?"
                  }
                  className="w-full rounded-lg border border-spire-border bg-spire-surface/80 px-4 py-3 text-sm text-spire-text placeholder-spire-text-muted focus:outline-none focus:border-spire-border-emphasis resize-none transition-colors"
                  rows={3}
                />
                {notes.trim() && (
                  <button
                    onClick={handleSendNotes}
                    className={`rounded-lg border px-5 py-1.5 text-xs font-medium transition-all ${
                      isVictory
                        ? "border-spire-gold/30 text-spire-gold hover:bg-spire-gold/10"
                        : "border-spire-border text-spire-text-secondary hover:bg-spire-elevated"
                    }`}
                  >
                    Save notes
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-spire-text-muted italic">Notes saved</p>
            )}
          </div>

          {footer}
        </div>
      </div>
    );
  }

  // --- Waiting for run ---
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center space-y-4 max-w-md w-full">
        <h2 className="text-2xl font-display font-semibold text-spire-text">
          Waiting for run
        </h2>
        <p className="text-sm text-spire-text-tertiary">
          Start a new run in Slay the Spire 2
        </p>
        {footer}
      </div>
    </div>
  );
}
