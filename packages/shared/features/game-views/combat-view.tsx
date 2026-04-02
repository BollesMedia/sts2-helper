"use client";

import { HpBar } from "../../components/hp-bar";
import { BossBriefing } from "../combat/boss-briefing";
import { cn } from "../../lib/cn";
import type { CombatState, CombatCard, BattlePlayer } from "../../types/game-state";
import { getLocalCombatPlayer } from "../../types/game-state";
import { STATE_LABELS } from "./state-labels";

function StatusBadges({ status }: { status: { name: string; amount: number; type: string }[] }) {
  if (!status?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {status.map((s, i) => (
        <span
          key={i}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px]",
            s.type === "Buff" ? "bg-emerald-400/10 text-emerald-400" : "bg-red-400/10 text-red-400"
          )}
        >
          {s.name} {s.amount}
        </span>
      ))}
    </div>
  );
}

function PlayerPanel({
  player,
  label,
  variant = "default",
}: {
  player: BattlePlayer;
  label: string;
  variant?: "default" | "teammate";
}) {
  const isTeammate = variant === "teammate";
  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-2",
        isTeammate
          ? "border-purple-800/40 bg-purple-900/10"
          : "border-zinc-800 bg-zinc-900/50"
      )}
    >
      <div className="flex items-center justify-between">
        <h3
          className={cn(
            "text-[10px] font-medium uppercase tracking-wide",
            isTeammate ? "text-purple-400" : "text-zinc-500"
          )}
        >
          {label}
        </h3>
        <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
          <span className="text-blue-400">
            {player.energy ?? 0}/{player.max_energy ?? 0}E
          </span>
          <span className="text-cyan-400">{player.block ?? 0}B</span>
        </div>
      </div>
      <HpBar current={player.hp} max={player.max_hp} size="sm" />
      <StatusBadges status={player.status} />
    </div>
  );
}

export function CombatView({ state, deckCards }: { state: CombatState; deckCards: CombatCard[] }) {
  const player = getLocalCombatPlayer(state);
  if (!player) {
    return (
      <div className="flex flex-col gap-6">
        <h2 className="text-xl font-semibold text-zinc-100">Combat</h2>
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }

  const { enemies } = state.battle;
  const teammatePlayers = (state.battle.players ?? []).filter((p) => !p.is_local);
  const isBoss = state.state_type === "boss";

  return (
    <div
      className="grid h-full min-h-0 gap-2"
      style={{
        gridTemplateRows: isBoss ? "auto 1fr auto 1fr" : "auto 1fr auto",
      }}
    >
      {/* Row 1: Header */}
      <div className="flex items-baseline justify-between shrink-0">
        <h2 className="text-lg font-semibold text-zinc-100">
          {STATE_LABELS[state.state_type] ?? "Combat"}
        </h2>
        <span className="text-xs font-mono text-zinc-600">
          Round {state.battle.round}
        </span>
      </div>

      {/* Row 2: Players (left) + Enemies (right) */}
      <div className="grid grid-cols-2 gap-3 min-h-0 content-start">
        {/* Left column: You + Teammates */}
        <div className="flex flex-col gap-2 min-h-0">
          <PlayerPanel player={player} label="You" />
          {teammatePlayers.map((tp, idx) => (
            <PlayerPanel
              key={idx}
              player={tp}
              label={tp.character ?? `Teammate ${idx + 1}`}
              variant="teammate"
            />
          ))}
        </div>

        {/* Right column: Enemies */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2 min-h-0 overflow-y-auto">
          <h3 className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Enemies
          </h3>
          {enemies.map((enemy) => (
            <div key={enemy.entity_id} className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-zinc-200">{enemy.name}</span>
                  {enemy.block > 0 && (
                    <span className="text-[10px] text-cyan-400">{enemy.block}B</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {enemy.intents[0] && (
                    <span
                      className={cn(
                        "rounded px-1 py-0.5 text-[10px] font-medium",
                        enemy.intents[0].type === "Attack" && "bg-red-400/10 text-red-400",
                        enemy.intents[0].type === "Buff" && "bg-amber-400/10 text-amber-400",
                        enemy.intents[0].type === "Debuff" && "bg-purple-400/10 text-purple-400",
                        enemy.intents[0].type === "Defend" && "bg-blue-400/10 text-blue-400",
                        !["Attack", "Buff", "Debuff", "Defend"].includes(enemy.intents[0].type) &&
                          "bg-zinc-700/50 text-zinc-400"
                      )}
                    >
                      {enemy.intents[0].title}
                    </span>
                  )}
                  <HpBar current={enemy.hp} max={enemy.max_hp} size="sm" />
                </div>
              </div>
              {enemy.status?.length > 0 && <StatusBadges status={enemy.status} />}
            </div>
          ))}
        </div>
      </div>

      {/* Row 3: Hand */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 shrink-0">
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 shrink-0">
            Hand ({player.hand.length})
          </span>
          {player.hand.map((card, i) => (
            <span
              key={i}
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 whitespace-nowrap shrink-0"
            >
              {card.name}
            </span>
          ))}
          {player.hand.length === 0 && (
            <span className="text-xs text-zinc-600">Empty</span>
          )}
        </div>
      </div>

      {/* Row 4: Boss Briefing (boss fights only) */}
      {isBoss && (
        <div className="min-h-0 overflow-y-auto">
          <BossBriefing
            enemies={enemies}
            ascension={state.run.ascension}
            deckCards={deckCards}
          />
        </div>
      )}
    </div>
  );
}
