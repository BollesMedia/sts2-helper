"use client";

import { useRef } from "react";
import type { GameState, CombatCard } from "@/lib/types/game-state";
import { isCombatState } from "@/lib/types/game-state";
import { createClient } from "@/lib/supabase/client";

const STORAGE_KEY = "sts2-deck";
const VALID_CARDS_KEY = "sts2-valid-cards";

function loadFromStorage(): CombatCard[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveToStorage(cards: CombatCard[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  } catch {}
}

/**
 * Set of valid player card names (lowercase) loaded from Supabase.
 * Includes character-specific, colorless, and curse cards.
 * Excludes Status type cards which are enemy-generated.
 */
let validCardNames: Set<string> | null = null;
let validCardsLoading = false;

async function loadValidCardNames(): Promise<Set<string>> {
  // Check localStorage cache first
  if (typeof window !== "undefined") {
    try {
      const cached = localStorage.getItem(VALID_CARDS_KEY);
      if (cached) {
        const parsed: string[] = JSON.parse(cached);
        return new Set(parsed);
      }
    } catch {}
  }

  const supabase = createClient();
  const { data } = await supabase
    .from("cards")
    .select("name, type")
    .neq("type", "Status");

  const names = new Set(
    (data ?? []).map((c) => c.name.toLowerCase())
  );

  // Also add upgraded variants (name+)
  const withUpgrades = new Set(names);
  for (const name of names) {
    withUpgrades.add(`${name}+`);
  }

  // Cache in localStorage
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(
        VALID_CARDS_KEY,
        JSON.stringify([...withUpgrades])
      );
    } catch {}
  }

  return withUpgrades;
}

function isPlayerCard(card: CombatCard): boolean {
  if (!validCardNames) return true; // haven't loaded yet, don't filter
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
  const isVerified = useRef(false);
  const prevStateType = useRef<string | null>(null);
  const initialized = useRef(false);

  // Load deck from localStorage and valid card names on first render
  if (!initialized.current) {
    initialized.current = true;
    deckCards.current = loadFromStorage();

    if (!validCardNames && !validCardsLoading) {
      validCardsLoading = true;
      loadValidCardNames().then((names) => {
        validCardNames = names;
        validCardsLoading = false;
      });
    }
  }

  if (!gameState) return deckCards.current;

  const currentType = gameState.state_type;
  const prevType = prevStateType.current;
  prevStateType.current = currentType;

  // ─── COMBAT: Ground truth sync ───
  // Sync on every combat poll, but filter to valid player cards only.
  // Only update if the filtered set is larger than what we have
  // (combat adds temporary cards but never removes real ones).
  if (isCombatState(gameState) && gameState.battle?.player) {
    const p = gameState.battle.player;
    const allPiles = [
      ...(p.hand ?? []),
      ...(p.draw_pile ?? []),
      ...(p.discard_pile ?? []),
      ...(p.exhaust_pile ?? []),
    ];
    const combatDeck = allPiles.filter(isPlayerCard);

    // Only update if we got a meaningful deck (>= current tracked size)
    // This prevents enemy status cards from shrinking the deck count
    if (combatDeck.length > 0 && combatDeck.length >= deckCards.current.length) {
      const newNames = combatDeck.map((c) => c.name).sort().join(",");
      const oldNames = deckCards.current.map((c) => c.name).sort().join(",");

      if (newNames !== oldNames) {
        console.log("[DeckTracker] Deck updated:", {
          from: deckCards.current.length,
          to: combatDeck.length,
          round: gameState.battle.round,
        });
        deckCards.current = combatDeck;
        isVerified.current = true;
        saveToStorage(combatDeck);
      }
    }
  }

  // ─── LEAVING card_reward: mark unverified ───
  if (prevType === "card_reward" && currentType !== "card_reward") {
    isVerified.current = false;
  }

  // ─── card_select: use as truth source (shows full deck) ───
  if (
    currentType === "card_select" &&
    prevType !== "card_select" &&
    "card_select" in gameState
  ) {
    const selectCards = gameState.card_select.cards;
    if (selectCards.length > 0) {
      const mapped = selectCards.map((c) => ({
        name: c.name,
        description: c.description,
        keywords: c.keywords,
      }));
      deckCards.current = mapped;
      isVerified.current = true;
      saveToStorage(mapped);
    }
  }

  return deckCards.current;
}
