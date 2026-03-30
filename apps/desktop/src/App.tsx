import { useGameState, ConnectionBanner } from "@sts2/shared/features/connection";
import { useDeckTracker } from "@sts2/shared/features/connection/use-deck-tracker";
import { usePlayerTracker } from "@sts2/shared/features/connection/use-player-tracker";
import { useRunTracker } from "@sts2/shared/features/connection/use-run-tracker";
import { useChoiceTracker } from "@sts2/shared/evaluation/choice-tracker";
import { AppHeader } from "@sts2/shared/features/game-views/app-header";
import { GameStateView } from "@sts2/shared/features/game-views/game-state-view";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "./auth-provider";
import { LoginScreen } from "./login-screen";
import { SetupWizard } from "./setup-wizard";
import { useState, useRef } from "react";

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
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (modCheck === "checking") {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen">
        <p className="text-sm text-zinc-500">Checking mod status...</p>
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
  const runState = useRunTracker(gameState, user?.id ?? null);
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
      <main className="flex-1 min-h-0 p-6">
        <GameStateView
          state={gameState}
          deckCards={deckCards}
          player={player}
          runId={runState.runId}
          runState={runState}
        />
      </main>
      {gameState.state_type !== "menu" && (
        <footer className="border-t border-zinc-800 px-6 py-2 flex justify-between">
          <button
            onClick={() => {
              localStorage.clear();
              window.location.reload();
            }}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Clear cache
          </button>
          <button
            onClick={() => {
              localStorage.removeItem("sts2-eval-cache");
              localStorage.removeItem("sts2-shop-eval-cache");
              localStorage.removeItem("sts2-map-eval-cache");
              localStorage.removeItem("sts2-event-eval-cache");
              localStorage.removeItem("sts2-rest-eval-cache");
              window.location.reload();
            }}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Re-evaluate
          </button>
        </footer>
      )}
    </div>
  );
}
