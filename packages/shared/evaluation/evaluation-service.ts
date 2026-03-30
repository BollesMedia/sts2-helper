import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";
import type { EvaluationInsert } from "../supabase/helpers";
import type { EvaluationContext, CardEvaluation, CardRewardEvaluation } from "./types";
import { tierToValue, type TierLetter } from "./tier-utils";
import { createContextHash } from "./context-hash";

const MIN_EVALS_FOR_STATISTICAL = 25;
const MIN_AVG_CONFIDENCE = 60;
const MAX_TIER_STDDEV = 1.5;

interface ClaudeCardEvaluation {
  item_id: string;
  rank: number;
  tier: TierLetter;
  synergy_score: number;
  confidence: number;
  recommendation: "strong_pick" | "good_pick" | "situational" | "skip";
  reasoning: string;
}

interface ClaudeCardRewardResponse {
  rankings: ClaudeCardEvaluation[];
  pick_summary: string | null;
  skip_recommended: boolean;
  skip_reasoning: string | null;
  spending_plan?: string | null;
}

const VALID_TIERS = new Set(["S", "A", "B", "C", "D", "F"]);
const VALID_RECS = new Set(["strong_pick", "good_pick", "situational", "skip"]);

/**
 * Extract a JSON array from a string that may contain trailing fields.
 * e.g., '[\n{...}\n],\n"skip_recommended": false' → parses just the array.
 */
function parseRankingsString(str: string): unknown[] {
  // Try parsing the whole string first (valid JSON array)
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Not valid JSON as-is — extract the array portion
  }

  // Find the array boundaries: first [ to its matching ]
  const start = str.indexOf("[");
  if (start === -1) return [];

  let depth = 0;
  for (let i = start; i < str.length; i++) {
    if (str[i] === "[") depth++;
    else if (str[i] === "]") depth--;
    if (depth === 0) {
      try {
        const parsed = JSON.parse(str.slice(start, i + 1));
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return [];
      }
    }
  }

  return [];
}

/**
 * Safely parse an unknown tool_use input into a ClaudeCardRewardResponse.
 * Validates structure at runtime instead of casting through unknown.
 */
export function parseToolUseInput(input: unknown): ClaudeCardRewardResponse {
  if (!input || typeof input !== "object") {
    throw new Error("Tool use input is not an object");
  }

  const obj = input as Record<string, unknown>;

  // Claude sometimes returns rankings as a JSON string instead of an array.
  // The string may also contain trailing fields like "skip_recommended": false
  // appended after the array, making it invalid JSON on its own.
  let rawRankings: unknown[];
  if (Array.isArray(obj.rankings)) {
    rawRankings = obj.rankings;
  } else if (typeof obj.rankings === "string") {
    rawRankings = parseRankingsString(obj.rankings);
  } else {
    rawRankings = [];
  }

  const rankings: ClaudeCardEvaluation[] = rawRankings.map((r: unknown) => {
    if (!r || typeof r !== "object") {
      throw new Error("Ranking entry is not an object");
    }
    const entry = r as Record<string, unknown>;

    const tier = String(entry.tier ?? "C");
    const rec = String(entry.recommendation ?? "situational");

    return {
      item_id: String(entry.item_id ?? ""),
      rank: Number(entry.rank ?? 0),
      tier: (VALID_TIERS.has(tier) ? tier : "C") as TierLetter,
      synergy_score: Number(entry.synergy_score ?? 50),
      confidence: Number(entry.confidence ?? 50),
      recommendation: (VALID_RECS.has(rec) ? rec : "situational") as ClaudeCardEvaluation["recommendation"],
      reasoning: String(entry.reasoning ?? ""),
    };
  });

  // When rankings was a string, other fields may also be embedded in it.
  // Extract them via regex as a fallback.
  const rankingsStr = typeof obj.rankings === "string" ? obj.rankings : "";

  const skipRecommended = obj.skip_recommended
    ?? (() => {
      const m = rankingsStr.match(/"skip_recommended"\s*:\s*(true|false)/);
      return m ? m[1] === "true" : false;
    })();

  const skipReasoning = obj.skip_reasoning
    ?? (() => {
      const m = rankingsStr.match(/"skip_reasoning"\s*:\s*"([^"]*)"/);
      return m ? m[1] : null;
    })();

  const pickSummary = obj.pick_summary
    ?? (() => {
      const m = rankingsStr.match(/"pick_summary"\s*:\s*"([^"]*)"/);
      return m ? m[1] : null;
    })();

  return {
    rankings,
    pick_summary: pickSummary ? String(pickSummary) : null,
    skip_recommended: Boolean(skipRecommended),
    skip_reasoning: skipReasoning ? String(skipReasoning) : null,
    spending_plan: obj.spending_plan ? String(obj.spending_plan) : null,
  };
}

/**
 * Attempt to get a statistical evaluation for an item from the database.
 * Uses tiered lookup: exact → broad → broadest.
 */
export async function getStatisticalEvaluation(
  supabase: SupabaseClient<Database>,
  itemId: string,
  ctx: EvaluationContext
): Promise<CardEvaluation | null> {
  // Try exact match: character + archetype + act
  const { data: exactStats } = await supabase
    .from("evaluation_stats")
    .select("*")
    .eq("item_id", itemId)
    .eq("character", ctx.character)
    .eq("primary_archetype", ctx.primaryArchetype ?? "")
    .eq("act", ctx.act)
    .single();

  if (exactStats && meetsThresholds(exactStats)) {
    return statsToEvaluation(itemId, exactStats);
  }

  // Broader: character + act (ignore archetype)
  const { data: broadStats } = await supabase
    .from("evaluation_stats")
    .select("*")
    .eq("item_id", itemId)
    .eq("character", ctx.character)
    .eq("act", ctx.act)
    .is("primary_archetype", null)
    .single();

  if (broadStats && meetsThresholds(broadStats)) {
    return statsToEvaluation(itemId, broadStats);
  }

  // Broadest: just character (aggregate across all archetypes/acts)
  const { data: broadestRows } = await supabase
    .from("evaluations")
    .select("item_name, tier_value, synergy_score, confidence, recommendation")
    .eq("item_id", itemId)
    .eq("character", ctx.character)
    .eq("source", "claude");

  if (broadestRows && broadestRows.length >= MIN_EVALS_FOR_STATISTICAL) {
    const avgConfidence = Math.round(
      broadestRows.reduce((sum, r) => sum + r.confidence, 0) / broadestRows.length
    );
    const totalWeight = broadestRows.reduce((sum, r) => sum + r.confidence, 0);
    const weightedTier = totalWeight > 0
      ? broadestRows.reduce((sum, r) => sum + r.tier_value * r.confidence, 0) / totalWeight
      : 3;
    const weightedSynergy = totalWeight > 0
      ? Math.round(broadestRows.reduce((sum, r) => sum + r.synergy_score * r.confidence, 0) / totalWeight)
      : 50;
    const tierValues = broadestRows.map((r) => r.tier_value);
    const mean = tierValues.reduce((a, b) => a + b, 0) / tierValues.length;
    const variance = tierValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / tierValues.length;
    const stddev = Math.sqrt(variance);

    // Find mode of recommendation
    const recCounts: Record<string, number> = {};
    for (const r of broadestRows) {
      recCounts[r.recommendation] = (recCounts[r.recommendation] ?? 0) + 1;
    }
    const mostCommonRec = Object.entries(recCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "situational";

    const aggregated = {
      item_name: broadestRows[0]?.item_name ?? itemId,
      weighted_tier: weightedTier,
      weighted_synergy: weightedSynergy,
      avg_confidence: avgConfidence,
      most_common_rec: mostCommonRec,
      eval_count: broadestRows.length,
      tier_stddev: stddev,
    };

    if (meetsThresholds({ eval_count: aggregated.eval_count, avg_confidence: aggregated.avg_confidence, tier_stddev: aggregated.tier_stddev })) {
      return statsToEvaluation(itemId, aggregated);
    }
  }

  return null;
}

function meetsThresholds(stats: {
  eval_count: number | null;
  avg_confidence: number | null;
  tier_stddev: number | null;
}): boolean {
  return (
    (stats.eval_count ?? 0) >= MIN_EVALS_FOR_STATISTICAL &&
    (stats.avg_confidence ?? 0) >= MIN_AVG_CONFIDENCE &&
    (stats.tier_stddev ?? Infinity) <= MAX_TIER_STDDEV
  );
}

function statsToEvaluation(
  itemId: string,
  stats: {
    item_name: string | null;
    weighted_tier: number | null;
    weighted_synergy: number | null;
    avg_confidence: number | null;
    most_common_rec: string | null;
    eval_count: number | null;
  }
): CardEvaluation {
  const tierValue = Math.round(stats.weighted_tier ?? 3);
  const tierLetters: TierLetter[] = ["F", "F", "D", "C", "B", "A", "S"];

  return {
    itemId,
    itemName: stats.item_name ?? itemId,
    rank: 0,
    tier: tierLetters[Math.max(0, Math.min(6, tierValue))] ?? "C",
    tierValue,
    synergyScore: stats.weighted_synergy ?? 50,
    confidence: stats.avg_confidence ?? 50,
    recommendation: (stats.most_common_rec ?? "situational") as CardEvaluation["recommendation"],
    reasoning: `Based on ${stats.eval_count} previous evaluations (avg confidence: ${stats.avg_confidence}%)`,
    source: "statistical",
  };
}

/**
 * Log an evaluation to Supabase (fire-and-forget).
 */
export async function logEvaluation(
  supabase: SupabaseClient<Database>,
  ctx: EvaluationContext,
  evaluation: CardEvaluation,
  runId: string | null,
  gameVersion: string | null,
  userId: string | null = null
): Promise<void> {
  const row: EvaluationInsert = {
    run_id: runId,
    user_id: userId,
    game_version: gameVersion,
    item_type: "card",
    item_id: evaluation.itemId,
    item_name: evaluation.itemName,
    character: ctx.character,
    archetypes: ctx.archetypes.map((a) => a.archetype),
    primary_archetype: ctx.primaryArchetype,
    act: ctx.act,
    floor: ctx.floor,
    deck_size: ctx.deckSize,
    hp_percent: ctx.hpPercent,
    gold: ctx.gold,
    energy: ctx.energy,
    relic_ids: ctx.relicIds,
    has_scaling: ctx.hasScaling,
    curse_count: ctx.curseCount,
    tier_value: evaluation.tierValue,
    synergy_score: evaluation.synergyScore,
    confidence: evaluation.confidence,
    recommendation: evaluation.recommendation,
    reasoning: evaluation.reasoning,
    source: evaluation.source,
    context_hash: createContextHash(ctx),
  };

  await supabase.from("evaluations").insert(row);
}

/**
 * Parse Claude's JSON response into typed evaluations.
 */
export function parseClaudeCardRewardResponse(
  raw: ClaudeCardRewardResponse
): CardRewardEvaluation {
  return {
    rankings: raw.rankings.map((r) => ({
      itemId: r.item_id,
      itemName: r.item_id,
      rank: r.rank,
      tier: r.tier,
      tierValue: tierToValue(r.tier),
      synergyScore: r.synergy_score,
      confidence: r.confidence,
      recommendation: r.recommendation,
      reasoning: r.reasoning,
      source: "claude" as const,
    })),
    pickSummary: raw.pick_summary ?? null,
    skipRecommended: raw.skip_recommended,
    skipReasoning: raw.skip_reasoning,
    spendingPlan: raw.spending_plan ?? null,
  };
}
