import { useGameState, ConnectionBanner } from "@sts2/shared/features/connection";
import { useDeckTracker } from "@sts2/shared/features/connection/use-deck-tracker";
import { usePlayerTracker } from "@sts2/shared/features/connection/use-player-tracker";
import { useRunTracker } from "@sts2/shared/features/connection/use-run-tracker";
import { useChoiceTracker } from "@sts2/shared/features/connection/use-choice-tracker";
import { AppHeader } from "@sts2/shared/features/game-views/app-header";
import { GameStateView } from "@sts2/shared/features/game-views/game-state-view";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { reportFeedback, reportInfo } from "@sts2/shared/lib/error-reporter";
import { useAuth } from "./auth-provider";
import { LoginScreen } from "./login-screen";
import { SetupWizard } from "./setup-wizard";
import { useState, useRef } from "react";

// Check for updates on app launch
check().then(async (update) => {
  if (update) {
    console.log("[Updater] Update available:", update.version);
    reportInfo("updater", `Update available: ${update.version}`);
    await update.downloadAndInstall();
    await relaunch();
  }
}).catch((err) => {
  console.warn("[Updater] Check failed:", err);
});

type ModCheckState = "checking" | "ready" | "needs-setup";

interface ModStatus {
  game_found: boolean;
  required_mods: {
    id: string;
    installed: boolean;
    needs_update: boolean;
  }[];
}

export function App() {
  const { user, loading } = useAuth();
  const [modCheck, setModCheck] = useState<ModCheckState>("checking");
  const checkStarted = useRef(false);

  // Quick mod check on startup — only runs once
  if (!checkStarted.current && user) {
    checkStarted.current = true;
    invoke<ModStatus>("get_mod_status")
      .then((status) => {
        const allInstalled =
          status.game_found &&
          status.required_mods.every((m) => m.installed);
        setModCheck(allInstalled ? "ready" : "needs-setup");
      })
      .catch(() => {
        setModCheck("needs-setup");
      });
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen">
        <p className="text-sm text-spire-text-tertiary">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (modCheck === "checking") {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen">
        <p className="text-sm text-spire-text-tertiary">Checking mod status...</p>
      </div>
    );
  }

  if (modCheck === "needs-setup") {
    return <SetupWizard onComplete={() => setModCheck("ready")} />;
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const { user, signOut } = useAuth();
  const { gameState, connectionStatus } = useGameState();
  const deckCards = useDeckTracker(gameState);
  const player = usePlayerTracker(gameState);
  const runState = useRunTracker(gameState, user?.id ?? null, connectionStatus === "disconnected");
  // Side-effect only: logs choices to Supabase
  useChoiceTracker(gameState, deckCards, runState.runId);

  if (connectionStatus !== "connected" || !gameState) {
    return (
      <ConnectionBanner
        status={connectionStatus}
        userEmail={user?.email}
        onSignOut={signOut}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col h-screen overflow-hidden">
      <AppHeader gameState={gameState} player={player} onSignOut={signOut} />
      <main className="flex-1 min-h-0 p-4">
        <GameStateView
          state={gameState}
          deckCards={deckCards}
          player={player}
          runId={runState.runId}
          runState={runState}
        />
      </main>
      {gameState.state_type !== "menu" && (
        <footer className="border-t border-spire-border px-4 py-1.5 flex justify-between">
          <button
            onClick={() => {
              const text = prompt("What happened? Describe the issue:");
              if (text?.trim()) {
                reportFeedback(text.trim(), {
                  state_type: gameState.state_type,
                  floor: "run" in gameState ? (gameState as { run: { floor: number } }).run.floor : undefined,
                  act: "run" in gameState ? (gameState as { run: { act: number } }).run.act : undefined,
                  character: player?.character,
                });
                alert("Feedback sent — thanks!");
              }
            }}
            className="text-[10px] text-spire-text-muted hover:text-spire-text-secondary transition-colors"
          >
            Send Feedback
          </button>
          <div className="flex gap-3">
            <button
              onClick={() => {
                localStorage.removeItem("sts2-eval-cache");
                localStorage.removeItem("sts2-shop-eval-cache");
                localStorage.removeItem("sts2-map-eval-cache");
                localStorage.removeItem("sts2-event-eval-cache");
                localStorage.removeItem("sts2-rest-eval-cache");
                window.location.reload();
              }}
              className="text-[10px] text-spire-text-muted hover:text-spire-text-secondary transition-colors"
            >
              Re-evaluate
            </button>
            <button
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
              className="text-[10px] text-spire-text-muted hover:text-spire-text-secondary transition-colors"
            >
              Clear cache
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
