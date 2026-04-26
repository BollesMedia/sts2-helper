import type { GameState, CombatCard } from "../types/game-state";
import { hasRun, getPlayer } from "../types/game-state";
import type { TrackedPlayer } from "../types/tracked-player";
import type { EvaluationContext } from "./types";
import {
  detectArchetypes,
  hasScalingSources,
  getDrawSources,
  getScalingSources,
} from "./archetype-detector";
import { computeDeckMaturity } from "./deck-maturity";
import { validateEvaluationContext } from "./context-validator";

/**
 * Build an EvaluationContext from the current game state + tracked player/deck.
 */
// Starter deck sizes per character (approximate)
const STARTER_DECK_SIZE = 10;

export function buildEvaluationContext(
  state: GameState,
  deckCards: CombatCard[],
  trackedPlayer: TrackedPlayer | null
): EvaluationContext | null {
  const run = hasRun(state) ? state.run : null;
  const floor = run?.floor ?? 1;

  // Detect stale localStorage data: if we're on floor 1-2 but deck is
  // much larger than a starter deck, the data is from a previous run.
  // Use empty deck and default player to avoid polluting the evaluation.
  const isLikelyStale = floor <= 2 && deckCards.length > STARTER_DECK_SIZE + 2;
  const safeDeckCards = isLikelyStale ? [] : deckCards;

  // Player priority: tracked player > game state player > fallback defaults
  // On resume, trackedPlayer may be null but the game state always has state.player
  let player: TrackedPlayer;
  if (trackedPlayer && !isLikelyStale) {
    player = trackedPlayer;
  } else {
    // Try to extract player from the game state itself (always available on non-menu states)
    const statePlayer = getPlayer(state);
    if (statePlayer) {
      const relics = "relics" in statePlayer && Array.isArray(statePlayer.relics)
        ? statePlayer.relics.map((r) => ({
            id: "id" in r ? (r as { id: string }).id : "",
            name: r.name,
            description: r.description,
          }))
        : [];
      const potions = "potions" in statePlayer && Array.isArray(statePlayer.potions)
        ? statePlayer.potions.map((p) => ({ name: p.name, description: p.description }))
        : [];
      player = {
        character: statePlayer.character,
        hp: statePlayer.hp,
        maxHp: statePlayer.max_hp,
        gold: statePlayer.gold,
        maxEnergy: "max_energy" in statePlayer ? (statePlayer.max_energy ?? 3) : 3,
        relics,
        potions,
        potionSlotCap:
          "potion_slots" in statePlayer
            ? (statePlayer.potion_slots ?? null)
            : null,
        cardRemovalCost: null,
      };
      console.warn("[EvalContext] Using game state player as fallback (tracked player unavailable)");
    } else {
      player = {
        character: trackedPlayer?.character ?? "Unknown",
        hp: 0,
        maxHp: 1,
        gold: 0,
        maxEnergy: 3,
        relics: [],
        potions: [],
        potionSlotCap: null,
        cardRemovalCost: null,
      };
    }
  }

  if (isLikelyStale) {
    console.warn("[EvalContext] Stale deck/player data detected at floor", floor, "- using defaults");
  }

  const archetypes = detectArchetypes(safeDeckCards, player.relics);
  const primaryArchetype =
    archetypes.length > 0 ? archetypes[0].archetype : null;

  const curseCards = safeDeckCards.filter((c) =>
    c.name.toLowerCase().includes("curse")
  );

  const upgradeCount = safeDeckCards.filter((c) => c.name.includes("+")).length;
  const relicCount = player.relics.length;

  const partialCtx = {
    character: player.character.toLowerCase(),
    archetypes,
    primaryArchetype,
    act: run?.act ?? 1,
    floor,
    ascension: run?.ascension ?? 0,
    deckSize: safeDeckCards.length,
    hpPercent:
      player.maxHp > 0 ? player.hp / player.maxHp : 1,
    gold: player.gold,
    energy: player.maxEnergy,
    relicIds: player.relics.map((r) => r.id),
    hasScaling: hasScalingSources(safeDeckCards),
    curseCount: curseCards.length,
    deckCards: safeDeckCards.map((c) => ({ name: c.name, description: c.description, keywords: c.keywords })),
    drawSources: getDrawSources(safeDeckCards),
    scalingSources: getScalingSources(safeDeckCards),
    curseNames: curseCards.map((c) => c.name),
    relics: player.relics.map((r) => ({ name: r.name, description: r.description })),
    potionNames: player.potions.map((p) => p.name),
    potionSlotCap: player.potionSlotCap ?? 2,
    upgradeCount,
    relicCount,
    deckMaturity: 0,
    ...extractMultiplayerInfo(state),
  };

  partialCtx.deckMaturity = computeDeckMaturity(partialCtx);

  const validation = validateEvaluationContext(partialCtx);
  for (const w of validation.warnings) {
    console.warn(`[EvalContext] ${w.field}: ${w.message} (got: ${JSON.stringify(w.actual)})`);
  }
  for (const e of validation.errors) {
    console.error(`[EvalContext] ${e.field}: ${e.message} (got: ${JSON.stringify(e.actual)})`);
  }

  if (!validation.isValid) {
    console.error("[EvalContext] Context validation failed — skipping evaluation");
    return null;
  }

  return partialCtx;
}

/**
 * Extract teammate info from multiplayer state (supports 2-3 player co-op).
 * The multiplayer response has a top-level `players[]` array with all players.
 */
function extractMultiplayerInfo(state: GameState): {
  isMultiplayer?: boolean;
  teammates?: { character: string; hpPercent?: number; relics?: { name: string; description: string }[] }[];
  partnerCharacter?: string;
  partnerHpPercent?: number;
  partnerRelics?: { name: string; description: string }[];
} {
  if (state.game_mode !== "multiplayer") return {};

  const players = state.players as ({ character: string; hp: number; max_hp: number; is_local?: boolean; relics?: { name: string; description: string }[] })[] | undefined;
  if (!players || players.length < 2) return { isMultiplayer: true };

  const teammates = players
    .filter((p) => !p.is_local)
    .map((p) => ({
      character: p.character,
      hpPercent: p.max_hp > 0 ? p.hp / p.max_hp : 1,
      relics: p.relics?.map((r) => ({ name: r.name, description: r.description })) ?? [],
    }));

  // Backward compat: first teammate as "partner"
  const first = teammates[0];
  return {
    isMultiplayer: true,
    teammates,
    partnerCharacter: first?.character,
    partnerHpPercent: first?.hpPercent,
    partnerRelics: first?.relics,
  };
}
