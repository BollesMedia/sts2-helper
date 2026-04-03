/**
 * Player state tracked across game state transitions.
 * Populated from BattlePlayer (combat) or PlayerSummary (non-combat).
 */
export interface TrackedPlayer {
  character: string;
  hp: number;
  maxHp: number;
  gold: number;
  maxEnergy: number;
  relics: { id: string; name: string; description: string }[];
  potions: { name: string; description: string }[];
  cardRemovalCost: number | null;
}
