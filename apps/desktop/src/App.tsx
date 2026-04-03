import { ConnectionBanner } from "./views/connection";
import { useGameState } from "./hooks/useGameState";
import { useDeckTracker } from "./views/connection/use-deck-tracker";
import { usePlayerTracker } from "./views/connection/use-player-tracker";
import { useRunTracker } from "./views/connection/use-run-tracker";
import { useChoiceTracker } from "./views/connection/use-choice-tracker";
import { useAppSelector, useAppDispatch } from "./store/hooks";
import { selectActiveDeck, selectActivePlayer } from "./features/run/runSelectors";
import { selectActiveRunId } from "./features/run/runSlice";
import { evaluationApi } from "./services/evaluationApi";
import { AppHeader } from "./views/game-views/app-header";
import { GameStateView } from "./views/game-views/game-state-view";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { reportFeedback, reportInfo } from "@sts2/shared/lib/error-reporter";
import { useAuth } from "./auth-provider";
import { LoginScreen } from "./login-screen";
import { SetupWizard } from "./setup-wizard";
import { useState, useRef, useEffect } from "react";
import { ModVersionBanner } from "./mod-version-banner";
import { MapEvalProvider } from "./views/map/map-eval-context";

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

  // Old hooks still run for backward compat + choice tracking
  const oldDeckCards = useDeckTracker(gameState);
  const oldPlayer = usePlayerTracker(gameState);
  const runState = useRunTracker(gameState, user?.id ?? null, connectionStatus === "disconnected");
  useChoiceTracker(gameState, oldDeckCards, runState.runId);

  // Redux data (populated by listeners) — prefer when available
  const reduxDeck = useAppSelector(selectActiveDeck);
  const reduxPlayer = useAppSelector(selectActivePlayer);
  const reduxRunId = useAppSelector(selectActiveRunId);

  // Use Redux data when a run is active in the store, fall back to old hooks
  const deckCards = reduxRunId && reduxDeck.length > 0 ? reduxDeck : oldDeckCards;
  const player = reduxRunId && reduxPlayer ? reduxPlayer : oldPlayer;

  // Runtime mod version check — once per session after connecting
  const modCheckDone = useRef(false);
  const [modMismatch, setModMismatch] = useState<{
    installed: string;
    required: string;
    gameRunning: boolean;
  } | null>(null);

  useEffect(() => {
    if (connectionStatus !== "connected" || modCheckDone.current) return;
    modCheckDone.current = true;

    invoke<ModStatus>("get_mod_status")
      .then((status) => {
        const sts2mcp = status.required_mods.find((m) => m.id === "STS2_MCP");
        if (sts2mcp && sts2mcp.needs_update && sts2mcp.installed_version) {
          setModMismatch({
            installed: sts2mcp.installed_version,
            required: sts2mcp.required_version,
            gameRunning: status.game_running,
          });
        }
      })
      .catch(() => {
        // Silent — mod check is best-effort at runtime
      });
  }, [connectionStatus]);

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
    <MapEvalProvider>
    <div className="flex flex-1 flex-col h-screen overflow-hidden">
      {gameState && <AppHeader gameState={gameState} player={player} onSignOut={signOut} />}
      {modMismatch && (
        <ModVersionBanner
          installed={modMismatch.installed}
          required={modMismatch.required}
          gameRunning={modMismatch.gameRunning}
          onUpdated={() => setModMismatch(null)}
        />
      )}
      <main className="flex-1 min-h-0 p-4">
        {gameState ? (
          <GameStateView
            state={gameState}
            deckCards={deckCards}
            player={player}
            runId={runState.runId}
            runState={runState}
          />
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
                // Clear old eval caches (still used by legacy hooks)
                localStorage.removeItem("sts2-eval-cache");
                localStorage.removeItem("sts2-shop-eval-cache");
                localStorage.removeItem("sts2-map-eval-cache");
                localStorage.removeItem("sts2-event-eval-cache");
                localStorage.removeItem("sts2-rest-eval-cache");
                // Clear RTK Query mutation cache
                dispatch(evaluationApi.util.resetApiState());
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
    </MapEvalProvider>
  );
}
