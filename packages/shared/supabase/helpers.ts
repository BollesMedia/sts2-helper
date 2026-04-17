import type { Database } from "../types/database.types";

// Row types (what you get back from queries)
export type Card = Database["public"]["Tables"]["cards"]["Row"];
export type Relic = Database["public"]["Tables"]["relics"]["Row"];
export type Potion = Database["public"]["Tables"]["potions"]["Row"];
export type Monster = Database["public"]["Tables"]["monsters"]["Row"];
export type Keyword = Database["public"]["Tables"]["keywords"]["Row"];
export type Character = Database["public"]["Tables"]["characters"]["Row"];
export type GameVersion = Database["public"]["Tables"]["game_versions"]["Row"];
export type Run = Database["public"]["Tables"]["runs"]["Row"];
export type Evaluation = Database["public"]["Tables"]["evaluations"]["Row"];
export type Choice = Database["public"]["Tables"]["choices"]["Row"];
export type Event = Database["public"]["Tables"]["events"]["Row"];
export type Enchantment = Database["public"]["Tables"]["enchantments"]["Row"];
export type Power = Database["public"]["Tables"]["powers"]["Row"];
export type Encounter = Database["public"]["Tables"]["encounters"]["Row"];
export type Orb = Database["public"]["Tables"]["orbs"]["Row"];
export type Affliction = Database["public"]["Tables"]["afflictions"]["Row"];

// Insert types (what you pass to inserts)
export type CardInsert = Database["public"]["Tables"]["cards"]["Insert"];
export type RelicInsert = Database["public"]["Tables"]["relics"]["Insert"];
export type PotionInsert = Database["public"]["Tables"]["potions"]["Insert"];
export type MonsterInsert = Database["public"]["Tables"]["monsters"]["Insert"];
export type KeywordInsert = Database["public"]["Tables"]["keywords"]["Insert"];
export type CharacterInsert = Database["public"]["Tables"]["characters"]["Insert"];
export type RunInsert = Database["public"]["Tables"]["runs"]["Insert"];
export type EvaluationInsert = Database["public"]["Tables"]["evaluations"]["Insert"];
export type ChoiceInsert = Database["public"]["Tables"]["choices"]["Insert"];
export type EventInsert = Database["public"]["Tables"]["events"]["Insert"];
export type EnchantmentInsert = Database["public"]["Tables"]["enchantments"]["Insert"];
export type PowerInsert = Database["public"]["Tables"]["powers"]["Insert"];
export type EncounterInsert = Database["public"]["Tables"]["encounters"]["Insert"];
export type OrbInsert = Database["public"]["Tables"]["orbs"]["Insert"];
export type AfflictionInsert = Database["public"]["Tables"]["afflictions"]["Insert"];

export type TierListSource = Database["public"]["Tables"]["tier_list_sources"]["Row"];
export type TierList = Database["public"]["Tables"]["tier_lists"]["Row"];
export type TierListEntry = Database["public"]["Tables"]["tier_list_entries"]["Row"];
export type CommunityTierConsensus = Database["public"]["Views"]["community_tier_consensus"]["Row"];

// Insert types
export type TierListSourceInsert = Database["public"]["Tables"]["tier_list_sources"]["Insert"];
export type TierListInsert = Database["public"]["Tables"]["tier_lists"]["Insert"];
export type TierListEntryInsert = Database["public"]["Tables"]["tier_list_entries"]["Insert"];

// View types
export type EvaluationStat = Database["public"]["Views"]["evaluation_stats"]["Row"];
export type EvaluationStatV2 = Database["public"]["Views"]["evaluation_stats_v2"]["Row"];
