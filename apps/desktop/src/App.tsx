import { useGameState, ConnectionBanner } from "@sts2/shared/features/connection";
import { useDeckTracker } from "@sts2/shared/features/connection/use-deck-tracker";
import { usePlayerTracker } from "@sts2/shared/features/connection/use-player-tracker";
import { useRunTracker } from "@sts2/shared/features/connection/use-run-tracker";
import { HpBar } from "@sts2/shared/components/hp-bar";
import { hasRun } from "@sts2/shared/types/game-state";

export function App() {
  const { gameState, connectionStatus } = useGameState();
  const deckCards = useDeckTracker(gameState);
  const player = usePlayerTracker(gameState);
  // Side-effect only: tracks run start/end in Supabase
  // TODO: Wire up useChoiceTracker when auth is added
  useRunTracker(gameState);

  if (connectionStatus !== "connected" || !gameState) {
    return (
      <ConnectionBanner
        status={connectionStatus}
        navLinks={[]}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-zinc-100 tracking-tight">
            STS2 Replay
          </span>
          <div className="h-4 w-px bg-zinc-800" />
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-mono text-zinc-400">
            {gameState.state_type}
          </span>
          {hasRun(gameState) && (
            <span className="text-xs font-mono text-zinc-500">
              Act {gameState.run.act} · Floor {gameState.run.floor}
            </span>
          )}
        </div>
        {player && (
          <div className="flex items-center gap-5">
            <span className="text-sm text-zinc-400">{player.character}</span>
            <HpBar current={player.hp} max={player.maxHp} />
            <span className="text-sm font-mono tabular-nums text-amber-400">
              {player.gold}g
            </span>
          </div>
        )}
      </header>

      {/* Main content — placeholder for now */}
      <main className="flex-1 p-6">
        <div className="text-center text-zinc-500">
          <p className="text-lg">Desktop app connected!</p>
          <p className="mt-2 text-sm">
            State: {gameState.state_type}
            {hasRun(gameState) && ` · Act ${gameState.run.act} Floor ${gameState.run.floor}`}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Deck: {deckCards.length} cards
            {player && ` · ${player.hp}/${player.maxHp} HP · ${player.gold}g`}
          </p>
        </div>
      </main>
    </div>
  );
}
