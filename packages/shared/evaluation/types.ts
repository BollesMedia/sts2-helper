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
  ascension: number;
  deckSize: number;
  hpPercent: number;
  gold: number;
  energy: number;
  relicIds: string[];
  hasScaling: boolean;
  curseCount: number;
  deckCards: { name: string; description: string; type?: string; keywords?: { name: string }[] }[];
  drawSources: string[];
  scalingSources: string[];
  curseNames: string[];
  relics: { name: string; description: string }[];
  potionNames: string[];
  upgradeCount: number;
  deckMaturity: number;
  relicCount: number;
  // Multiplayer — only present in co-op (supports 2-3 players)
  isMultiplayer?: boolean;
  teammates?: {
    character: string;
    hpPercent?: number;
    relics?: { name: string; description: string }[];
  }[];
  /** @deprecated Use teammates[] instead */
  partnerCharacter?: string;
  /** @deprecated Use teammates[] instead */
  partnerHpPercent?: number;
  /** @deprecated Use teammates[] instead */
  partnerRelics?: { name: string; description: string }[];
}

export interface CardEvaluation {
  itemId: string;
  itemName: string;
  itemIndex?: number;
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
  pickSummary: string | null;
  skipRecommended: boolean;
  skipReasoning: string | null;
  spendingPlan?: string | null;
}
