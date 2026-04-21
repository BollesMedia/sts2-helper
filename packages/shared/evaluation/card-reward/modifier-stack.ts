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

function archetypeFitModifier(
  offer: TaggedOffer,
  deckState: DeckState,
): Modifier | null {
  const committed = deckState.archetypes.committed;
  const viable = deckState.archetypes.viable;

  // Keystone for committed archetype.
  if (offer.tags.keystoneFor && offer.tags.keystoneFor === committed) {
    return {
      kind: "archetypeFit",
      delta: MODIFIER_DELTAS.archetypeFitKeystone,
      reason: `keystone for ${committed}`,
    };
  }

  // Keystone unlocks a viable archetype when uncommitted.
  if (
    offer.tags.keystoneFor &&
    !committed &&
    viable.some((v) => v.name === offer.tags.keystoneFor)
  ) {
    return {
      kind: "archetypeFit",
      delta: MODIFIER_DELTAS.archetypeFitKeystone,
      reason: `keystone unlocks ${offer.tags.keystoneFor}`,
    };
  }

  // On-archetype for committed deck.
  if (committed && offer.tags.fitsArchetypes.includes(committed)) {
    return {
      kind: "archetypeFit",
      delta: MODIFIER_DELTAS.archetypeFitOn,
      reason: `on-archetype for ${committed}`,
    };
  }

  // Off-archetype for committed deck.
  if (committed && !offer.tags.fitsArchetypes.includes(committed)) {
    return {
      kind: "archetypeFit",
      delta: MODIFIER_DELTAS.archetypeFitOff,
      reason: "off-archetype",
    };
  }

  return null;
}

function duplicateModifier(offer: TaggedOffer): Modifier | null {
  if (!offer.tags.duplicatePenalty) return null;
  return {
    kind: "duplicate",
    delta: MODIFIER_DELTAS.duplicateNonCore,
    reason: "duplicate non-core",
  };
}

function deckGapModifier(
  offer: TaggedOffer,
  deckState: DeckState,
): Modifier | null {
  const role = offer.tags.role;
  const engine = deckState.engine;
  if (role === "block" && !engine.hasBlockPayoff) {
    return { kind: "deckGap", delta: MODIFIER_DELTAS.deckGapFilled, reason: "fills block gap" };
  }
  if (role === "scaling" && !engine.hasScaling) {
    return { kind: "deckGap", delta: MODIFIER_DELTAS.deckGapFilled, reason: "fills scaling gap" };
  }
  if (role === "draw" && !engine.hasDrawPower) {
    return { kind: "deckGap", delta: MODIFIER_DELTAS.deckGapFilled, reason: "fills draw gap" };
  }
  if (role === "removal" && deckState.composition.strikes + deckState.composition.defends >= 6) {
    return { kind: "deckGap", delta: MODIFIER_DELTAS.deckGapFilled, reason: "deck thin on removal" };
  }
  return null;
}

export function computeModifiers(input: ComputeModifiersInput): ModifierBreakdown {
  const baseTier: TierLetter = input.communityTier?.consensusTierLetter ?? "C";
  const baseValue = tierToValue(baseTier);

  const candidates: (Modifier | null)[] = [
    archetypeFitModifier(input.offer, input.deckState),
    duplicateModifier(input.offer),
    deckGapModifier(input.offer, input.deckState),
  ];
  const modifiers = candidates.filter((m): m is Modifier => m !== null);

  const totalDelta = modifiers.reduce((sum, m) => sum + m.delta, 0);
  const adjustedValue = Math.max(1, Math.min(6, baseValue + totalDelta));
  const adjustedTier = valueToTier(adjustedValue);

  const top = modifiers.reduce<Modifier | null>(
    (best, m) => (best === null || Math.abs(m.delta) > Math.abs(best.delta) ? m : best),
    null,
  );
  const topReason = top?.reason ?? "base tier";

  return { baseTier, modifiers, adjustedTier, tierValue: adjustedValue, topReason };
}
