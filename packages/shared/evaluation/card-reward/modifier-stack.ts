import type { DeckState } from "./deck-state";
import type { TaggedOffer } from "./format-card-facts";
import type { CommunityTierSignal } from "../community-tier";
import type { TierLetter } from "../tier-utils";
import { tierToValue, valueToTier } from "../tier-utils";

export const MODIFIER_DELTAS = {
  archetypeFitOn: 1,
  archetypeFitOff: -1,
  archetypeFitKeystone: 2,
  deckGapFilled: 1,
  duplicateNonCore: -1,
  winRatePickStrong: 1,
  winRateSkipStrong: -1,
  actThreeOffArchetype: -1,
} as const;

export const WIN_RATE_MIN_N = 20;
export const WIN_RATE_DELTA_THRESHOLD = 0.15;

export type ModifierKind =
  | "archetypeFit"
  | "deckGap"
  | "duplicate"
  | "winRateDelta"
  | "actTiming"
  | "keystoneOverride";

export interface Modifier {
  kind: ModifierKind;
  delta: number;
  reason: string;
}

export interface WinRateInput {
  pickWinRate: number | null;
  skipWinRate: number | null;
  timesPicked: number;
  timesSkipped: number;
}

export interface ModifierBreakdown {
  baseTier: TierLetter;
  modifiers: Modifier[];
  adjustedTier: TierLetter;
  tierValue: number;
  topReason: string;
}

export interface ComputeModifiersInput {
  offer: TaggedOffer;
  deckState: DeckState;
  communityTier: CommunityTierSignal | null;
  winRate: WinRateInput | null;
}

export function computeModifiers(input: ComputeModifiersInput): ModifierBreakdown {
  const baseTier: TierLetter = input.communityTier?.consensusTierLetter ?? "C";
  const baseValue = tierToValue(baseTier);
  // Real logic lands in Tasks 2–3.
  return {
    baseTier,
    modifiers: [],
    adjustedTier: baseTier,
    tierValue: baseValue,
    topReason: "base tier",
  };
}
