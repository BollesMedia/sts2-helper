import type { CombatCard, GameRelic } from "../types/game-state";
import type { ArchetypeScore } from "./types";

// Card keywords/tags that signal archetypes
// VERIFIED against Supabase cards table 2026-03-30
const ARCHETYPE_SIGNALS: Record<string, string[]> = {
  // Ironclad
  strength: ["demon form", "inflame", "rupture", "crimson mantle", "brand", "howl from beyond", "primal force"],
  exhaust: ["feel no pain", "dark embrace", "corruption", "burning pact", "stoke", "second wind", "fiend fire", "pyre"],
  block: ["barricade", "body slam", "impervious", "unmovable", "colossus", "shrug it off", "stone armor", "blood wall", "flame barrier"],
  vulnerable: ["cruelty", "molten fist", "taunt", "tremble", "dismantle", "stomp"],

  // Silent
  poison: ["noxious fumes", "deadly poison", "bouncing flask", "envenom", "corrosive wave", "outbreak", "snakebite"],
  shiv: ["blade dance", "cloak and dagger", "infinite blades", "accuracy", "storm of steel", "afterimage", "finisher"],
  discard: ["calculated gamble", "prepared", "acrobatics", "reflex", "expertise", "tools of the trade"],

  // Defect
  frost: ["glacier", "coolheaded", "chill", "hailstorm", "cold snap", "refract"],
  lightning: ["ball lightning", "storm", "thunder", "voltaic", "sweeping beam", "lightning rod"],
  focus: ["defragment", "biased cognition", "capacitor", "signal boost", "creative ai"],
  claw: ["claw", "all for one", "scrape", "ftl", "compile driver"],

  // Necrobinder
  reaper: ["reaper form", "deathbringer", "death's door", "death march", "reap", "drain power"],
  spirit: ["soul storm", "capture spirit", "spirit of ash", "call of the void", "seance"],
  bone: ["bone shards", "legion of bone", "reanimate", "sentry mode", "protector", "bodyguard"],

  // Regent
  star: ["seven stars", "child of the stars", "cloak of stars", "guiding star", "stardust", "gather light", "celestial might"],
  cosmic: ["big bang", "quasar", "meteor shower", "supermassive", "gamma blast", "black hole", "cosmic indifference"],
  royal: ["manifest authority", "hegemony", "conqueror", "guards!!!", "know thy place", "tyranny"],
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

  // Convert to confidence scores
  // Use max of absolute-count-based and ratio-based scoring
  // so 3+ signal cards always registers as strong commitment regardless of deck size
  const results: ArchetypeScore[] = Object.entries(scores)
    .map(([archetype, score]) => ({
      archetype,
      confidence: Math.min(100, Math.round(
        Math.max(score * 15, (score / Math.max(1, deckSize)) * 200)
      )),
    }))
    .filter((a) => a.confidence > 10)
    .sort((a, b) => b.confidence - a.confidence);

  return results;
}

// Check if deck has scaling sources (powers, passive damage, etc.)
// Verified against STS2 card DB
export function hasScalingSources(deckCards: CombatCard[]): boolean {
  const scalingKeywords = [
    "demon form", "noxious fumes", "afterimage", "defragment",
    "biased cognition", "corruption", "crimson mantle", "inflame",
    "reaper form", "necro mastery", "void form", "creative ai",
    "serpent form", "envenom", "infinite blades",
  ];

  return deckCards.some((card) => {
    const nameLower = card.name.toLowerCase();
    return scalingKeywords.some((k) => nameLower.includes(k));
  });
}

// Get draw source card names from deck
export function getDrawSources(deckCards: CombatCard[]): string[] {
  const drawKeywords = [
    "acrobatics", "backflip", "offering", "battle trance",
    "pommel strike", "shrug it off", "prepared", "adrenaline",
    "skim", "compile driver", "coolheaded", "burning pact",
    "dark embrace", "expertise",
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
    "demon form", "noxious fumes", "afterimage", "defragment",
    "biased cognition", "corruption", "crimson mantle",
    "reaper form", "void form", "creative ai", "envenom",
  ];

  return deckCards
    .filter((card) => {
      const nameLower = card.name.toLowerCase();
      return scalingKeywords.some((k) => nameLower.includes(k));
    })
    .map((card) => card.name);
}
