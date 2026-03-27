"use client";

import { useGameState, ConnectionBanner } from "@/features/connection";
import { useDeckTracker } from "@/features/connection/use-deck-tracker";
import { usePlayerTracker } from "@/features/connection/use-player-tracker";
import { CardPickView } from "@/features/card-pick/card-pick-view";
import type {
  GameState,
  CombatState,
  CombatCard,
} from "@/lib/types/game-state";
import type { TrackedPlayer } from "@/features/connection/use-player-tracker";
import { isCombatState, hasRun } from "@/lib/types/game-state";

function GameStateView({
  state,
  deckCards,
  player,
}: {
  state: GameState;
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
}) {
  if (isCombatState(state)) {
    return <CombatPlaceholder state={state} />;
  }

  switch (state.state_type) {
    case "card_reward":
      return <CardPickView state={state} deckCards={deckCards} player={player} />;
    case "shop":
      return <PlaceholderView title="Shop" state={state} />;
    case "map":
      return <MapPlaceholder state={state} />;
    case "event":
      return <PlaceholderView title="Event" state={state} />;
    case "rest_site":
      return <PlaceholderView title="Rest Site" state={state} />;
    case "combat_rewards":
      return <CombatRewardsPlaceholder state={state} />;
    case "card_select":
      return <PlaceholderView title="Card Select" state={state} />;
    case "relic_select":
      return <PlaceholderView title="Relic Select" state={state} />;
    case "treasure":
      return <PlaceholderView title="Treasure" state={state} />;
    case "hand_select":
      return <PlaceholderView title="Hand Select" state={state} />;
    case "menu":
      return <MenuView />;
    default:
      return <PlaceholderView title="Unknown" state={state} />;
  }
}

function CombatPlaceholder({ state }: { state: CombatState }) {
  if (!state.battle?.player) {
    return <PlaceholderView title="Combat (loading...)" state={state} />;
  }
  const { player, enemies } = state.battle;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <h2 className="text-lg font-semibold text-zinc-100">
        Combat ({state.state_type}) — Round {state.battle.round}
      </h2>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="mb-2 text-sm font-medium text-zinc-400">Player</h3>
          <p className="text-zinc-200">
            {player.character} — {player.hp}/{player.max_hp} HP
          </p>
          <p className="text-sm text-zinc-500">
            Energy: {player.energy}/{player.max_energy} | Block:{" "}
            {player.block} | Gold: {player.gold}
          </p>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="mb-2 text-sm font-medium text-zinc-400">
            Enemies ({enemies.length})
          </h3>
          {enemies.map((enemy) => (
            <div key={enemy.entity_id} className="mb-1">
              <span className="text-zinc-200">{enemy.name}</span>
              <span className="ml-2 text-sm text-zinc-500">
                {enemy.hp}/{enemy.max_hp} HP
              </span>
              {enemy.intents[0] && (
                <span className="ml-2 text-xs text-amber-400">
                  {enemy.intents[0].title}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="mb-2 text-sm font-medium text-zinc-400">
          Hand ({player.hand.length} cards)
        </h3>
        <div className="flex flex-wrap gap-2">
          {player.hand.map((card, i) => (
            <span
              key={i}
              className="rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-300"
            >
              {card.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function CombatRewardsPlaceholder({
  state,
}: {
  state: Extract<GameState, { state_type: "combat_rewards" }>;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <h2 className="text-lg font-semibold text-zinc-100">Combat Rewards</h2>
      <div className="space-y-2">
        {state.rewards.items.map((item) => (
          <div
            key={item.index}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
          >
            <span className="text-sm text-zinc-300">{item.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MapPlaceholder({
  state,
}: {
  state: Extract<GameState, { state_type: "map" }>;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <h2 className="text-lg font-semibold text-zinc-100">Map</h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-sm text-zinc-400">
          {state.map.player.character} — {state.map.player.hp}/
          {state.map.player.max_hp} HP | Gold: {state.map.player.gold}
        </p>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium text-zinc-400">
          Next options
        </h3>
        <div className="flex gap-2">
          {state.map.next_options.map((opt) => (
            <div
              key={opt.index}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
            >
              <span className="text-sm font-medium text-zinc-200">
                {opt.type}
              </span>
              <p className="mt-1 text-xs text-zinc-500">
                Leads to: {opt.leads_to?.map((l) => l.type).join(", ") ?? "unknown"}
              </p>
            </div>
          ))}
        </div>
      </div>
      <p className="text-sm text-zinc-500">
        Full map view coming soon. {state.map.nodes.length} nodes total.
      </p>
    </div>
  );
}

function MenuView() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-zinc-200">
          Waiting for run...
        </h2>
        <p className="mt-2 text-sm text-zinc-500">
          Start a new run in Slay the Spire 2
        </p>
      </div>
    </div>
  );
}

function PlaceholderView({
  title,
  state,
}: {
  title: string;
  state: GameState;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
      {hasRun(state) && (
        <p className="text-xs text-zinc-600">
          Act {state.run.act}, Floor {state.run.floor}
        </p>
      )}
      <p className="text-sm text-zinc-500">
        Feature view coming soon. State type: {state.state_type}
      </p>
    </div>
  );
}

export default function Dashboard() {
  const { gameState, connectionStatus } = useGameState();
  const deckCards = useDeckTracker(gameState);
  const player = usePlayerTracker(gameState);

  if (connectionStatus !== "connected" || !gameState) {
    return <ConnectionBanner status={connectionStatus} />;
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <span className="text-sm font-medium text-zinc-300">Connected</span>
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-mono text-zinc-400">
            {gameState.state_type}
          </span>
          {hasRun(gameState) && (
            <span className="text-xs text-zinc-600">
              Act {gameState.run.act} · Floor {gameState.run.floor}
            </span>
          )}
        </div>
        {player && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-zinc-400">{player.character}</span>
            <span className="text-red-400">{player.hp}/{player.maxHp} HP</span>
            <span className="text-amber-400">{player.gold}g</span>
          </div>
        )}
      </div>
      <GameStateView state={gameState} deckCards={deckCards} player={player} />
    </div>
  );
}
