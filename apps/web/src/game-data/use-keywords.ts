"use client";

import { createClient } from "@/lib/supabase/client";
import type { Keyword } from "@/lib/supabase/helpers";
import { createGameDataHook } from "./create-game-data-hook";

export const useKeywords = createGameDataHook<Keyword>("keywords", async () => {
  const supabase = createClient();
  const { data, error } = await supabase.from("keywords").select("*").order("name");
  if (error) throw error;
  return data;
});
