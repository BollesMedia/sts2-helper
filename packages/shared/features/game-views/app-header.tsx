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
  const isMultiplayer = gameState.game_mode === "multiplayer";
  const teammates = isMultiplayer && gameState.players
    ? gameState.players.filter((p) => !p.is_local)
    : [];

  return (
    <header className="flex items-center justify-between border-b border-spire-border bg-spire-surface px-4 py-2 shadow-[0_1px_8px_rgba(0,0,0,0.3)]">
      <div className="flex items-center gap-3">
        {/* App branding with amber accent */}
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(251,191,36,0.5)]" />
          <span className="text-xs font-display font-bold text-spire-text tracking-tight">
            STS2
          </span>
        </div>

        {/* Gradient divider */}
        <div className="h-3 w-px bg-gradient-to-b from-transparent via-zinc-700 to-transparent" />

        {/* State label */}
        <span className="text-xs font-medium text-zinc-300">{label}</span>

        {isMultiplayer && (
          <>
            <div className="h-3 w-px bg-gradient-to-b from-transparent via-zinc-700 to-transparent" />
            <span className="text-[10px] font-bold text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
              CO-OP
            </span>
          </>
        )}

        {run && (
          <>
            <div className="h-3 w-px bg-gradient-to-b from-transparent via-zinc-700 to-transparent" />
            <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800/50 px-1.5 py-0.5 rounded">
              Act {run.act} · Floor {run.floor}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        {player && (
          <>
            {/* Character name with subtle styling */}
            <span className="text-xs text-zinc-300 font-medium">{player.character}</span>
            <HpBar current={player.hp} max={player.maxHp} />
            {/* Gold with amber glow */}
            <span className="text-xs font-mono tabular-nums text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
              {player.gold}g
            </span>
          </>
        )}
        {teammates.map((t, i) => (
          <span key={i} className="contents">
            <div className="h-3 w-px bg-gradient-to-b from-transparent via-zinc-700 to-transparent" />
            <span className="text-xs text-zinc-400 font-medium">{t.character}</span>
            <HpBar current={t.hp} max={t.max_hp} size="sm" />
          </span>
        ))}
        {onSignOut && (
          <button
            onClick={onSignOut}
            className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
