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

/** Player summary — v0.3.2 includes block/status/relics/potions at top level */
export interface PlayerSummary {
  character: string;
  hp: number;
  max_hp: number;
  gold: number;
  block?: number;
  status?: StatusEffect[];
  relics?: GameRelic[];
  potions?: GamePotion[];
  potion_slots?: number;
  open_potion_slots?: number;
}

/** Top-level fields present on all game states (v0.3.2+) */
export interface BaseFields {
  /** v0.3.2: player at top level. In combat, this is BattlePlayer; otherwise PlayerSummary. */
  player?: BattlePlayer | PlayerSummary;
}

export interface RunInfo {
  act: number;
  floor: number;
  ascension: number;
}

/** Optional multiplayer fields present on every state when in co-op */
export interface MultiplayerFields {
  game_mode?: "singleplayer" | "multiplayer";
  player_count?: number;
  local_player_slot?: number;
  /** Summary of all players (always present in multiplayer) */
  players?: { character: string; hp: number; max_hp: number; is_local?: boolean; gold?: number }[];
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
  /** v0.3.2: player at top level (BattlePlayer in combat) */
  player?: BattlePlayer;
  battle: {
    round: number;
    turn: string;
    is_play_phase: boolean;
    /** @deprecated v0.3.0 compat — use top-level state.player instead */
    player?: BattlePlayer;
    /** Multiplayer: array of all players. Local player has is_local: true. */
    players?: (BattlePlayer & { is_local?: boolean })[];
    enemies: Enemy[];
  };
  run: RunInfo;
}

export interface CardRewardState {
  state_type: "card_reward";
  player?: PlayerSummary;
  card_reward: {
    cards: DetailedCard[];
    can_skip: boolean;
  };
  run: RunInfo;
}

export interface CombatRewardsState {
  state_type: "combat_rewards";
  player?: PlayerSummary;
  rewards: {
    /** @deprecated v0.3.0 compat */
    player?: PlayerSummary;
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
  /** v0.3.2: player at top level */
  player?: PlayerSummary;
  map: {
    /** @deprecated v0.3.0 compat */
    player?: PlayerSummary;
    current_position: MapNodePosition | null;
    visited: MapNodePosition[];
    next_options: MapNextOption[];
    nodes: MapNode[];
    boss: { col: number; row: number };
    /** Multiplayer voting state */
    votes?: { player: string; is_local: boolean; voted: boolean }[];
    all_voted?: boolean;
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
  player?: PlayerSummary;
  shop: {
    /** @deprecated v0.3.0 compat */
    player?: PlayerSummary;
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
  player?: PlayerSummary;
  event: {
    event_id: string;
    event_name: string;
    is_ancient: boolean;
    in_dialogue: boolean;
    body?: string | null;
    /** @deprecated v0.3.0 compat */
    player?: PlayerSummary;
    options: EventOption[];
  };
  run: RunInfo;
}

export interface RestSiteState {
  state_type: "rest_site";
  player?: PlayerSummary;
  rest_site: {
    /** @deprecated v0.3.0 compat */
    player?: PlayerSummary;
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
  player?: PlayerSummary;
  card_select: {
    screen_type: string;
    prompt: string;
    /** @deprecated v0.3.0 compat */
    player?: PlayerSummary;
    cards: DetailedCard[];
    can_confirm: boolean;
    can_cancel: boolean;
  };
  run: RunInfo;
}

export interface HandSelectState {
  state_type: "hand_select";
  player?: BattlePlayer;
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
    /** @deprecated v0.3.0 compat */
    player?: BattlePlayer;
    players?: (BattlePlayer & { is_local?: boolean })[];
    enemies: Enemy[];
  };
  run: RunInfo;
}

export interface RelicSelectState {
  state_type: "relic_select";
  player?: PlayerSummary;
  relic_select: {
    prompt: string;
    /** @deprecated v0.3.0 compat */
    player?: PlayerSummary;
    relics: (GameRelic & { index: number })[];
    can_skip: boolean;
  };
  run: RunInfo;
}

export interface TreasureState {
  state_type: "treasure";
  player?: PlayerSummary;
  treasure: {
    /** @deprecated v0.3.0 compat */
    player?: PlayerSummary;
    relics: (GameRelic & { index: number; rarity: string })[];
    can_proceed: boolean;
  };
  run: RunInfo;
}

export interface MenuState {
  state_type: "menu";
  message: string;
}

export type GameState = (
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
  | MenuState
) & MultiplayerFields & BaseFields;

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

/**
 * Get the player data from any game state.
 * v0.3.2: player is at top level (state.player).
 * v0.3.0 compat: falls back to container-nested player.
 * Multiplayer: finds local player in battle.players[].
 *
 * Overloaded: returns BattlePlayer for combat states, PlayerSummary otherwise.
 */
export function getPlayer(state: CombatState): BattlePlayer | undefined;
export function getPlayer(state: HandSelectState): BattlePlayer | undefined;
export function getPlayer(state: ShopState): PlayerSummary | undefined;
export function getPlayer(state: RestSiteState): PlayerSummary | undefined;
export function getPlayer(state: MapState): PlayerSummary | undefined;
export function getPlayer(state: GameState): (BattlePlayer | PlayerSummary) | undefined;
export function getPlayer(state: GameState): (BattlePlayer | PlayerSummary) | undefined {
  // v0.3.2 singleplayer: top-level player
  if (state.player) return state.player;

  // Multiplayer: find local player in top-level players[] array
  if (state.players?.length) {
    const localSlot = state.local_player_slot;
    if (localSlot != null && state.players[localSlot]) {
      return state.players[localSlot] as unknown as PlayerSummary;
    }
    const local = state.players.find((p) => p.is_local);
    if (local) return local as unknown as PlayerSummary;
    return state.players[0] as unknown as PlayerSummary;
  }

  // Multiplayer combat: find local player in battle.players[]
  if ("battle" in state) {
    const battle = (state as CombatState | HandSelectState).battle;
    if (battle?.players?.length) {
      const localSlot = state.local_player_slot;
      if (localSlot != null && battle.players[localSlot]) {
        return battle.players[localSlot];
      }
      return battle.players.find((p) => p.is_local) ?? battle.players[0];
    }
    // v0.3.0 compat
    if (battle?.player) return battle.player;
  }

  // v0.3.0 compat: nested player in non-combat containers
  // Use Record access to avoid discriminated union narrowing issues
  const s = state as unknown as Record<string, { player?: PlayerSummary | BattlePlayer } | undefined>;
  for (const key of ["map", "shop", "event", "rest_site", "rewards", "card_select", "relic_select", "treasure"]) {
    if (s[key]?.player) return s[key]!.player;
  }

  return undefined;
}

/** @deprecated Use getPlayer() instead */
export const getLocalCombatPlayer = getPlayer;
