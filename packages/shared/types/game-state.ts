// Types for the STS2MCP mod REST API (localhost:15526)
// Based on live fixture data captured from v0.3.0

// ============================================
// Shared sub-types
// ============================================

export interface KeywordInfo {
  name: string;
  description: string;
}

export interface StatusEffect {
  id: string;
  name: string;
  amount: number;
  type: string;
  description: string;
  keywords?: KeywordInfo[];
}

export interface GameCardBase {
  name: string;
  description: string;
  keywords?: KeywordInfo[];
}

/** Card in hand/draw/discard during combat — no ID or cost info */
export interface CombatCard extends GameCardBase {}

/** Card in reward/shop/select screens — has full metadata */
export interface DetailedCard extends GameCardBase {
  index: number;
  id: string;
  type: string;
  cost: string;
  star_cost: string | null;
  rarity: string;
  is_upgraded: boolean;
}

export interface GameRelic {
  id: string;
  name: string;
  description: string;
  counter: number | null;
  keywords?: KeywordInfo[];
}

export interface GamePotion {
  id: string;
  name: string;
  description: string;
  slot: number;
  can_use_in_combat: boolean;
  target_type: string;
  keywords?: KeywordInfo[];
}

export interface EnemyIntent {
  type: string;
  label: string;
  title: string;
  description: string;
}

export interface Enemy {
  entity_id: string;
  combat_id: number;
  name: string;
  hp: number;
  max_hp: number;
  block: number;
  status: StatusEffect[];
  intents: EnemyIntent[];
}

/** Player info during combat — full detail */
export interface BattlePlayer {
  character: string;
  hp: number;
  max_hp: number;
  block: number;
  energy: number;
  max_energy: number;
  hand: CombatCard[];
  draw_pile_count: number;
  discard_pile_count: number;
  exhaust_pile_count: number;
  draw_pile: CombatCard[];
  discard_pile: CombatCard[];
  exhaust_pile: CombatCard[];
  gold: number;
  status: StatusEffect[];
  relics: GameRelic[];
  potions: GamePotion[];
  stars?: number | null;
}

/** Player summary on non-combat screens */
export interface PlayerSummary {
  character: string;
  hp: number;
  max_hp: number;
  gold: number;
  potion_slots?: number;
  open_potion_slots?: number;
}

export interface RunInfo {
  act: number;
  floor: number;
  ascension: number;
}

// ============================================
// Map types
// ============================================

export interface MapNodePosition {
  col: number;
  row: number;
  type: string;
}

export interface MapNextOption extends MapNodePosition {
  index: number;
  leads_to: MapNodePosition[];
}

export interface MapNode {
  col: number;
  row: number;
  type: string;
  children: [number, number][];
}

// ============================================
// State type discriminated union
// ============================================

export interface CombatState {
  state_type: "monster" | "elite" | "boss";
  battle: {
    round: number;
    turn: string;
    is_play_phase: boolean;
    player: BattlePlayer;
    enemies: Enemy[];
  };
  run: RunInfo;
}

export interface CardRewardState {
  state_type: "card_reward";
  card_reward: {
    cards: DetailedCard[];
    can_skip: boolean;
  };
  run: RunInfo;
}

export interface CombatRewardsState {
  state_type: "combat_rewards";
  rewards: {
    player: PlayerSummary;
    items: {
      index: number;
      type: string;
      description: string;
      gold_amount?: number;
    }[];
    can_proceed: boolean;
  };
  run: RunInfo;
}

export interface MapState {
  state_type: "map";
  map: {
    player: PlayerSummary;
    current_position: MapNodePosition | null;
    visited: MapNodePosition[];
    next_options: MapNextOption[];
    nodes: MapNode[];
    boss: { col: number; row: number };
  };
  run: RunInfo;
}

export interface ShopItem {
  index: number;
  category: "card" | "relic" | "potion" | "card_removal";
  cost: number;
  is_stocked: boolean;
  can_afford: boolean;
  on_sale?: boolean;
  // Card fields
  card_id?: string;
  card_name?: string;
  card_type?: string;
  card_rarity?: string;
  card_description?: string;
  // Relic fields
  relic_id?: string;
  relic_name?: string;
  relic_description?: string;
  // Potion fields
  potion_id?: string;
  potion_name?: string;
  potion_description?: string;
  // Shared
  keywords?: KeywordInfo[];
}

export interface ShopState {
  state_type: "shop";
  shop: {
    player: PlayerSummary;
    items: ShopItem[];
    can_proceed: boolean;
  };
  run: RunInfo;
}

export interface EventOption {
  index: number;
  title: string;
  description: string;
  is_locked: boolean;
  is_proceed: boolean;
  was_chosen: boolean;
  relic_name?: string;
  relic_description?: string;
  keywords?: KeywordInfo[];
}

export interface EventState {
  state_type: "event";
  event: {
    event_id: string;
    event_name: string;
    is_ancient: boolean;
    in_dialogue: boolean;
    body?: string | null;
    player: PlayerSummary;
    options: EventOption[];
  };
  run: RunInfo;
}

export interface RestSiteState {
  state_type: "rest_site";
  rest_site: {
    player: PlayerSummary;
    options: {
      index: number;
      id: string;
      name: string;
      description: string;
      is_enabled: boolean;
    }[];
    can_proceed: boolean;
  };
  run: RunInfo;
}

export interface CardSelectState {
  state_type: "card_select";
  card_select: {
    screen_type: string;
    prompt: string;
    player: PlayerSummary;
    cards: DetailedCard[];
    can_confirm: boolean;
    can_cancel: boolean;
  };
  run: RunInfo;
}

export interface HandSelectState {
  state_type: "hand_select";
  hand_select: {
    mode: string;
    prompt: string;
    selectable_cards: DetailedCard[];
    selected_cards: { index: number; name: string }[];
    confirm_enabled: boolean;
  };
  battle: {
    round: number;
    turn: string;
    is_play_phase: boolean;
    player: BattlePlayer;
    enemies: Enemy[];
  };
  run: RunInfo;
}

export interface RelicSelectState {
  state_type: "relic_select";
  relic_select: {
    prompt: string;
    player: PlayerSummary;
    relics: (GameRelic & { index: number })[];
    can_skip: boolean;
  };
  run: RunInfo;
}

export interface TreasureState {
  state_type: "treasure";
  treasure: {
    player: PlayerSummary;
    relics: (GameRelic & { index: number; rarity: string })[];
    can_proceed: boolean;
  };
  run: RunInfo;
}

export interface MenuState {
  state_type: "menu";
  message: string;
}

export type GameState =
  | CombatState
  | HandSelectState
  | CombatRewardsState
  | CardRewardState
  | MapState
  | ShopState
  | EventState
  | RestSiteState
  | CardSelectState
  | RelicSelectState
  | TreasureState
  | MenuState;

// ============================================
// Type guards
// ============================================

export function isCombatState(state: GameState): state is CombatState {
  return (
    state.state_type === "monster" ||
    state.state_type === "elite" ||
    state.state_type === "boss"
  );
}

export function hasRun(
  state: GameState
): state is GameState & { run: RunInfo } {
  return "run" in state;
}
