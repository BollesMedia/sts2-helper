import type { GameState, CombatCard } from "@/lib/types/game-state";
import { isCombatState, hasRun } from "@/lib/types/game-state";
import type { EvaluationContext } from "./types";
import {
  detectArchetypes,
  hasScalingSources,
  getDrawSources,
  getScalingSources,
} from "./archetype-detector";

/**
 * Build an EvaluationContext from the current game state.
 * Uses combat deck cards for archetype detection.
 */
export function buildEvaluationContext(
  state: GameState,
  deckCards: CombatCard[]
): EvaluationContext | null {
  const run = hasRun(state) ? state.run : null;

  // Get player info from whichever state shape has it
  const player = getPlayerInfo(state);
  if (!player) return null;

  const archetypes = detectArchetypes(deckCards, player.relics);
  const primaryArchetype =
    archetypes.length > 0 ? archetypes[0].archetype : null;

  const curseCards = deckCards.filter(
    (c) => c.name.toLowerCase().includes("curse")
  );

  return {
    character: player.character.toLowerCase(),
    archetypes,
    primaryArchetype,
    act: run?.act ?? 1,
    floor: run?.floor ?? 1,
    deckSize: deckCards.length,
    hpPercent: player.maxHp > 0 ? player.hp / player.maxHp : 1,
    gold: player.gold,
    energy: player.maxEnergy ?? 3,
    relicIds: player.relics.map((r) => r.id),
    hasScaling: hasScalingSources(deckCards),
    curseCount: curseCards.length,
    deckCardNames: deckCards.map((c) => c.name),
    drawSources: getDrawSources(deckCards),
    scalingSources: getScalingSources(deckCards),
    curseNames: curseCards.map((c) => c.name),
    relicNames: player.relics.map((r) => r.name),
    potionNames: [], // TODO: extract from battle player potions
  };
}

interface NormalizedPlayer {
  character: string;
  hp: number;
  maxHp: number;
  gold: number;
  maxEnergy: number | null;
  relics: { id: string; name: string }[];
}

function getPlayerInfo(state: GameState): NormalizedPlayer | null {
  if (isCombatState(state)) {
    const p = state.battle.player;
    return {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy: p.max_energy,
      relics: p.relics,
    };
  }

  if (state.state_type === "combat_rewards") {
    const p = state.rewards.player;
    return {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy: null,
      relics: [],
    };
  }

  if (state.state_type === "map") {
    const p = state.map.player;
    return {
      character: p.character,
      hp: p.hp,
      maxHp: p.max_hp,
      gold: p.gold,
      maxEnergy: null,
      relics: [],
    };
  }

  // card_reward doesn't include player data directly
  // We rely on deckCards from the tracker for context
  if (state.state_type === "card_reward") {
    return {
      character: "unknown",
      hp: 0,
      maxHp: 0,
      gold: 0,
      maxEnergy: null,
      relics: [],
    };
  }

  return null;
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
    `Relics: ${ctx.relicNames.length > 0 ? ctx.relicNames.join(", ") : "none"}`,
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
