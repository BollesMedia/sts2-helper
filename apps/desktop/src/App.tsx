import { useGameState, ConnectionBanner } from "@sts2/shared/features/connection";
import { useDeckTracker } from "@sts2/shared/features/connection/use-deck-tracker";
import { usePlayerTracker } from "@sts2/shared/features/connection/use-player-tracker";
import { useRunTracker } from "@sts2/shared/features/connection/use-run-tracker";
import { useChoiceTracker } from "@sts2/shared/evaluation/choice-tracker";
import { AppHeader } from "@sts2/shared/features/game-views/app-header";
import { GameStateView } from "@sts2/shared/features/game-views/game-state-view";

export function App() {
  const { gameState, connectionStatus } = useGameState();
  const deckCards = useDeckTracker(gameState);
  const player = usePlayerTracker(gameState);
  const runState = useRunTracker(gameState);
  // Side-effect only: logs choices to Supabase
  useChoiceTracker(gameState, deckCards, runState.runId);

  if (connectionStatus !== "connected" || !gameState) {
    return <ConnectionBanner status={connectionStatus} />;
  }

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader gameState={gameState} player={player} />
      <main className="flex-1 p-6">
        <GameStateView
          state={gameState}
          deckCards={deckCards}
          player={player}
          runId={runState.runId}
          runState={runState}
        />
      </main>
      <footer className="border-t border-zinc-800 px-6 py-2 flex justify-end">
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
    </div>
  );
}
