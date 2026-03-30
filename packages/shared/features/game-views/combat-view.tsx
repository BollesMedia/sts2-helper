"use client";

import { HpBar } from "../../components/hp-bar";
import { BossBriefing } from "../combat/boss-briefing";
import { cn } from "../../lib/cn";
import type { CombatState, CombatCard } from "../../types/game-state";
import { STATE_LABELS } from "./state-labels";

export function CombatView({ state, deckCards }: { state: CombatState; deckCards: CombatCard[] }) {
  if (!state.battle?.player) {
    return (
      <div className="flex flex-col gap-6">
        <h2 className="text-xl font-semibold text-zinc-100">Combat</h2>
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }
  const { player, enemies } = state.battle;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold text-zinc-100">
          {STATE_LABELS[state.state_type] ?? "Combat"}
        </h2>
        <span className="text-xs font-mono text-zinc-600">
          Round {state.battle.round}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Player</h3>
          <div className="flex items-center justify-between">
            <HpBar current={player.hp} max={player.max_hp} />
            <div className="flex items-center gap-3 text-sm font-mono tabular-nums">
              <span className="text-blue-400">{player.energy}/{player.max_energy} E</span>
              <span className="text-cyan-400">{player.block} B</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Enemies</h3>
          <div className="space-y-2">
            {enemies.map((enemy) => (
              <div key={enemy.entity_id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-200">{enemy.name}</span>
                  {enemy.block > 0 && (
                    <span className="text-xs text-cyan-400">{enemy.block} B</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {enemy.intents[0] && (
                    <span className={cn(
                      "rounded px-1.5 py-0.5 text-xs font-medium",
                      enemy.intents[0].type === "Attack" && "bg-red-400/10 text-red-400",
                      enemy.intents[0].type === "Buff" && "bg-amber-400/10 text-amber-400",
                      enemy.intents[0].type === "Debuff" && "bg-purple-400/10 text-purple-400",
                      enemy.intents[0].type === "Defend" && "bg-blue-400/10 text-blue-400",
                      !["Attack", "Buff", "Debuff", "Defend"].includes(enemy.intents[0].type) && "bg-zinc-700/50 text-zinc-400"
                    )}>
                      {enemy.intents[0].title}
                    </span>
                  )}
                  <HpBar current={enemy.hp} max={enemy.max_hp} size="sm" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Hand ({player.hand.length})
        </h3>
        <div className="flex flex-wrap gap-2">
          {player.hand.map((card, i) => (
            <span key={i} className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200">
              {card.name}
            </span>
          ))}
          {player.hand.length === 0 && (
            <span className="text-sm text-zinc-600">No cards in hand</span>
          )}
        </div>
      </div>

      {state.state_type === "boss" && (
        <BossBriefing enemies={enemies} ascension={state.run.ascension} deckCards={deckCards} />
      )}

      {(player.status.length > 0 || enemies.some((e) => e.status.length > 0)) && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Status Effects</h3>
          <div className="space-y-2">
            {player.status.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {player.status.map((s, i) => (
                  <span key={i} className={cn("rounded px-2 py-0.5 text-xs", s.type === "Buff" ? "bg-emerald-400/10 text-emerald-400" : "bg-red-400/10 text-red-400")}>
                    {s.name} {s.amount}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
