import type { EventOption } from "@sts2/shared/types/game-state";
import type { EvaluationContext, CardRewardEvaluation, CardEvaluation } from "@sts2/shared/evaluation/types";
import type { GenericEvalRaw } from "@sts2/shared/evaluation/eval-schemas";
import { tierToValue, type TierLetter } from "@sts2/shared/evaluation/tier-utils";
import { buildCompactContext } from "@sts2/shared/evaluation/prompt-builder";
import { getRelicDescription } from "../../lib/relic-lookup";
import { getEnchantmentDescription } from "../../lib/enchantment-lookup";

/**
 * Compute the dedup key for an event evaluation.
 */
export function computeEventEvalKey(
  eventId: string,
  options: EventOption[]
): string {
  return `${eventId}:${options.map((o) => o.index).join(",")}`;
}

/**
 * Build the event evaluation prompt.
 * Pure function — all lookups (relic, enchantment) are passed as function deps.
 */
export function buildEventPrompt(params: {
  context: EvaluationContext;
  eventName: string;
  eventId: string;
  isAncient: boolean;
  options: EventOption[];
  runNarrative: string | null;
}): string {
  const contextStr = buildCompactContext(params.context);
  const optionsStr = params.options
    .map((o, i) => {
      let text = `${i + 1}. ${o.title}: ${o.description}`;
      if (o.relic_name) {
        const relicDesc = o.relic_description || getRelicDescription(o.relic_name);
        text += ` [Relic: ${o.relic_name}`;
        if (relicDesc) text += ` — ${relicDesc}`;
        text += "]";
      }
      const enchantDesc = getEnchantmentDescription(o.description);
      if (enchantDesc) {
        text += ` [Enchantment effect: ${enchantDesc}]`;
      }
      return text;
    })
    .join("\n");

  const eventHeader = params.isAncient
    ? `EVENT_ID: ${params.eventId}\nANCIENT EVENT: ${params.eventName}`
    : `EVENT_ID: ${params.eventId}\nEVENT: ${params.eventName}`;

  return `${contextStr}

${eventHeader}
You must choose EXACTLY ONE option:
${optionsStr}

This is an exclusive choice. Recommend ONE best option as "strong_pick". The others should be "situational" or "skip" — they are alternatives you're NOT recommending.

Respond as JSON:
{
  "rankings": [
    {
      "item_id": "EVENT_1",
      "rank": 1,
      "tier": "S|A|B|C|D|F",
      "synergy_score": 0-100,
      "confidence": 0-100,
      "recommendation": "strong_pick|good_pick|situational|skip",
      "reasoning": "Max 12 words"
    }
  ],
  "skip_recommended": false,
  "skip_reasoning": null
}

Use item_id EVENT_1, EVENT_2, EVENT_3 matching the numbered options above.`;
}

/**
 * Parse the validated generic eval response into CardRewardEvaluation.
 * Maps EVENT_1/EVENT_2/etc back to option titles.
 */
export function parseEventResponse(
  raw: GenericEvalRaw,
  options: EventOption[]
): CardRewardEvaluation {
  const rankings: CardEvaluation[] = raw.rankings.map((r, i) => {
    const indexMatch = r.item_id.match(/(\d+)$/);
    const oneIndexed = indexMatch ? parseInt(indexMatch[1], 10) : 0;
    const optIndex = oneIndexed - 1;

    return {
      itemId: r.item_id,
      itemName: options[optIndex]?.title ?? r.item_id,
      itemIndex: optIndex,
      rank: r.rank ?? i + 1,
      tier: r.tier as TierLetter,
      tierValue: tierToValue(r.tier as TierLetter),
      synergyScore: r.synergy_score ?? 50,
      confidence: r.confidence,
      recommendation: (r.recommendation ?? deriveRecommendationFromTier(r.tier)) as CardEvaluation["recommendation"],
      reasoning: r.reasoning,
      source: "claude" as const,
    };
  });

  return {
    rankings,
    skipRecommended: raw.skip_recommended ?? false,
    skipReasoning: raw.skip_reasoning ?? null,
  };
}

function deriveRecommendationFromTier(tier: string): CardEvaluation["recommendation"] {
  if (tier === "S" || tier === "A") return "strong_pick";
  if (tier === "B") return "good_pick";
  if (tier === "C") return "situational";
  return "skip";
}
