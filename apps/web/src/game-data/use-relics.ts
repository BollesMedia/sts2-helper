"use client";

import { createClient } from "@/lib/supabase/client";
import type { Relic } from "@/lib/supabase/helpers";
import { createGameDataHook } from "./create-game-data-hook";

export const useRelics = createGameDataHook<Relic>("relics", async () => {
  const supabase = createClient();
  const { data, error } = await supabase.from("relics").select("*").order("name");
  if (error) throw error;
  return data;
});
