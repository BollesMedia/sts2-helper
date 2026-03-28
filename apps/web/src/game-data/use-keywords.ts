"use client";

import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import type { Keyword } from "@/lib/supabase/helpers";

const supabase = createClient();

async function fetchKeywords(): Promise<Keyword[]> {
  const { data, error } = await supabase
    .from("keywords")
    .select("*")
    .order("name");

  if (error) throw error;
  return data;
}

export function useKeywords() {
  return useSWR("game-data:keywords", fetchKeywords, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 1000 * 60 * 60,
  });
}
