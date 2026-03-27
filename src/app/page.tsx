"use client";

import { useGameState, ConnectionBanner } from "@/features/connection";
import { useDeckTracker } from "@/features/connection/use-deck-tracker";
import { usePlayerTracker } from "@/features/connection/use-player-tracker";
import { useRunTracker } from "@/features/connection/use-run-tracker";
import { useChoiceTracker } from "@/evaluation/choice-tracker";
import { CardPickView } from "@/features/card-pick/card-pick-view";
import { ShopView } from "@/features/shop/shop-view";
import { MapView } from "@/features/map/map-view";
import { HpBar } from "@/components/hp-bar";
import { cn } from "@/lib/cn";
import type {
  GameState,
  CombatState,
  CombatCard,
} from "@/lib/types/game-state";
import type { TrackedPlayer } from "@/features/connection/use-player-tracker";
import { isCombatState, hasRun } from "@/lib/types/game-state";

// ─── State label formatting ───

const STATE_LABELS: Record<string, string> = {
  monster: "Combat",
  elite: "Elite Combat",
  boss: "Boss Fight",
  card_reward: "Card Reward",
  combat_rewards: "Rewards",
  card_select: "Card Select",
  relic_select: "Relic Select",
  hand_select: "Hand Select",
  rest_site: "Rest Site",
  shop: "Shop",
  map: "Map",
  event: "Event",
  treasure: "Treasure",
  menu: "Menu",
};

// ─── Header ───

function AppHeader({
  gameState,
  player,
}: {
  gameState: GameState;
  player: TrackedPlayer | null;
}) {
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
  );
}

// ─── View Router ───

function GameStateView({
  state,
  deckCards,
  player,
  runId,
}: {
  state: GameState;
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
  runId: string | null;
}) {
  if (isCombatState(state)) {
    return <CombatView state={state} />;
  }

  switch (state.state_type) {
    case "card_reward":
      return <CardPickView state={state} deckCards={deckCards} player={player} runId={runId} />;
    case "shop":
      return <ShopView state={state} deckCards={deckCards} player={player} runId={runId} />;
    case "map":
      return <MapView state={state} player={player} deckCards={deckCards} />;
    case "combat_rewards":
      return <CombatRewardsView state={state} />;
    case "menu":
      return <MenuView />;
    default:
      return <PlaceholderView title={STATE_LABELS[state.state_type] ?? state.state_type} state={state} />;
  }
}

// ─── Combat View ───

function CombatView({ state }: { state: CombatState }) {
  if (!state.battle?.player) {
    return <PlaceholderView title="Combat" state={state} />;
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
        {/* Player */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Player
          </h3>
          <div className="flex items-center justify-between">
            <HpBar current={player.hp} max={player.max_hp} />
            <div className="flex items-center gap-3 text-sm font-mono tabular-nums">
              <span className="text-blue-400">{player.energy}/{player.max_energy} E</span>
              <span className="text-cyan-400">{player.block} B</span>
            </div>
          </div>
        </div>

        {/* Enemies */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Enemies
          </h3>
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

      {/* Hand */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Hand ({player.hand.length})
        </h3>
        <div className="flex flex-wrap gap-2">
          {player.hand.map((card, i) => (
            <span
              key={i}
              className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200"
            >
              {card.name}
            </span>
          ))}
          {player.hand.length === 0 && (
            <span className="text-sm text-zinc-600">No cards in hand</span>
          )}
        </div>
      </div>

      {/* Status effects */}
      {(player.status.length > 0 || enemies.some((e) => e.status.length > 0)) && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Status Effects
          </h3>
          <div className="space-y-2">
            {player.status.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {player.status.map((s, i) => (
                  <span
                    key={i}
                    className={cn(
                      "rounded px-2 py-0.5 text-xs",
                      s.type === "Buff" ? "bg-emerald-400/10 text-emerald-400" : "bg-red-400/10 text-red-400"
                    )}
                  >
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

// ─── Combat Rewards View ───

function CombatRewardsView({
  state,
}: {
  state: Extract<GameState, { state_type: "combat_rewards" }>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-zinc-100">Rewards</h2>
      <div className="space-y-2">
        {state.rewards.items.map((item) => (
          <div
            key={item.index}
            className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 flex items-center gap-3"
          >
            <span className="text-lg">
              {item.type === "gold" ? "💰" : item.type === "card" ? "🃏" : item.type === "potion" ? "🧪" : item.type === "relic" ? "💎" : "📦"}
            </span>
            <span className="text-sm text-zinc-200">{item.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Menu View ───

function MenuView() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center space-y-3">
        <h2 className="text-2xl font-semibold text-zinc-200">
          Waiting for run
        </h2>
        <p className="text-sm text-zinc-500">
          Start a new run in Slay the Spire 2
        </p>
      </div>
    </div>
  );
}

// ─── Placeholder ───

function PlaceholderView({
  title,
  state,
}: {
  title: string;
  state: GameState;
}) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-zinc-100">{title}</h2>
      {hasRun(state) && (
        <p className="text-xs font-mono text-zinc-600">
          Act {state.run.act} · Floor {state.run.floor}
        </p>
      )}
      <p className="text-sm text-zinc-500">
        View coming soon
      </p>
    </div>
  );
}

// ─── Dashboard ───

export default function Dashboard() {
  const { gameState, connectionStatus } = useGameState();
  const deckCards = useDeckTracker(gameState);
  const player = usePlayerTracker(gameState);
  const runId = useRunTracker(gameState);
  useChoiceTracker(gameState, deckCards, runId);

  if (connectionStatus !== "connected" || !gameState) {
    return <ConnectionBanner status={connectionStatus} />;
  }

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader gameState={gameState} player={player} />
      <main className="flex-1 p-6">
        <GameStateView state={gameState} deckCards={deckCards} player={player} runId={runId} />
      </main>
    </div>
  );
}
