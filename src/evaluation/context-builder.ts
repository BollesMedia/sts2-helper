import type { GameState, CombatCard } from "@/lib/types/game-state";
import { hasRun } from "@/lib/types/game-state";
import type { TrackedPlayer } from "@/features/connection/use-player-tracker";
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
    deckSize: deckCards.length,
    hpPercent:
      player.maxHp > 0 ? player.hp / player.maxHp : 1,
    gold: player.gold,
    energy: player.maxEnergy,
    relicIds: player.relics.map((r) => r.id),
    hasScaling: hasScalingSources(deckCards),
    curseCount: curseCards.length,
    deckCards: deckCards.map((c) => ({ name: c.name, description: c.description })),
    drawSources: getDrawSources(deckCards),
    scalingSources: getScalingSources(deckCards),
    curseNames: curseCards.map((c) => c.name),
    relics: player.relics.map((r) => ({ name: r.name, description: r.description })),
    potionNames: [],
  };
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
    ...ctx.deckCards.map((c) => `  - ${c.name}: ${c.description}`),
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

  if (ctx.archetypes.length > 0) {
    const archStr = ctx.archetypes
      .slice(0, 3)
      .map((a) => `${a.archetype} (${a.confidence}%)`)
      .join(", ");
    lines.push(`Detected archetypes: ${archStr}`);
  }

  return lines.join("\n");
}
