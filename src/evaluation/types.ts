import type { TierLetter } from "./tier-utils";

export interface ArchetypeScore {
  archetype: string;
  confidence: number;
}

export interface EvaluationContext {
  character: string;
  archetypes: ArchetypeScore[];
  primaryArchetype: string | null;
  act: number;
  floor: number;
  deckSize: number;
  hpPercent: number;
  gold: number;
  energy: number;
  relicIds: string[];
  hasScaling: boolean;
  curseCount: number;
  deckCardNames: string[];
  drawSources: string[];
  scalingSources: string[];
  curseNames: string[];
  relicNames: string[];
  potionNames: string[];
}

export interface CardEvaluation {
  itemId: string;
  itemName: string;
  rank: number;
  tier: TierLetter;
  tierValue: number;
  synergyScore: number;
  confidence: number;
  recommendation: "strong_pick" | "good_pick" | "situational" | "skip";
  reasoning: string;
  source: "claude" | "statistical";
}

export interface CardRewardEvaluation {
  rankings: CardEvaluation[];
  skipRecommended: boolean;
  skipReasoning: string | null;
}

export interface ShopEvaluation {
  rankings: CardEvaluation[];
  cardRemovalRank: number | null;
  cardRemovalReasoning: string | null;
}

export type Recommendation = "strong_pick" | "good_pick" | "situational" | "skip";
