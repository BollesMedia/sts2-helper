import { createServiceClient } from "@/lib/supabase/server";

interface RunSummary {
  character: string;
  ascension: number;
  victory: boolean | null;
  finalFloor: number | null;
  notes: string | null;
  bosses: string[];
}

let cachedHistory: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 1000 * 60 * 5; // refresh every 5 minutes

/**
 * Builds a concise run history context string for Claude prompts.
 * Includes recent runs with outcomes, notes, and bosses fought.
 * Cached for 5 minutes to avoid hitting Supabase on every evaluation.
 */
export async function getRunHistoryContext(): Promise<string> {
  if (cachedHistory && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedHistory;
  }

  try {
    const supabase = createServiceClient();

    const { data: runs } = await supabase
      .from("runs")
      .select("character, ascension_level, victory, final_floor, notes, bosses_fought")
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(10);

    if (!runs || runs.length === 0) {
      cachedHistory = "";
      cacheTimestamp = Date.now();
      return "";
    }

    const summaries: RunSummary[] = runs.map((r) => ({
      character: r.character,
      ascension: r.ascension_level ?? 0,
      victory: r.victory,
      finalFloor: r.final_floor,
      notes: r.notes,
      bosses: r.bosses_fought ?? [],
    }));

    const wins = summaries.filter((r) => r.victory === true).length;
    const losses = summaries.filter((r) => r.victory === false).length;

    const lines: string[] = [
      `Recent run history (${wins}W/${losses}L from last ${summaries.length} runs):`,
    ];

    for (const run of summaries.slice(0, 5)) {
      const outcome = run.victory === true ? "WIN" : run.victory === false ? "LOSS" : "QUIT";
      const bossStr = run.bosses.length > 0 ? ` vs ${run.bosses.join(", ")}` : "";
      lines.push(
        `  ${outcome} ${run.character} A${run.ascension} Floor ${run.finalFloor ?? "?"}${bossStr}`
      );
      if (run.notes) {
        lines.push(`    Player note: "${run.notes}"`);
      }
    }

    // Extract patterns from notes
    const allNotes = summaries
      .filter((r) => r.notes && r.victory === false)
      .map((r) => r.notes!);

    if (allNotes.length > 0) {
      lines.push("");
      lines.push("Player's recurring issues from defeat notes (learn from these):");
      for (const note of allNotes.slice(0, 3)) {
        lines.push(`  - "${note}"`);
      }
    }

    cachedHistory = lines.join("\n");
    cacheTimestamp = Date.now();
    return cachedHistory;
  } catch {
    return "";
  }
}
