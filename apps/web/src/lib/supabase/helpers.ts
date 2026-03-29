import type { Database } from "@sts2/shared/types/database.types";

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

// View types
export type EvaluationStat = Database["public"]["Views"]["evaluation_stats"]["Row"];
