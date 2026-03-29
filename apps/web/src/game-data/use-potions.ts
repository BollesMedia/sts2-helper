"use client";

import { createClient } from "@/lib/supabase/client";
import type { Potion } from "@/lib/supabase/helpers";
import { createGameDataHook } from "./create-game-data-hook";

export const usePotions = createGameDataHook<Potion>("potions", async () => {
  const supabase = createClient();
  const { data, error } = await supabase.from("potions").select("*").order("name");
  if (error) throw error;
  return data;
});
