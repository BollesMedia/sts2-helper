import type { GameState, PlayerSummary, GameCard } from "@/lib/types/game-state";
import { hasPlayer } from "@/lib/types/game-state";
import type { EvaluationContext } from "./types";
import {
  detectArchetypes,
  hasScalingSources,
  getDrawSources,
  getScalingSources,
} from "./archetype-detector";

/**
 * Build an EvaluationContext from the current game state.
 * Requires a state that includes player data.
 */
export function buildEvaluationContext(
  state: GameState,
  deckCards: GameCard[]
): EvaluationContext | null {
  if (!hasPlayer(state)) return null;

  const player: PlayerSummary = state.player;
  const archetypes = detectArchetypes(deckCards, player.relics);
  const primaryArchetype =
    archetypes.length > 0 ? archetypes[0].archetype : null;

  const curseCards = deckCards.filter(
    (c) => c.type === "Curse" || c.type === "Status"
  );

  return {
    character: player.character.toLowerCase(),
    archetypes,
    primaryArchetype,
    act: estimateAct(state),
    floor: estimateFloor(state),
    deckSize: deckCards.length,
    hpPercent: player.max_hp > 0 ? player.hp / player.max_hp : 1,
    gold: player.gold,
    energy: player.max_energy,
    relicIds: player.relics.map((r) => r.id),
    hasScaling: hasScalingSources(deckCards),
    curseCount: curseCards.length,
    deckCardNames: deckCards.map((c) =>
      c.upgraded ? `${c.name}+` : c.name
    ),
    drawSources: getDrawSources(deckCards),
    scalingSources: getScalingSources(deckCards),
    curseNames: curseCards.map((c) => c.name),
    relicNames: player.relics.map((r) => r.name),
    potionNames: player.potions
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((p) => p.name),
  };
}

/**
 * Estimate current act from game state.
 * The STS2MCP API doesn't directly expose act/floor in all states,
 * so we infer from deck size and other signals as a heuristic.
 * This will be refined once we verify the exact API shape.
 */
function estimateAct(state: GameState): number {
  if (!hasPlayer(state)) return 1;
  // Heuristic: deck size and relic count grow through the run
  const relicCount = state.player.relics.length;
  if (relicCount >= 8) return 3;
  if (relicCount >= 4) return 2;
  return 1;
}

function estimateFloor(state: GameState): number {
  // If map state, we can infer from visited path length
  if (state.state_type === "map" && state.visited_path) {
    return state.visited_path.length;
  }
  // Fallback heuristic based on act
  return estimateAct(state) * 15;
}

/**
 * Build prompt context string for Claude evaluation.
 */
export function buildPromptContext(ctx: EvaluationContext): string {
  const lines: string[] = [
    `Character: ${ctx.character}`,
    `Act ${ctx.act}, Floor ${ctx.floor}`,
    `HP: ${Math.round(ctx.hpPercent * 100)}% | Energy: ${ctx.energy} | Gold: ${ctx.gold}`,
    `Deck (${ctx.deckSize} cards): ${ctx.deckCardNames.join(", ")}`,
    `  Draw sources: ${ctx.drawSources.length > 0 ? ctx.drawSources.join(", ") : "none"}`,
    `  Scaling sources: ${ctx.scalingSources.length > 0 ? ctx.scalingSources.join(", ") : "none"}`,
    `  Curses: ${ctx.curseCount} (${ctx.curseNames.length > 0 ? ctx.curseNames.join(", ") : "none"})`,
    `Relics: ${ctx.relicNames.join(", ")}`,
    `Potions: ${ctx.potionNames.length > 0 ? ctx.potionNames.join(", ") : "empty"}`,
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
