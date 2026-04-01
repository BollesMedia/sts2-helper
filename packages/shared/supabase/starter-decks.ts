import type { CombatCard } from "../types/game-state";
import { createClient } from "./client";

const STORAGE_KEY = "sts2-starter-decks";

let starterDecks: Map<string, CombatCard[]> | null = null;
let loading = false;

/**
 * Initialize starter deck cache from Supabase (async, fires once).
 * Same pattern as validCardNames in use-deck-tracker.ts.
 */
export function initStarterDecks(): void {
  if (starterDecks || loading) return;

  // Try sync load from localStorage
  if (typeof window !== "undefined") {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as Record<string, string[]>;
        starterDecks = new Map(
          Object.entries(parsed).map(([name, cards]) => [
            name,
            cards.map((c) => ({ name: c, description: "" })),
          ])
        );
        return;
      }
    } catch {
      // Fall through to async fetch
    }
  }

  loading = true;
  const supabase = createClient();
  supabase
    .from("characters")
    .select("name, starting_deck")
    .not("starting_deck", "is", null)
    .then(({ data }) => {
      if (!data) {
        loading = false;
        return;
      }

      const map = new Map<string, CombatCard[]>();
      const cacheObj: Record<string, string[]> = {};

      for (const row of data) {
        const key = row.name.toLowerCase();
        const deck = (row.starting_deck as string[]).map((c) => ({
          name: c,
          description: "",
        }));
        map.set(key, deck);
        cacheObj[key] = row.starting_deck as string[];
      }

      starterDecks = map;
      loading = false;

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cacheObj));
        } catch {
          // Non-critical
        }
      }
    });
}

/**
 * Get the starter deck for a character. Returns empty array if not cached yet.
 */
export function getStarterDeck(character: string): CombatCard[] {
  if (!starterDecks) return [];
  return starterDecks.get(character.toLowerCase()) ?? [];
}
