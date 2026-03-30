"use client";

import { HpBar } from "../../components/hp-bar";
import type { GameState } from "../../types/game-state";
import { hasRun } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import { STATE_LABELS } from "./state-labels";

interface AppHeaderProps {
  gameState: GameState;
  player: TrackedPlayer | null;
  onSignOut?: () => void;
}

export function AppHeader({ gameState, player, onSignOut }: AppHeaderProps) {
  const label = STATE_LABELS[gameState.state_type] ?? gameState.state_type;
  const run = hasRun(gameState) ? gameState.run : null;

  return (
    <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-sm font-semibold text-zinc-100 tracking-tight">
            STS2
          </span>
        </div>

        <div className="h-4 w-px bg-zinc-800" />

        <span className="text-sm font-medium text-zinc-300">{label}</span>

        {run && (
          <>
            <div className="h-4 w-px bg-zinc-800" />
            <span className="text-xs font-mono text-zinc-500">
              Act {run.act} · Floor {run.floor}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-5">
        {player && (
          <>
            <span className="text-sm text-zinc-400">{player.character}</span>
            <HpBar current={player.hp} max={player.maxHp} />
            <span className="text-sm font-mono tabular-nums text-amber-400">
              {player.gold}g
            </span>
          </>
        )}
        {onSignOut && (
          <button
            onClick={onSignOut}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
