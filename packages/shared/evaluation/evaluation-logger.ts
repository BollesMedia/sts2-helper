import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";
import type { EvaluationInsert } from "../supabase/helpers";
import type { EvaluationContext, CardEvaluation } from "./types";
import { createContextHash } from "./context-hash";

/**
 * Log an evaluation to Supabase (fire-and-forget).
 */
export async function logEvaluation(
  supabase: SupabaseClient<Database>,
  ctx: EvaluationContext,
  evaluation: CardEvaluation,
  runId: string | null,
  gameVersion: string | null,
  userId: string | null = null,
  evalType?: string,
  originalTierValue?: number,
  weightAdjustments?: unknown[]
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
    ascension: ctx.ascension,
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
    eval_type: evalType ?? null,
    original_tier_value: originalTierValue ?? evaluation.tierValue,
    weight_adjustments: weightAdjustments ?? null,
  };

  await supabase.from("evaluations").insert(row);
}
