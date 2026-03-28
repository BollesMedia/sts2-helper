import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

// Haiku pricing per 1M tokens (as of March 2026)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.00 },
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
};

export async function logUsage(
  supabase: SupabaseClient<Database>,
  params: {
    userId: string | null;
    evalType: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }
): Promise<void> {
  const pricing = MODEL_PRICING[params.model] ?? MODEL_PRICING["claude-haiku-4-5-20251001"];
  const costEstimate =
    (params.inputTokens / 1_000_000) * pricing.input +
    (params.outputTokens / 1_000_000) * pricing.output;

  await supabase.from("usage_logs").insert({
    user_id: params.userId ?? null,
    eval_type: params.evalType,
    model: params.model,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    cost_estimate: costEstimate,
  });
}
