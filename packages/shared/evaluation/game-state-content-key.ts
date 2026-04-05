import type { GameState } from "../types/game-state";
import { computeMapContentKey } from "./map-content-key";

export function computeGameStateContentKey(state: GameState): string {
  const base = state.state_type;

  switch (state.state_type) {
    case "map":
      return computeMapContentKey(
        state.state_type,
        state.map?.current_position ?? null,
        state.map.next_options
      );

    case "card_reward":
      return `${base}:${state.card_reward.cards.map((c) => `${c.id}:${c.name}`).sort().join(",")}`;

    case "shop":
      return `${base}:${state.shop.items.map((i) => `${i.index}:${i.is_stocked}:${i.can_afford}`).sort().join(",")}`;

    case "event":
      return `${base}:${state.event.event_id}:${state.event.options.map((o) => `${o.index}:${o.is_locked}`).join(",")}`;

    case "rest_site":
      return `${base}:${state.rest_site.options.map((o) => o.id).sort().join(",")}`;

    case "card_select":
      return `${base}:${state.card_select.prompt}:${state.card_select.cards.map((c) => `${c.id}:${c.name}`).sort().join(",")}`;

    case "relic_select":
      return `${base}:${state.relic_select.relics.map((r) => r.id).sort().join(",")}`;

    case "monster":
    case "elite":
    case "boss":
      return `${base}:${state.battle?.round}:${state.battle?.turn}:${
        state.battle?.enemies?.map((e) => `${e.entity_id}:${e.hp}`).sort().join(",") ?? ""
      }`;

    default:
      return `${base}:${(state as { run?: { floor?: number } }).run?.floor ?? 0}`;
  }
}
