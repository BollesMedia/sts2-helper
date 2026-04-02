"use client";

import { useRef } from "react";
import type { GameState, CombatCard, CombatState, MultiplayerFields } from "../../types/game-state";
import { isCombatState, hasRun, getLocalCombatPlayer } from "../../types/game-state";
import { createClient } from "../../supabase/client";
import { initStarterDecks, getStarterDeck } from "../../supabase/starter-decks";

const STORAGE_KEY = "sts2-deck";
const VALID_CARDS_KEY = "sts2-valid-cards";

function loadFromStorage(): CombatCard[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[localStorage]", e);
    }
    return [];
  }
}

function saveToStorage(cards: CombatCard[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[localStorage]", e);
    }
  }
}

/**
 * Load valid card names synchronously from localStorage,
 * and trigger an async refresh from Supabase.
 */
let validCardNames: Set<string> | null = null;
let validCardsLoading = false;

function initValidCardNames(): Set<string> | null {
  // Try sync load from localStorage first
  if (validCardNames) return validCardNames;

  if (typeof window !== "undefined") {
    try {
      const cached = localStorage.getItem(VALID_CARDS_KEY);
      if (cached) {
        validCardNames = new Set(JSON.parse(cached) as string[]);
        return validCardNames;
      }
    } catch (e) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[localStorage]", e);
      }
    }
  }

  // Trigger async load if not cached
  if (!validCardsLoading) {
    validCardsLoading = true;
    const supabase = createClient();
    supabase
      .from("cards")
      .select("name, type")
      .neq("type", "Status")
      .then(({ data }) => {
        const names = new Set(
          (data ?? []).map((c) => c.name.toLowerCase())
        );
        // Add upgraded variants
        for (const name of [...names]) {
          names.add(`${name}+`);
        }
        validCardNames = names;
        validCardsLoading = false;

        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(VALID_CARDS_KEY, JSON.stringify([...names]));
          } catch (e) {
            if (process.env.NODE_ENV === "development") {
              console.warn("[cache]", e);
            }
          }
        }
      });
  }

  return null;
}

function isPlayerCard(card: CombatCard): boolean {
  // If valid names haven't loaded, reject unknown cards conservatively
  // by checking if the name looks like a status card
  if (!validCardNames) {
    const lowerName = card.name.toLowerCase();
    const knownStatus = [
      "wound", "burn", "dazed", "slimed", "void", "debris",
      "beckon", "disintegration", "frantic escape", "infection",
      "mind rot", "sloth", "soot", "toxic", "waste away",
    ];
    return !knownStatus.includes(lowerName);
  }
  return validCardNames.has(card.name.toLowerCase());
}

/**
 * Maintains a running deck list that stays accurate between combats
 * and persists through page reloads via localStorage.
 *
 * Filters out enemy-generated Status cards by checking against the
 * known card list from Supabase (loaded once, cached in localStorage).
 */
export function useDeckTracker(gameState: GameState | null): CombatCard[] {
  const deckCards = useRef<CombatCard[]>([]);
  const prevStateType = useRef<string | null>(null);
  const initialized = useRef(false);

  if (!initialized.current) {
    initialized.current = true;
    deckCards.current = loadFromStorage();
    initValidCardNames();
    initStarterDecks();
  }

  if (!gameState) return deckCards.current;

  const currentType = gameState.state_type;
  const prevType = prevStateType.current;
  prevStateType.current = currentType;

  // ─── COMBAT: Ground truth sync (round 1 only) ───
  // Round 1 is the cleanest snapshot — no exhaust, no enemy-added cards yet
  const combatPlayer = isCombatState(gameState) ? getLocalCombatPlayer(gameState) : null;
  if (isCombatState(gameState) && combatPlayer && gameState.battle?.round <= 1) {
    const p = combatPlayer;
    const allPiles = [
      ...(p.hand ?? []),
      ...(p.draw_pile ?? []),
      ...(p.discard_pile ?? []),
      ...(p.exhaust_pile ?? []),
    ];
    const combatDeck = allPiles.filter(isPlayerCard);

    // Only update if we got a meaningful deck
    if (combatDeck.length > 0) {
      const newNames = combatDeck.map((c) => c.name).sort().join(",");
      const oldNames = deckCards.current.map((c) => c.name).sort().join(",");

      if (newNames !== oldNames) {
        console.log("[DeckTracker] Deck updated:", {
          from: deckCards.current.length,
          to: combatDeck.length,
          filtered: allPiles.length - combatDeck.length,
          round: gameState.battle.round,
        });
        deckCards.current = combatDeck;
        saveToStorage(combatDeck);
      }
    }
  }

  // ─── FALLBACK: sync from any combat/hand_select round if deck is empty ───
  // Covers cases where the app started mid-run (missed round 1) or localStorage was cleared.
  // A slightly "dirty" snapshot (with possible exhaust/temp cards) is far better than no deck context.
  if (deckCards.current.length === 0) {
    const fallbackPlayer =
      (isCombatState(gameState) ? combatPlayer : null) ??
      (gameState.state_type === "hand_select" && "battle" in gameState
        ? getLocalCombatPlayer(gameState as CombatState & MultiplayerFields)
        : null);

    if (fallbackPlayer) {
      const allPiles = [
        ...(fallbackPlayer.hand ?? []),
        ...(fallbackPlayer.draw_pile ?? []),
        ...(fallbackPlayer.discard_pile ?? []),
        ...(fallbackPlayer.exhaust_pile ?? []),
      ];
      const combatDeck = allPiles.filter(isPlayerCard);
      if (combatDeck.length > 0) {
        console.log("[DeckTracker] Mid-combat fallback sync:", {
          cards: combatDeck.length,
          stateType: currentType,
        });
        deckCards.current = combatDeck;
        saveToStorage(combatDeck);
      }
    }
  }

  // ─── card_select: use as truth source (shows real deck cards) ───
  if (
    currentType === "card_select" &&
    prevType !== "card_select" &&
    "card_select" in gameState
  ) {
    const selectCards = gameState.card_select.cards;
    if (selectCards.length > deckCards.current.length) {
      const mapped = selectCards.map((c) => ({
        name: c.name,
        description: c.description,
        keywords: c.keywords,
      }));
      deckCards.current = mapped;
      saveToStorage(mapped);
    }
  }

  // At the very start of a run with no deck data, inject the character's starter deck
  if (deckCards.current.length === 0 && gameState && hasRun(gameState)) {
    const { act, floor } = gameState.run;
    if (act === 1 && floor <= 1) {
      const character = extractCharacter(gameState);
      if (character) {
        const starter = getStarterDeck(character);
        if (starter.length > 0) return starter;
      }
    }
  }

  return deckCards.current;
}

/** Extract character name from any game state that has a player field. */
function extractCharacter(state: GameState): string | null {
  if ("relic_select" in state && state.relic_select?.player) {
    return state.relic_select.player.character;
  }
  if ("battle" in state && state.battle) {
    const p = getLocalCombatPlayer(state as CombatState);
    if (p) return p.character;
  }
  if ("map" in state && state.map?.player) {
    return state.map.player.character;
  }
  if ("shop" in state && state.shop?.player) {
    return state.shop.player.character;
  }
  if ("event" in state && state.event?.player) {
    return state.event.player.character;
  }
  if ("rest_site" in state && state.rest_site?.player) {
    return state.rest_site.player.character;
  }
  if ("rewards" in state && state.rewards?.player) {
    return state.rewards.player.character;
  }
  if ("card_select" in state && state.card_select?.player) {
    return state.card_select.player.character;
  }
  if ("treasure" in state && state.treasure?.player) {
    return state.treasure.player.character;
  }
  return null;
}
