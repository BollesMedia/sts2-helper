import { createServiceClient } from "@/lib/supabase/server";

let cachedHistory: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 1000 * 60 * 5; // refresh every 5 minutes

/**
 * Builds a compact run history summary for Claude prompts.
 * Aggregates stats and extracts patterns instead of dumping raw data.
 * Target: ~200 tokens regardless of how many runs exist.
 */
export async function getRunHistoryContext(): Promise<string> {
  if (cachedHistory && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedHistory;
  }

  try {
    const supabase = createServiceClient();

    // Get aggregate stats
    const { data: runs } = await supabase
      .from("runs")
      .select("character, ascension_level, victory, final_floor, notes, bosses_fought")
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(50);

    if (!runs || runs.length === 0) {
      cachedHistory = "";
      cacheTimestamp = Date.now();
      return "";
    }

    const wins = runs.filter((r) => r.victory === true).length;
    const losses = runs.filter((r) => r.victory === false).length;
    const avgFloor = Math.round(
      runs.reduce((sum, r) => sum + (r.final_floor ?? 0), 0) / runs.length
    );

    // Boss kill/death stats
    const bossDeaths: Record<string, number> = {};
    const bossKills: Record<string, number> = {};
    for (const run of runs) {
      const bosses = run.bosses_fought ?? [];
      for (const boss of bosses) {
        if (run.victory === false) {
          bossDeaths[boss] = (bossDeaths[boss] ?? 0) + 1;
        } else if (run.victory === true) {
          bossKills[boss] = (bossKills[boss] ?? 0) + 1;
        }
      }
    }

    // Extract recurring themes from recent defeat notes (last 5 losses only)
    const recentLossNotes = runs
      .filter((r) => r.victory === false && r.notes)
      .slice(0, 5)
      .map((r) => r.notes!);

    // Build compact summary
    const lines: string[] = [
      `Player stats: ${wins}W/${losses}L (${runs.length} runs), avg floor ${avgFloor}`,
    ];

    // Dangerous bosses
    const dangerousBosses = Object.entries(bossDeaths)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (dangerousBosses.length > 0) {
      lines.push(
        `Struggles against: ${dangerousBosses.map(([b, d]) => `${b} (${d} deaths)`).join(", ")}`
      );
    }

    // Distill notes into 1-2 key themes (not raw notes)
    if (recentLossNotes.length > 0) {
      // Simple keyword frequency to find patterns
      const themes: Record<string, number> = {};
      const keywords: Record<string, string> = {
        defense: "lacking defense/block",
        block: "lacking defense/block",
        def: "lacking defense/block",
        hp: "HP management issues",
        heal: "HP management issues",
        elite: "elite fights too risky",
        boss: "boss fights unprepared",
        scaling: "lacking damage scaling",
        damage: "lacking damage scaling",
        energy: "energy economy problems",
      };

      for (const note of recentLossNotes) {
        const lower = note.toLowerCase();
        for (const [kw, theme] of Object.entries(keywords)) {
          if (lower.includes(kw)) {
            themes[theme] = (themes[theme] ?? 0) + 1;
          }
        }
      }

      const topThemes = Object.entries(themes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([t]) => t);

      if (topThemes.length > 0) {
        lines.push(`Recurring weaknesses: ${topThemes.join(", ")}`);
      }
    }

    cachedHistory = lines.join("\n");
    cacheTimestamp = Date.now();
    return cachedHistory;
  } catch {
    return "";
  }
}
