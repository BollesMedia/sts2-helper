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
  /**
   * Total potion-slot cap for the run. STS2 baseline is 2; expansion relics
   * raise it. Used by shop scorer to decide when potions are F-tier (full)
   * vs B-tier (open). Defaults to 2 when the mod hasn't reported it.
   */
  potionSlotCap: number;
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
  skipRecommended: boolean;
  skipReasoning: string | null;
  spendingPlan?: string | null;
  coaching?: {
    reasoning: { deckState: string; commitment: string };
    headline: string;
    confidence: number;
    keyTradeoffs: { position: number; upside: string; downside: string }[];
    teachingCallouts: { pattern: string; explanation: string }[];
  };
  /**
   * Phase-5 scorer telemetry. Full ranking of every offered item the scorer
   * evaluated, including the modifier breakdown. Used for debugging ("why
   * did the scorer pick this card?") and phase-6 calibration. Nested
   * `scoreBreakdown` uses `Record<string, number>` so adding new modifier
   * kinds doesn't break the wire.
   */
  compliance?: {
    scoredOffers?: {
      itemId: string;
      rank: number;
      tier: string;
      tierValue: number;
      breakdown: {
        baseTier: string;
        modifiers: { kind: string; delta: number; reason: string }[];
        adjustedTier: string;
        tierValue: number;
        topReason: string;
      };
    }[];
  };
}
