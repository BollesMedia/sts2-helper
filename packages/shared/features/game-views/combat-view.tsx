"use client";

import { HpBar } from "../../components/hp-bar";
import { BossBriefing } from "../combat/boss-briefing";
import { cn } from "../../lib/cn";
import type { CombatState, CombatCard, BattlePlayer } from "../../types/game-state";
import { getPlayer } from "../../types/game-state";
import { STATE_LABELS } from "./state-labels";

// --- Intent styling ---

const INTENT_STYLES: Record<string, string> = {
  Attack: "bg-red-500/15 text-red-400 border-red-500/25",
  Buff: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  Debuff: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  Defend: "bg-blue-500/15 text-blue-400 border-blue-500/25",
};
const INTENT_DEFAULT = "bg-zinc-700/40 text-zinc-400 border-zinc-600/30";

// --- Sub-components ---

function StatChip({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className={cn("flex items-center gap-1 rounded px-1.5 py-0.5 border text-[11px] font-mono tabular-nums", color)}>
      <span className="font-semibold">{value}</span>
      <span className="text-[9px] uppercase opacity-70">{label}</span>
    </div>
  );
}

function StatusBadges({ status }: { status: { name: string; amount: number; type: string }[] }) {
  if (!status?.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {status.map((s, i) => (
        <span
          key={i}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium border",
            s.type === "Buff"
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-red-500/10 text-red-400 border-red-500/20"
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
        "rounded-lg border p-3",
        isTeammate
          ? "border-purple-500/20 bg-purple-950/20"
          : "border-zinc-800 bg-zinc-900/60"
      )}
    >
      {/* Name + stats row */}
      <div className="flex items-center justify-between mb-2">
        <span
          className={cn(
            "text-xs font-semibold tracking-tight",
            isTeammate ? "text-purple-300" : "text-zinc-200"
          )}
        >
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          <StatChip
            value={player.energy ?? 0}
            label={`/${player.max_energy ?? 0}e`}
            color="bg-blue-500/10 text-blue-400 border-blue-500/20"
          />
          {(player.block ?? 0) > 0 && (
            <StatChip
              value={player.block ?? 0}
              label="blk"
              color="bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
            />
          )}
        </div>
      </div>

      {/* HP bar */}
      <HpBar current={player.hp} max={player.max_hp} size="sm" />

      {/* Status effects inline */}
      <StatusBadges status={player.status} />
    </div>
  );
}

function EnemyRow({ enemy }: { enemy: CombatState["battle"]["enemies"][number] }) {
  const intent = enemy.intents[0];
  const intentStyle = intent ? (INTENT_STYLES[intent.type] ?? INTENT_DEFAULT) : "";

  return (
    <div className="rounded border border-zinc-800/60 bg-zinc-900/40 px-2.5 py-2 space-y-1.5">
      {/* Name + Intent */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-zinc-200 truncate">{enemy.name}</span>
          {(enemy.block ?? 0) > 0 && (
            <span className="text-[10px] font-mono text-cyan-400 shrink-0">
              {enemy.block}B
            </span>
          )}
        </div>
        {intent && (
          <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold shrink-0", intentStyle)}>
            {intent.title}
          </span>
        )}
      </div>

      {/* HP */}
      <HpBar current={enemy.hp} max={enemy.max_hp} size="sm" />

      {/* Status effects */}
      {enemy.status?.length > 0 && <StatusBadges status={enemy.status} />}
    </div>
  );
}

// --- Main component ---

export function CombatView({ state, deckCards }: { state: CombatState; deckCards: CombatCard[] }) {
  const player = getPlayer(state);
  if (!player || !state.battle) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-sm text-zinc-500 animate-pulse">Connecting to combat...</span>
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
        gridTemplateRows: isBoss ? "auto auto minmax(0, 1fr) auto" : "auto auto auto",
      }}
    >
      {/* Row 1: Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-display font-bold text-spire-text">
            {STATE_LABELS[state.state_type] ?? "Combat"}
          </h2>
          <span className="text-[10px] font-mono text-spire-text-tertiary bg-spire-elevated/50 px-1.5 py-0.5 rounded">
            Round {state.battle.round}
          </span>
        </div>
      </div>

      {/* Row 2: Battlefield — players left, enemies right */}
      <div className="grid grid-cols-2 gap-3 min-h-0">
        {/* Left: Players */}
        <div className="flex flex-col gap-2">
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

        {/* Right: Enemies */}
        <div className="flex flex-col gap-2">
          {enemies.map((enemy) => (
            <EnemyRow key={enemy.entity_id} enemy={enemy} />
          ))}
        </div>
      </div>

      {/* Row 3: Boss Briefing (boss fights only — gets remaining space) */}
      {isBoss && (
        <div className="min-h-0 overflow-y-auto">
          <BossBriefing
            enemies={enemies}
            ascension={state.run.ascension}
            deckCards={deckCards}
          />
        </div>
      )}

      {/* Row 4: Hand — anchored to bottom, subtle */}
      <div className="rounded-lg border border-spire-border bg-spire-surface/40 px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[9px] font-medium text-spire-text-muted shrink-0 mr-1">
            Hand ({player.hand.length})
          </span>
          {player.hand.map((card, i) => (
            <span
              key={i}
              className="rounded border border-spire-border bg-spire-elevated/60 px-2 py-0.5 text-[10px] text-spire-text-secondary whitespace-nowrap shrink-0"
            >
              {card.name}
            </span>
          ))}
          {player.hand.length === 0 && (
            <span className="text-[10px] text-spire-text-muted italic">No cards</span>
          )}
        </div>
      </div>
    </div>
  );
}
