"use client";

import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import type { Card } from "@/lib/supabase/helpers";

const supabase = createClient();

async function fetchCards(): Promise<Card[]> {
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .order("name");

  if (error) throw error;
  return data;
}

export function useCards() {
  return useSWR("game-data:cards", fetchCards, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 1000 * 60 * 60, // 1 hour
  });
}

export function useCardById(id: string | null) {
  return useSWR(
    id ? `game-data:card:${id}` : null,
    async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("cards")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      return data;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 1000 * 60 * 60,
    }
  );
}
