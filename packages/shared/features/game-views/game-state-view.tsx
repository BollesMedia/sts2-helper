"use client";

import type { ReactNode } from "react";
import type { GameState, CombatCard } from "../../types/game-state";
import { isCombatState, hasRun } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { RunState } from "../connection/use-run-tracker";
import { CardPickView } from "../card-pick/card-pick-view";
import { CardRemovalView } from "../shop/card-removal-view";
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
    return <CombatView state={state} deckCards={deckCards} />;
  }

  switch (state.state_type) {
    case "card_reward":
      return <CardPickView state={state} deckCards={deckCards} player={player} runId={runId} />;
    case "shop":
      return <ShopView state={state} deckCards={deckCards} player={player} runId={runId} />;
    case "map":
      return <MapView state={state} player={player} deckCards={deckCards} />;
    case "event":
      return <EventView state={state} deckCards={deckCards} player={player} runId={runId} />;
    case "rest_site":
      return <RestSiteView state={state} deckCards={deckCards} player={player} runId={runId} />;
    case "relic_select":
      return <RelicSelectView state={state} deckCards={deckCards} player={player} />;
    case "card_select": {
      const screenType = state.card_select.screen_type;
      const promptLower = state.card_select.prompt.toLowerCase();
      const isRemoval = promptLower.includes("remove") || promptLower.includes("purge");

      if (isRemoval) {
        return <CardRemovalView state={state} deckCards={deckCards} player={player} />;
      }

      // Treat all other card_select screens as card reward evaluations
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
        <CardPickView state={asCardReward} deckCards={deckCards} player={player} runId={runId} exclusive={!isMultiSelect} />
      );
    }
    case "combat_rewards":
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
