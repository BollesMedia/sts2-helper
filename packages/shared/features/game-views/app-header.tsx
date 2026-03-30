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
    <header className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/50 px-6 py-3 shadow-[0_1px_8px_rgba(0,0,0,0.3)]">
      <div className="flex items-center gap-4">
        {/* App branding with amber accent */}
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(251,191,36,0.5)]" />
          <span className="text-sm font-bold text-zinc-100 tracking-tight">
            STS2
          </span>
        </div>

        {/* Gradient divider */}
        <div className="h-4 w-px bg-gradient-to-b from-transparent via-zinc-700 to-transparent" />

        {/* State label */}
        <span className="text-sm font-medium text-zinc-300">{label}</span>

        {run && (
          <>
            <div className="h-4 w-px bg-gradient-to-b from-transparent via-zinc-700 to-transparent" />
            <span className="text-xs font-mono text-zinc-500 bg-zinc-800/50 px-2 py-0.5 rounded">
              Act {run.act} · Floor {run.floor}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-5">
        {player && (
          <>
            {/* Character name with subtle styling */}
            <span className="text-sm text-zinc-300 font-medium">{player.character}</span>
            <HpBar current={player.hp} max={player.maxHp} />
            {/* Gold with amber glow */}
            <span className="text-sm font-mono tabular-nums text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
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
