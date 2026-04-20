import type { CombatCard, GameRelic } from "../../types/game-state";
import {
  countArchetypeSupport,
  hasScalingSources,
} from "../archetype-detector";
import cardRolesData from "./card-roles.json";

const CARD_ROLES: Record<string, {
  name: string;
  character: string;
  role: string;
  keystoneFor: string | null;
  fitsArchetypes: string[];
  maxCopies: number;
}> = (cardRolesData as { cards: Record<string, {
  name: string;
  character: string;
  role: string;
  keystoneFor: string | null;
  fitsArchetypes: string[];
  maxCopies: number;
}> }).cards;

export type SizeVerdict = "too_thin" | "healthy" | "bloated";

export interface ArchetypeSignal {
  name: string;
  supportCount: number;
  hasKeystone: boolean;
}

export interface DeckState {
  size: number;
  act: 1 | 2 | 3;
  floor: number;
  ascension: number;
  composition: {
    strikes: number;
    defends: number;
    deadCards: number;
    upgraded: number;
    upgradeRatio: number;
  };
  sizeVerdict: SizeVerdict;
  archetypes: {
    viable: ArchetypeSignal[];
    committed: string | null;
    orphaned: { archetype: string; cards: string[] }[];
  };
  engine: {
    hasScaling: boolean;
    hasBlockPayoff: boolean;
    hasRemovalMomentum: number;
    hasDrawPower: boolean;
  };
  hp: { current: number; max: number; ratio: number };
  upcoming: {
    nextNodeType:
      | "elite" | "monster" | "boss" | "rest" | "shop"
      | "event" | "treasure" | "unknown" | null;
    bossesPossible: string[];
    dangerousMatchups: string[];
  };
}

export interface DeckStateInputs {
  deck: CombatCard[];
  relics: GameRelic[];
  act: 1 | 2 | 3;
  floor: number;
  ascension: number;
  hp: { current: number; max: number };
  upcomingNodeType?: DeckState["upcoming"]["nextNodeType"];
  bossesPossible?: string[];
  dangerousMatchups?: string[];
}

const SIZE_IDEAL: Record<1 | 2 | 3, [min: number, max: number]> = {
  1: [10, 14],
  2: [14, 20],
  3: [18, 24],
};

function sizeVerdict(size: number, act: 1 | 2 | 3): SizeVerdict {
  const [min, max] = SIZE_IDEAL[act];
  if (size <= min) return "too_thin";
  if (size > max + 4) return "bloated";
  return "healthy";
}

function baseName(card: { name: string }): string {
  return card.name.replace(/\+$/, "").toLowerCase();
}

function isUpgraded(card: { name: string }): boolean {
  return /\+$/.test(card.name);
}

function countBasics(deck: { name: string }[]): { strikes: number; defends: number } {
  let strikes = 0;
  let defends = 0;
  for (const c of deck) {
    const b = baseName(c);
    if (b === "strike") strikes++;
    if (b === "defend") defends++;
  }
  return { strikes, defends };
}

export function computeDeckState(inputs: DeckStateInputs): DeckState {
  const {
    deck, act, floor, ascension, hp,
    upcomingNodeType = null, bossesPossible = [], dangerousMatchups = [],
  } = inputs;

  const size = deck.length;
  const { strikes, defends } = countBasics(deck);
  const upgraded = deck.filter(isUpgraded).length;
  const upgradeRatio = size === 0 ? 0 : upgraded / size;

  // Engine status — hasScaling piggy-backs on existing detector.
  const hasScaling = hasScalingSources(deck);
  const hasBlockPayoff = deck.some((c) => {
    const b = baseName(c);
    return b === "barricade" || b === "body slam" || b === "entrench";
  });
  const hasDrawPower = deck.some((c) => {
    const b = baseName(c);
    return ["pommel strike", "battle trance", "offering", "skim", "dark embrace"].includes(b);
  });
  const hasRemovalMomentum = 0; // tightened in a later step when smith context is threaded through

  // Archetype signals from raw support counts.
  const rawCounts = countArchetypeSupport(deck);
  const viable: ArchetypeSignal[] = Object.entries(rawCounts)
    .filter(([, count]) => count >= 2)
    .map(([name, supportCount]) => {
      const hasKeystone = deck.some((c) => {
        const entry = CARD_ROLES[baseName(c)];
        return entry?.keystoneFor === name;
      });
      return { name, supportCount, hasKeystone };
    })
    .sort((a, b) => b.supportCount - a.supportCount);

  const committed = viable.find((a) => a.hasKeystone)?.name ?? null;

  const orphaned = viable
    .filter((a) => !a.hasKeystone && a.name !== committed)
    .map((a) => ({
      archetype: a.name,
      cards: deck
        .filter((c) => CARD_ROLES[baseName(c)]?.fitsArchetypes.includes(a.name))
        .map((c) => c.name),
    }));

  // Dead-card count: basics + scaling cards the deck can't pay off in Act 1.
  const deadBasics = strikes + defends;
  const deadCards = deadBasics; // act-1-specific scaling deadness surfaces at tag-time per card

  return {
    size,
    act,
    floor,
    ascension,
    composition: {
      strikes,
      defends,
      deadCards,
      upgraded,
      upgradeRatio,
    },
    sizeVerdict: sizeVerdict(size, act),
    archetypes: { viable, committed, orphaned },
    engine: {
      hasScaling,
      hasBlockPayoff,
      hasRemovalMomentum,
      hasDrawPower,
    },
    hp: {
      current: hp.current,
      max: hp.max,
      ratio: hp.max === 0 ? 0 : hp.current / hp.max,
    },
    upcoming: {
      nextNodeType: upcomingNodeType,
      bossesPossible,
      dangerousMatchups,
    },
  };
}
