"use client";

import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import type { Card } from "@/lib/supabase/helpers";
import { createGameDataHook } from "./create-game-data-hook";

export const useCards = createGameDataHook<Card>("cards", async () => {
  const supabase = createClient();
  const { data, error } = await supabase.from("cards").select("*").order("name");
  if (error) throw error;
  return data;
});

export function useCardById(id: string | null) {
  return useSWR(
    id ? `game-data:card:${id}` : null,
    async () => {
      if (!id) return null;
      const supabase = createClient();
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
