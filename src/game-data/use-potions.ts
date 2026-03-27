"use client";

import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import type { Potion } from "@/lib/supabase/helpers";

const supabase = createClient();

async function fetchPotions(): Promise<Potion[]> {
  const { data, error } = await supabase
    .from("potions")
    .select("*")
    .order("name");

  if (error) throw error;
  return data;
}

export function usePotions() {
  return useSWR("game-data:potions", fetchPotions, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 1000 * 60 * 60,
  });
}
