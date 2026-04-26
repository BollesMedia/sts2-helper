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
  /**
   * Total potion-slot cap reported by the mod. STS2 baseline is 2;
   * expansion relics raise it. `null` when the mod hasn't reported it
   * (older mod versions). The shop scorer falls back to 2 in that case.
   */
  potionSlotCap: number | null;
  cardRemovalCost: number | null;
}
