"use client";

import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import type { Monster } from "@/lib/supabase/helpers";

const supabase = createClient();

async function fetchMonsters(): Promise<Monster[]> {
  const { data, error } = await supabase
    .from("monsters")
    .select("*")
    .order("name");

  if (error) throw error;
  return data;
}

export function useMonsters() {
  return useSWR("game-data:monsters", fetchMonsters, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 1000 * 60 * 60,
  });
}
