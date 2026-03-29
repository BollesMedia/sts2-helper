import type { CombatCard, GameRelic } from "@sts2/shared/types/game-state";
import type { ArchetypeScore } from "./types";

// Card keywords/tags that signal archetypes
const ARCHETYPE_SIGNALS: Record<string, string[]> = {
  // Ironclad
  strength: ["strength", "demon form", "inflame", "rupture", "crimson mantle", "brand"],
  exhaust: ["exhaust", "feel no pain", "dark embrace", "corruption", "burning pact", "stoke"],
  block_ironclad: ["barricade", "body slam", "impervious", "unmovable", "colossus", "shrug it off"],

  // Silent
  poison: ["poison", "noxious fumes", "catalyst", "deadly poison", "bouncing flask", "crippling cloud"],
  shiv: ["shiv", "blade dance", "cloak and dagger", "infinite blades", "accuracy"],
  discard: ["discard", "calculated gamble", "prepared", "acrobatics", "tactician", "reflex"],

  // Defect
  orb_lightning: ["lightning", "electrodynamics", "storm", "tempest", "thunder strike"],
  orb_frost: ["frost", "glacier", "coolheaded", "blizzard", "chill"],
  orb_dark: ["dark", "doom and gloom", "darkness"],
  focus: ["focus", "defragment", "consume", "biased cognition", "inserter"],

  // Necrobinder
  minion: ["summon", "osty", "bind", "bone", "animate"],
  ritual: ["ritual", "sacrifice", "offering"],

  // Regent
  star: ["star", "stance", "retain", "divinity", "mantra"],
};

// Relics that strongly signal archetypes
const RELIC_ARCHETYPE_SIGNALS: Record<string, { archetype: string; weight: number }> = {
  SHURIKEN: { archetype: "shiv", weight: 3 },
  KUNAI: { archetype: "shiv", weight: 3 },
  DEAD_BRANCH: { archetype: "exhaust", weight: 4 },
  SNECKO_EYE: { archetype: "high_cost", weight: 4 },
  TWISTED_FUNNEL: { archetype: "poison", weight: 3 },
  THE_SPECIMEN: { archetype: "poison", weight: 2 },
  MARK_OF_THE_BLOOM: { archetype: "no_heal", weight: 2 },
};

export function detectArchetypes(
  deckCards: CombatCard[],
  relics: { id: string; name: string }[]
): ArchetypeScore[] {
  const scores: Record<string, number> = {};
  const deckSize = deckCards.length;

  // Score cards against archetype signals
  for (const card of deckCards) {
    const cardNameLower = card.name.toLowerCase();
    const cardKeywords = (card.keywords ?? []).map((k) => k.name.toLowerCase());

    for (const [archetype, signals] of Object.entries(ARCHETYPE_SIGNALS)) {
      for (const signal of signals) {
        if (
          cardNameLower.includes(signal) ||
          cardKeywords.some((k) => k.includes(signal))
        ) {
          scores[archetype] = (scores[archetype] ?? 0) + 1;
          break;
        }
      }
    }
  }

  // Boost from relics
  for (const relic of relics) {
    const relicId = relic.id.toUpperCase();
    const signal = RELIC_ARCHETYPE_SIGNALS[relicId];
    if (signal) {
      scores[signal.archetype] =
        (scores[signal.archetype] ?? 0) + signal.weight;
    }
  }

  // Convert to confidence scores (relative to deck size)
  const results: ArchetypeScore[] = Object.entries(scores)
    .map(([archetype, score]) => ({
      archetype,
      confidence: Math.min(100, Math.round((score / Math.max(1, deckSize)) * 200)),
    }))
    .filter((a) => a.confidence > 10)
    .sort((a, b) => b.confidence - a.confidence);

  return results;
}

// Check if deck has scaling sources (powers, passive damage, etc.)
export function hasScalingSources(deckCards: CombatCard[]): boolean {
  const scalingKeywords = [
    "demon form", "noxious fumes", "afterimage", "thousand cuts",
    "electrodynamics", "defragment", "focus", "biased cognition",
    "limit break", "strength", "deva form",
  ];

  return deckCards.some((card) => {
    const nameLower = card.name.toLowerCase();
    return scalingKeywords.some((k) => nameLower.includes(k));
  });
}

// Get draw source card names from deck
export function getDrawSources(deckCards: CombatCard[]): string[] {
  const drawKeywords = [
    "draw", "acrobatics", "backflip", "offering", "battle trance",
    "pommel strike", "shrug it off", "prepared", "adrenaline",
    "skim", "compile driver", "coolheaded",
  ];

  return deckCards
    .filter((card) => {
      const nameLower = card.name.toLowerCase();
      return drawKeywords.some((k) => nameLower.includes(k));
    })
    .map((card) => card.name);
}

// Get scaling source card names from deck
export function getScalingSources(deckCards: CombatCard[]): string[] {
  const scalingKeywords = [
    "demon form", "noxious fumes", "afterimage", "thousand cuts",
    "electrodynamics", "defragment", "biased cognition",
    "limit break", "deva form", "corruption",
  ];

  return deckCards
    .filter((card) => {
      const nameLower = card.name.toLowerCase();
      return scalingKeywords.some((k) => nameLower.includes(k));
    })
    .map((card) => card.name);
}
