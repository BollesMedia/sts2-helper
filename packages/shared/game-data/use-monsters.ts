"use client";

import { createClient } from "@sts2/shared/supabase/client";
import type { Monster } from "@sts2/shared/supabase/helpers";
import { createGameDataHook } from "./create-game-data-hook";

export const useMonsters = createGameDataHook<Monster>("monsters", async () => {
  const supabase = createClient();
  const { data, error } = await supabase.from("monsters").select("*").order("name");
  if (error) throw error;
  return data;
});
