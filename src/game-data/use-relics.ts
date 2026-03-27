"use client";

import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import type { Relic } from "@/lib/supabase/helpers";

const supabase = createClient();

async function fetchRelics(): Promise<Relic[]> {
  const { data, error } = await supabase
    .from("relics")
    .select("*")
    .order("name");

  if (error) throw error;
  return data;
}

export function useRelics() {
  return useSWR("game-data:relics", fetchRelics, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 1000 * 60 * 60,
  });
}
