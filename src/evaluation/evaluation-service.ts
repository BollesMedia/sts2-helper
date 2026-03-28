import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import type { EvaluationInsert } from "@/lib/supabase/helpers";
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
  skip_recommended: boolean;
  skip_reasoning: string | null;
  spending_plan?: string | null;
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
    skipRecommended: raw.skip_recommended,
    skipReasoning: raw.skip_reasoning,
    spendingPlan: raw.spending_plan ?? null,
  };
}
