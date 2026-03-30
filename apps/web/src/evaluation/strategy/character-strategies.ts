import { createServiceClient } from "@/lib/supabase/server";

let strategyCache: Record<string, string> = {};
let cacheTimestamp = 0;
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

async function loadStrategies(): Promise<Record<string, string>> {
  if (
    Object.keys(strategyCache).length > 0 &&
    Date.now() - cacheTimestamp < CACHE_TTL
  ) {
    return strategyCache;
  }

  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("character_strategies")
      .select("id, strategy");

    if (data && data.length > 0) {
      strategyCache = {};
      for (const row of data) {
        strategyCache[row.id.toLowerCase()] = row.strategy;
      }
      cacheTimestamp = Date.now();
    }
  } catch {
    // Fall through to cache or empty
  }

  return strategyCache;
}

/**
 * Get the strategy guide for the current character from Supabase.
 * Cached for 30 minutes.
 */
export async function getCharacterStrategy(
  character: string
): Promise<string | null> {
  const strategies = await loadStrategies();
  const key = character.toLowerCase().trim();
  return strategies[key] ?? strategies[`the ${key}`] ?? null;
}
