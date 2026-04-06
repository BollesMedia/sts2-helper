import { tierToValue, type TierLetter } from "./tier-utils";
import type { CardRewardEvalRaw } from "./eval-schemas";
import type { CardRewardEvaluation, CardEvaluation } from "./types";

/**
 * Convert a zod-validated card_reward / shop response into the canonical
 * camelCase `CardRewardEvaluation` shape.
 *
 * The input has already been validated by `cardRewardSchema` (length matches
 * items.length, all required fields present), so this is a pure shape adapter
 * with no defensive parsing. The previous `parseToolUseInput` +
 * `parseClaudeCardRewardResponse` pair did runtime validation, default-fill,
 * and the Haiku stringified-blob recovery — all of those concerns are now
 * handled by zod and the strict-fail decision in route.ts.
 *
 * Position is 1-indexed from the model, so `itemIndex = position - 1`.
 * `itemId` and `itemName` are looked up from `items[itemIndex]` — this
 * replaces the old in-route position-matching loop.
 *
 * Migration ref: sts2-helper#46
 */
export function toCardRewardEvaluation(
  parsed: CardRewardEvalRaw,
  items: { id: string; name: string }[],
): CardRewardEvaluation {
  const rankings: CardEvaluation[] = parsed.rankings.map((r, idx) => {
    const itemIndex = r.position - 1;
    const item = items[itemIndex];
    return {
      itemId: item?.id ?? String(itemIndex),
      itemName: item?.name ?? String(itemIndex),
      itemIndex,
      rank: idx + 1,
      tier: r.tier as TierLetter,
      tierValue: tierToValue(r.tier as TierLetter),
      synergyScore: 50,
      confidence: r.confidence,
      recommendation: deriveRecommendation(r.tier),
      reasoning: r.reasoning,
      source: "claude" as const,
    };
  });

  // `spending_plan` only exists when `includeShopPlan` was passed to
  // `buildCardRewardSchema`. Use a runtime check rather than narrowing
  // through a discriminated union to keep the adapter small.
  const spendingPlan =
    "spending_plan" in parsed && typeof parsed.spending_plan === "string"
      ? parsed.spending_plan
      : null;

  return {
    rankings,
    skipRecommended: parsed.skip_recommended,
    skipReasoning: parsed.skip_reasoning ?? null,
    spendingPlan,
  };
}

/**
 * Derive a `recommendation` value from the tier letter when the model didn't
 * provide one explicitly. Mirrors the fallback in the previous
 * `parseToolUseInput` (parse-tool-response.ts:90-95 pre-migration).
 */
function deriveRecommendation(
  tier: TierLetter,
): CardEvaluation["recommendation"] {
  if (tier === "S" || tier === "A") return "strong_pick";
  if (tier === "B") return "good_pick";
  if (tier === "C") return "situational";
  return "skip";
}
