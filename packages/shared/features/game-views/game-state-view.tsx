"use client";

import type { ReactNode } from "react";
import type { GameState, CombatCard } from "../../types/game-state";
import { isCombatState, hasRun } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { RunState } from "../connection/use-run-tracker";
import { CardPickView } from "../card-pick/card-pick-view";
import { CardRemovalView } from "../shop/card-removal-view";
import { CardUpgradeView } from "../rest-site/card-upgrade-view";
import { CardSelectEvalView } from "../card-select/card-select-eval-view";
import { ShopView } from "../shop/shop-view";
import { MapView } from "../map/map-view";
import { RelicSelectView } from "../relic-select/relic-select-view";
import { EventView } from "../event/event-view";
import { RestSiteView } from "../rest-site/rest-site-view";
import { CombatView } from "./combat-view";
import { CombatRewardsView } from "./combat-rewards-view";
import { MenuView } from "./menu-view";
import { STATE_LABELS } from "./state-labels";

interface GameStateViewProps {
  state: GameState;
  deckCards: CombatCard[];
  player: TrackedPlayer | null;
  runId: string | null;
  runState: RunState;
  menuFooter?: ReactNode;
}

export function GameStateView({
  state,
  deckCards,
  player,
  runId,
  runState,
  menuFooter,
}: GameStateViewProps) {
  if (isCombatState(state)) {
    if (!state.battle) return <PlaceholderView title="Combat" state={state} />;
    return <CombatView state={state} deckCards={deckCards} />;
  }

  switch (state.state_type) {
    case "card_reward":
      if (!state.card_reward) return <PlaceholderView title="Card Reward" state={state} />;
      return <CardPickView state={state} deckCards={deckCards} player={player} runId={runId} />;
    case "shop":
      if (!state.shop) return <PlaceholderView title="Shop" state={state} />;
      return <ShopView state={state} deckCards={deckCards} player={player} runId={runId} />;
    case "map":
      if (!state.map) return <PlaceholderView title="Map" state={state} />;
      return <MapView state={state} player={player} deckCards={deckCards} />;
    case "event":
      if (!state.event) return <PlaceholderView title="Event" state={state} />;
      return <EventView state={state} deckCards={deckCards} player={player} runId={runId} />;
    case "rest_site":
      if (!state.rest_site) return <PlaceholderView title="Rest Site" state={state} />;
      return <RestSiteView state={state} deckCards={deckCards} player={player} runId={runId} />;
    case "relic_select":
      if (!state.relic_select) return <PlaceholderView title="Relic Select" state={state} />;
      return <RelicSelectView state={state} deckCards={deckCards} player={player} />;
    case "card_select": {
      if (!state.card_select) return <PlaceholderView title="Card Select" state={state} />;
      const screenType = state.card_select.screen_type;
      const promptLower = state.card_select.prompt?.toLowerCase() ?? "";
      const isRemoval = promptLower.includes("remove") || promptLower.includes("purge");
      const isUpgrade = promptLower.includes("upgrade") || promptLower.includes("smith") || promptLower.includes("enhance");

      if (isRemoval) {
        return <CardRemovalView state={state} deckCards={deckCards} player={player} />;
      }

      if (isUpgrade) {
        return <CardUpgradeView state={state} deckCards={deckCards} player={player} />;
      }

      // Detect if cards are from the player's deck (buff/enchant/transform)
      // vs new cards being offered (reward). If most offered cards are already
      // in the deck, this is a "pick from your deck" screen.
      const deckNames = new Set(deckCards.map((c) => c.name.toLowerCase()));
      const offeredCards = state.card_select.cards;
      const fromDeckCount = offeredCards.filter((c) => deckNames.has(c.name.toLowerCase())).length;
      const isFromDeck = offeredCards.length > 0 && fromDeckCount / offeredCards.length > 0.5;

      if (isFromDeck) {
        // Enchant, imbue, transform, etc. — pick from your deck
        return <CardSelectEvalView state={state} deckCards={deckCards} player={player} />;
      }

      // New cards being offered (reward-style)
      const isMultiSelect = screenType === "simple_select";
      const asCardReward = {
        state_type: "card_reward" as const,
        card_reward: {
          cards: state.card_select.cards,
          can_skip: !!state.card_select.can_cancel,
        },
        run: state.run,
      };
      return (
        <div className="flex flex-col gap-2">
          {state.card_select.prompt && (
            <p className="text-xs text-zinc-400">{state.card_select.prompt}</p>
          )}
          <CardPickView state={asCardReward} deckCards={deckCards} player={player} runId={runId} exclusive={!isMultiSelect} />
        </div>
      );
    }
    case "combat_rewards":
      if (!state.rewards) return <PlaceholderView title="Rewards" state={state} />;
      return <CombatRewardsView state={state} />;
    case "menu":
      return <MenuView runState={runState} footer={menuFooter} />;
    default:
      return <PlaceholderView title={STATE_LABELS[state.state_type] ?? state.state_type} state={state} />;
  }
}

function PlaceholderView({ title, state }: { title: string; state: GameState }) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-zinc-100">{title}</h2>
      {hasRun(state) && (
        <p className="text-xs font-mono text-zinc-600">
          Act {state.run.act} · Floor {state.run.floor}
        </p>
      )}
      <p className="text-sm text-zinc-500">View coming soon</p>
    </div>
  );
}
