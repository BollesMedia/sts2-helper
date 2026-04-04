import { ConnectionBanner } from "./views/connection";
import { useGameState } from "./hooks/useGameState";
import { useAppSelector, useAppDispatch } from "./store/hooks";
import { selectActivePlayer } from "./features/run/runSelectors";
import { selectModMismatch, modMismatchCleared } from "./features/connection/connectionSlice";
import { evalRetryRequested, type EvalType } from "./features/evaluation/evaluationSlice";
import { AppHeader } from "./views/game-views/app-header";
import { GameStateView } from "./views/game-views/game-state-view";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { reportFeedback, reportInfo } from "@sts2/shared/lib/error-reporter";
import { useAuth } from "./auth-provider";
import { LoginScreen } from "./login-screen";
import { SetupWizard } from "./setup-wizard";
import { useState, useRef } from "react";
import { ModVersionBanner } from "./mod-version-banner";

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
  game_running: boolean;
  required_mods: {
    id: string;
    name: string;
    required_version: string;
    installed: boolean;
    installed_version: string | null;
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
  const dispatch = useAppDispatch();

  const player = useAppSelector(selectActivePlayer);
  const modMismatch = useAppSelector(selectModMismatch);

  // Map state_type to eval type for re-eval dispatch
  const EVAL_TYPE_MAP: Partial<Record<string, EvalType>> = {
    card_reward: "card_reward",
    shop: "shop",
    map: "map",
    event: "event",
    rest_site: "rest_site",
    relic_select: "relic_select",
  };

  // When mod mismatch is detected, keep the update UI visible even if the game
  // disconnects (user closed it to update). Otherwise show the normal connection banner.
  if ((connectionStatus !== "connected" || !gameState) && !modMismatch) {
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
      {gameState && <AppHeader gameState={gameState} onSignOut={signOut} />}
      {modMismatch && (
        <ModVersionBanner
          installed={modMismatch.installed}
          required={modMismatch.required}
          gameRunning={modMismatch.gameRunning}
          onUpdated={() => dispatch(modMismatchCleared())}
        />
      )}
      <main className="flex-1 min-h-0 p-4">
        {gameState ? (
          <GameStateView state={gameState} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-spire-text-tertiary">
              {modMismatch ? "Update the mod above, then relaunch the game." : "Waiting for game connection..."}
            </p>
          </div>
        )}
      </main>
      {gameState && gameState.state_type !== "menu" && (
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
                if (!gameState) return;
                const evalType = EVAL_TYPE_MAP[gameState.state_type];
                if (evalType) dispatch(evalRetryRequested(evalType));
              }}
              className="text-[10px] text-spire-text-muted hover:text-spire-text-secondary transition-colors"
            >
              Re-evaluate
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
