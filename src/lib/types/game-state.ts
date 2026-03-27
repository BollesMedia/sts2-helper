// Types for the STS2MCP mod REST API (localhost:15526)
// Source of truth: https://github.com/Gennadiyev/STS2MCP/blob/main/docs/raw_api.md

// ============================================
// Shared sub-types
// ============================================

export interface StatusEffect {
  id: string;
  name: string;
  amount: number;
  description?: string;
  keywords?: string[];
}

export interface GameCard {
  index: number;
  id: string;
  name: string;
  type: string;
  cost: number;
  star_cost?: number | null;
  description: string;
  rarity?: string;
  upgraded: boolean;
  keywords?: string[];
  target?: string;
}

export interface GameRelic {
  id: string;
  name: string;
  description: string;
  keywords?: string[];
}

export interface GamePotion {
  slot: number;
  id: string;
  name: string;
  description: string;
  keywords?: string[];
}

export interface EnemyIntent {
  title: string;
  label: string;
  description: string;
}

export interface Enemy {
  entity_id: string;
  name: string;
  hp: number;
  max_hp: number;
  block: number;
  status: StatusEffect[];
  intents: EnemyIntent[];
}

export interface Orb {
  id: string;
  name: string;
  passive_amount: number;
  evoke_amount: number;
}

export interface PlayerSummary {
  character: string;
  hp: number;
  max_hp: number;
  gold: number;
  block: number;
  energy: number;
  max_energy: number;
  stars?: number | null;
  relics: GameRelic[];
  potions: (GamePotion | null)[];
  status: StatusEffect[];
}

export interface MapNode {
  x: number;
  y: number;
  type: string;
  children: { x: number; y: number }[];
}

export interface MapNextOption {
  index: number;
  x: number;
  y: number;
  type: string;
  children_types: string[];
}

// ============================================
// State type discriminated union
// ============================================

export interface CombatState {
  state_type: "monster" | "elite" | "boss";
  game_mode: "singleplayer";
  player: PlayerSummary;
  hand: GameCard[];
  draw_pile_count: number;
  discard_pile_count: number;
  exhaust_pile_count: number;
  enemies: Enemy[];
  orbs?: Orb[];
}

export interface HandSelectState {
  state_type: "hand_select";
  game_mode: "singleplayer";
  mode: "simple_select" | "upgrade_select";
  prompt: string;
  selectable_cards: GameCard[];
  selected_cards: { index: number; name: string }[];
  confirm_enabled: boolean;
  player: PlayerSummary;
  enemies: Enemy[];
}

export interface CombatRewardsState {
  state_type: "combat_rewards";
  game_mode: "singleplayer";
  player: PlayerSummary;
  rewards: {
    index: number;
    type: string;
    description: string;
    [key: string]: unknown;
  }[];
  can_proceed: boolean;
}

export interface CardRewardState {
  state_type: "card_reward";
  game_mode: "singleplayer";
  cards: GameCard[];
  can_skip: boolean;
}

export interface MapState {
  state_type: "map";
  game_mode: "singleplayer";
  player: PlayerSummary;
  current_position: { x: number; y: number } | null;
  visited_path: { x: number; y: number }[];
  next_options: MapNextOption[];
  map_dag: MapNode[];
}

export interface ShopItem {
  index: number;
  id: string;
  name: string;
  description?: string;
  cost: number;
  stocked: boolean;
  affordable: boolean;
  on_sale?: boolean;
  keywords?: string[];
  type?: string;
  rarity?: string;
  energy_cost?: number;
}

export interface ShopState {
  state_type: "shop";
  game_mode: "singleplayer";
  player: PlayerSummary;
  cards: ShopItem[];
  relics: ShopItem[];
  potions: ShopItem[];
  card_removal: { cost: number; affordable: boolean } | null;
}

export interface EventOption {
  index: number;
  title: string;
  description: string;
  locked: boolean;
  is_proceed: boolean;
  chosen: boolean;
  relic?: GameRelic;
  keywords?: string[];
}

export interface EventState {
  state_type: "event";
  game_mode: "singleplayer";
  event_id: string;
  event_name: string;
  is_ancient: boolean;
  in_dialogue: boolean;
  player: PlayerSummary;
  options: EventOption[];
}

export interface RestSiteState {
  state_type: "rest_site";
  game_mode: "singleplayer";
  player: PlayerSummary;
  options: {
    index: number;
    id: string;
    name: string;
    description: string;
    enabled: boolean;
  }[];
  can_proceed: boolean;
}

export interface CardSelectState {
  state_type: "card_select";
  game_mode: "singleplayer";
  screen_type: "transform" | "upgrade" | "select" | "simple_select" | "choose";
  prompt: string;
  player: PlayerSummary;
  cards: GameCard[];
  can_confirm: boolean;
  can_cancel: boolean;
}

export interface RelicSelectState {
  state_type: "relic_select";
  game_mode: "singleplayer";
  prompt: string;
  player: PlayerSummary;
  relics: (GameRelic & { index: number })[];
  can_skip: boolean;
}

export interface TreasureState {
  state_type: "treasure";
  game_mode: "singleplayer";
  player: PlayerSummary;
  relics: (GameRelic & { index: number; rarity: string })[];
  can_proceed: boolean;
}

export interface OverlayState {
  state_type: "overlay";
  game_mode: "singleplayer";
  [key: string]: unknown;
}

export interface MenuState {
  state_type: "menu";
  game_mode: "singleplayer";
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
  | OverlayState
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

export function hasPlayer(
  state: GameState
): state is GameState & { player: PlayerSummary } {
  return "player" in state && state.player !== undefined;
}
