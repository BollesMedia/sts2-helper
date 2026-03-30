"use client";

import { createClient } from "../supabase/client";
import type { Monster } from "../supabase/helpers";
import { createGameDataHook } from "./create-game-data-hook";

export const useMonsters = createGameDataHook<Monster>("monsters", async () => {
  const supabase = createClient();
  const { data, error } = await supabase.from("monsters").select("*").order("name");
  if (error) throw error;
  return data;
});
