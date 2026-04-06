/**
 * Centralized model identifiers for the AI eval pipeline.
 *
 * Naming conventions across the Anthropic ecosystem:
 *   - Legacy `@anthropic-ai/sdk`: `"claude-haiku-4-5-20251001"` (dated)
 *   - Vercel AI Gateway slugs: `"anthropic/claude-haiku-4.5"` (dotted)
 *   - `@ai-sdk/anthropic` provider: `"claude-haiku-4-5"` (hyphenated, no date)
 *
 * All three resolve to the same underlying model. This module uses the
 * `@ai-sdk/anthropic` provider format because that's the migration target
 * (sts2-helper#46). When swapping to AI Gateway in a future change, update
 * the provider call site, not this constant — the dotted format only applies
 * at the gateway boundary.
 *
 * `apps/web/src/lib/usage-logger.ts` MODEL_PRICING accepts both the legacy
 * dated key and this undated key, so historical `usage_logs` rows still
 * resolve correctly after the migration.
 */
export const EVAL_MODELS = {
  default: "claude-haiku-4-5",
  boss: "claude-haiku-4-5",
} as const;

export type EvalModelId = (typeof EVAL_MODELS)[keyof typeof EVAL_MODELS];
