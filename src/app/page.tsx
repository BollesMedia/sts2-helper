"use client";

import { useRef } from "react";
import { useGameState, ConnectionBanner } from "@/features/connection";
import { CardPickView } from "@/features/card-pick/card-pick-view";
import type { GameState, GameCard, CardRewardState } from "@/lib/types/game-state";
import { isCombatState, hasPlayer } from "@/lib/types/game-state";

/**
 * Maintains a reference to the last known deck cards.
 * Many states (card_reward, combat_rewards) don't include the full deck,
 * so we capture it from states that do (combat, map, shop, etc).
 */
function useDeckTracker(gameState: GameState | null): GameCard[] {
  const deckCards = useRef<GameCard[]>([]);

  if (gameState && isCombatState(gameState)) {
    // During combat, hand + draw + discard + exhaust = full deck
    // But we only have the hand and pile counts, not full contents
    // For now, store hand cards as a partial signal
    deckCards.current = gameState.hand;
  }

  // States with card_select often show the full deck
  if (gameState?.state_type === "card_select") {
    deckCards.current = gameState.cards;
  }

  return deckCards.current;
}

function GameStateView({
  state,
  deckCards,
}: {
  state: GameState;
  deckCards: GameCard[];
}) {
  if (isCombatState(state)) {
    return <CombatPlaceholder state={state} />;
  }

  switch (state.state_type) {
    case "card_reward":
      return <CardPickView state={state} deckCards={deckCards} />;
    case "shop":
      return <PlaceholderView title="Shop" state={state} />;
    case "map":
      return <PlaceholderView title="Map" state={state} />;
    case "event":
      return <PlaceholderView title="Event" state={state} />;
    case "rest_site":
      return <PlaceholderView title="Rest Site" state={state} />;
    case "combat_rewards":
      return <PlaceholderView title="Combat Rewards" state={state} />;
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

function CombatPlaceholder({
  state,
}: {
  state: Extract<GameState, { state_type: "monster" | "elite" | "boss" }>;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <h2 className="text-lg font-semibold text-zinc-100">
        Combat ({state.state_type})
      </h2>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="mb-2 text-sm font-medium text-zinc-400">Player</h3>
          <p className="text-zinc-200">
            {state.player.character} — {state.player.hp}/{state.player.max_hp} HP
          </p>
          <p className="text-sm text-zinc-500">
            Energy: {state.player.energy}/{state.player.max_energy} | Block:{" "}
            {state.player.block} | Gold: {state.player.gold}
          </p>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="mb-2 text-sm font-medium text-zinc-400">
            Enemies ({state.enemies.length})
          </h3>
          {state.enemies.map((enemy) => (
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
          Hand ({state.hand.length} cards)
        </h3>
        <div className="flex flex-wrap gap-2">
          {state.hand.map((card) => (
            <span
              key={card.index}
              className="rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-300"
            >
              {card.name}{" "}
              <span className="text-zinc-500">({card.cost})</span>
            </span>
          ))}
        </div>
      </div>
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
      {hasPlayer(state) && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-sm text-zinc-400">
            {state.player.character} — {state.player.hp}/{state.player.max_hp} HP
          </p>
        </div>
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

  if (connectionStatus !== "connected" || !gameState) {
    return <ConnectionBanner status={connectionStatus} />;
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <span className="text-sm font-medium text-zinc-300">Connected</span>
        <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-mono text-zinc-400">
          {gameState.state_type}
        </span>
      </div>
      <GameStateView state={gameState} deckCards={deckCards} />
    </div>
  );
}
