import type { GameState, CombatCard } from "@sts2/shared/types/game-state";
import { hasRun } from "@sts2/shared/types/game-state";
import type { TrackedPlayer } from "@sts2/shared/features/connection/use-player-tracker";
import type { EvaluationContext } from "./types";
import {
  detectArchetypes,
  hasScalingSources,
  getDrawSources,
  getScalingSources,
} from "./archetype-detector";

/**
 * Build an EvaluationContext from the current game state + tracked player/deck.
 */
export function buildEvaluationContext(
  state: GameState,
  deckCards: CombatCard[],
  trackedPlayer: TrackedPlayer | null
): EvaluationContext | null {
  const run = hasRun(state) ? state.run : null;

  const player = trackedPlayer ?? {
    character: "Unknown",
    hp: 0,
    maxHp: 1,
    gold: 0,
    maxEnergy: 3,
    relics: [],
  };

  const archetypes = detectArchetypes(deckCards, player.relics);
  const primaryArchetype =
    archetypes.length > 0 ? archetypes[0].archetype : null;

  const curseCards = deckCards.filter((c) =>
    c.name.toLowerCase().includes("curse")
  );

  return {
    character: player.character.toLowerCase(),
    archetypes,
    primaryArchetype,
    act: run?.act ?? 1,
    floor: run?.floor ?? 1,
    ascension: run?.ascension ?? 0,
    deckSize: deckCards.length,
    hpPercent:
      player.maxHp > 0 ? player.hp / player.maxHp : 1,
    gold: player.gold,
    energy: player.maxEnergy,
    relicIds: player.relics.map((r) => r.id),
    hasScaling: hasScalingSources(deckCards),
    curseCount: curseCards.length,
    deckCards: deckCards.map((c) => ({ name: c.name, description: c.description, keywords: c.keywords })),
    drawSources: getDrawSources(deckCards),
    scalingSources: getScalingSources(deckCards),
    curseNames: curseCards.map((c) => c.name),
    relics: player.relics.map((r) => ({ name: r.name, description: r.description })),
    potionNames: [],
  };
}

// Ascension modifiers — cumulative (A6 means all of A1-A6 apply)
const ASCENSION_MODIFIERS: Record<number, string> = {
  1: "Elites spawn more often",
  2: "Ancients only heal 80% of missing HP",
  3: "Enemies and Treasure Chests drop 25% less Gold",
  4: "Start with 1 less potion slot",
  5: "Start Cursed (Ascender's Bane)",
  6: "Less Rest Sites",
  7: "Rare and Upgraded cards appear less often",
  8: "All enemies are harder to kill",
  9: "All enemies have deadlier attacks",
  10: "Fight two bosses at the end of Act 3",
};

function getAscensionSummary(level: number): string | null {
  if (level <= 0) return null;
  const active = Object.entries(ASCENSION_MODIFIERS)
    .filter(([k]) => Number(k) <= level)
    .map(([k, v]) => `A${k}: ${v}`);
  return `Ascension ${level} (${active.length} modifiers active):\n${active.map((a) => `  - ${a}`).join("\n")}`;
}

/**
 * Build prompt context string for Claude evaluation.
 */
export function buildPromptContext(ctx: EvaluationContext): string {
  const lines: string[] = [
    `Character: ${ctx.character}`,
    `Act ${ctx.act}, Floor ${ctx.floor}`,
    `HP: ${Math.round(ctx.hpPercent * 100)}% | Energy: ${ctx.energy} | Gold: ${ctx.gold}`,
    `Deck (${ctx.deckSize} cards):`,
    ...ctx.deckCards.map((c) => {
      const tags: string[] = [];
      const kwNames = (c.keywords ?? []).map((k) => k.name.toLowerCase());
      if (kwNames.includes("eternal")) tags.push("ETERNAL - cannot be removed or transformed");
      if (kwNames.includes("innate")) tags.push("Innate");
      if (kwNames.includes("retain")) tags.push("Retain");
      if (kwNames.includes("exhaust")) tags.push("Exhaust");
      if (kwNames.includes("ethereal")) tags.push("Ethereal");
      const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
      return `  - ${c.name}: ${c.description}${tagStr}`;
    }),
    `  Draw sources: ${ctx.drawSources.length > 0 ? ctx.drawSources.join(", ") : "none"}`,
    `  Scaling sources: ${ctx.scalingSources.length > 0 ? ctx.scalingSources.join(", ") : "none"}`,
    `  Curses: ${ctx.curseCount} (${ctx.curseNames.length > 0 ? ctx.curseNames.join(", ") : "none"})`,
    `Relics:`,
    ...(ctx.relics.length > 0
      ? ctx.relics.map((r) => `  - ${r.name}: ${r.description}`)
      : ["  none"]),
    `Potions: ${ctx.potionNames.length > 0 ? ctx.potionNames.join(", ") : "empty"}`,
    `Available gold: ${ctx.gold}g`,
  ];

  const ascSummary = getAscensionSummary(ctx.ascension);
  if (ascSummary) {
    lines.push(ascSummary);
  }

  if (ctx.archetypes.length > 0) {
    const archStr = ctx.archetypes
      .slice(0, 3)
      .map((a) => `${a.archetype} (${a.confidence}%)`)
      .join(", ");
    lines.push(`Detected archetypes: ${archStr}`);
  }

  return lines.join("\n");
}
