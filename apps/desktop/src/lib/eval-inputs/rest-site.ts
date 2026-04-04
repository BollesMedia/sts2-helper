import type { EvaluationContext, CardRewardEvaluation, CardEvaluation } from "@sts2/shared/evaluation/types";
import { tierToValue, type TierLetter } from "@sts2/shared/evaluation/tier-utils";
import { buildCompactContext } from "@sts2/shared/evaluation/prompt-builder";
import { buildRestContext, buildRestPromptSection } from "../build-rest-context";

interface RestOption {
  index: number;
  id: string;
  name: string;
  description: string;
  is_enabled: boolean;
}

/**
 * Compute the dedup key for a rest site evaluation.
 */
export function computeRestSiteEvalKey(
  floor: number,
  options: RestOption[]
): string {
  return `rest:${floor}:${options.map((o) => o.id).join(",")}`;
}

/**
 * Build the rest site evaluation prompt.
 */
export function buildRestSitePrompt(params: {
  context: EvaluationContext;
  hp: number;
  maxHp: number;
  floorsToNextBoss: number;
  hasEliteAhead: boolean;
  hasRestAhead: boolean;
  relicDescriptions: string[];
  upgradeCandidates: string[];
  options: RestOption[];
}): string {
  const contextStr = buildCompactContext(params.context);
  const optionsStr = params.options
    .map((o, i) => `${i + 1}. ${o.name} (${o.id}): ${o.description}`)
    .join("\n");

  const restCtx = buildRestContext({
    hp: params.hp,
    maxHp: params.maxHp,
    floorsToNextBoss: params.floorsToNextBoss,
    hasEliteAhead: params.hasEliteAhead,
    hasRestAhead: params.hasRestAhead,
    relicDescriptions: params.relicDescriptions,
    upgradeCandidates: params.upgradeCandidates,
  });

  const restPromptSection = buildRestPromptSection(restCtx, params.hp, params.maxHp);

  return `${contextStr}

${restPromptSection}

REST SITE — choose ONE:
${optionsStr}

Respond as JSON:
{
  "rankings": [{"item_id": "OPTION_ID", "rank": 1, "tier": "S-F", "synergy_score": 0-100, "confidence": 0-100, "recommendation": "strong_pick|good_pick|situational|skip", "reasoning": "max 12 words, name card if Smith"}],
  "skip_recommended": false,
  "skip_reasoning": null
}`;
}

/**
 * Parse rest site raw response into CardRewardEvaluation.
 * Maps option IDs back to rest site option names.
 */
export function parseRestSiteResponse(
  raw: { rankings: { item_id: string; rank: number; tier: string; synergy_score: number; confidence: number; recommendation: string; reasoning: string }[]; pick_summary?: string | null; skip_recommended?: boolean; skip_reasoning?: string | null },
  options: RestOption[]
): CardRewardEvaluation {
  const rankings: CardEvaluation[] = (raw.rankings ?? []).map((r, i) => {
    const ranking = {
      itemId: r.item_id,
      itemName: r.item_id,
      itemIndex: i,
      rank: r.rank,
      tier: r.tier as TierLetter,
      tierValue: tierToValue(r.tier as TierLetter),
      synergyScore: r.synergy_score,
      confidence: r.confidence,
      recommendation: r.recommendation as CardEvaluation["recommendation"],
      reasoning: r.reasoning,
      source: "claude" as const,
    };

    // Match back to options by ID
    const rId = ranking.itemId.toLowerCase();
    const matchIdx = options.findIndex(
      (o) =>
        o.id.toLowerCase() === rId ||
        o.name.toLowerCase() === rId ||
        rId.includes(o.id.toLowerCase()) ||
        rId.includes(o.name.toLowerCase())
    );
    if (matchIdx !== -1) {
      ranking.itemId = options[matchIdx].id;
      ranking.itemName = options[matchIdx].name;
      ranking.itemIndex = matchIdx;
    }

    return ranking;
  });

  return {
    rankings,
    skipRecommended: raw.skip_recommended ?? false,
    skipReasoning: raw.skip_reasoning ?? null,
  };
}
