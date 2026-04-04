import type { EvaluationContext } from "@sts2/shared/evaluation/types";
import type { TierLetter } from "@sts2/shared/evaluation/tier-utils";
import { buildCompactContext } from "@sts2/shared/evaluation/prompt-builder";

interface Relic {
  id: string;
  name: string;
  description: string;
  index: number;
}

export interface RelicRanking {
  itemId: string;
  itemName: string;
  itemIndex: number;
  rank: number;
  tier: TierLetter;
  recommendation: string;
  reasoning: string;
}

export interface RelicEvaluation {
  rankings: RelicRanking[];
}

export function computeRelicSelectEvalKey(relics: { id: string }[]): string {
  return `relic:${relics.map((r) => r.id).sort().join(",")}`;
}

export function buildRelicSelectPrompt(params: {
  context: EvaluationContext;
  relicSelectPrompt: string;
  relics: Relic[];
}): string {
  const contextStr = buildCompactContext(params.context);
  const relicList = params.relics
    .map((r, i) => `${i + 1}. ${r.name}: ${r.description}`)
    .join("\n");

  return `${contextStr}

BOSS RELIC SELECT — you MUST pick exactly ONE. This is a permanent, run-defining choice.
${params.relicSelectPrompt}

Options:
${relicList}

Evaluate which relic best supports the current archetype and win condition. Boss relics are the most impactful single choice in a run.

Respond as JSON:
{
  "rankings": [{"item_id": "RELIC_1", "item_name": "relic name", "rank": 1, "tier": "S-F", "recommendation": "strong_pick|good_pick|situational|skip", "reasoning": "max 12 words"}],
  "overall_advice": null
}

Use RELIC_1, RELIC_2, RELIC_3 matching the numbered options above.`;
}

export function parseRelicSelectResponse(
  raw: Record<string, unknown>,
  relics: Relic[]
): RelicEvaluation {
  const rankings: RelicRanking[] = ((raw.rankings as Array<Record<string, unknown>>) ?? []).map(
    (r) => {
      const itemId = r.item_id as string;
      const indexMatch = itemId.match(/(\d+)$/);
      const oneIndexed = indexMatch ? parseInt(indexMatch[1], 10) : 0;
      const idx = oneIndexed - 1;

      return {
        itemId,
        itemName: (r.item_name as string) ?? relics[idx]?.name ?? itemId,
        itemIndex: idx,
        rank: r.rank as number,
        tier: r.tier as TierLetter,
        recommendation: r.recommendation as string,
        reasoning: r.reasoning as string,
      };
    }
  );

  return {
    rankings,
  };
}
