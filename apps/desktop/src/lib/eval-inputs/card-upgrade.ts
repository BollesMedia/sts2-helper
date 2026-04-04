import type { EvaluationContext } from "@sts2/shared/evaluation/types";
import { buildCompactContext } from "@sts2/shared/evaluation/prompt-builder";

interface SelectableCard {
  name: string;
  description: string;
}

export function computeCardUpgradeEvalKey(cards: SelectableCard[]): string {
  return `upgrade:${cards.map((c) => c.name).sort().join(",")}`;
}

export function buildCardUpgradePrompt(params: {
  context: EvaluationContext;
  eligibleCards: SelectableCard[];
  alreadyUpgraded: string[];
}): string {
  const contextStr = buildCompactContext(params.context);
  const cardList = params.eligibleCards.map((c) => `- ${c.name}: ${c.description}`).join("\n");

  return `${contextStr}

CARD UPGRADE: Choose ONE card to upgrade.

ELIGIBLE (you MUST choose from this list):
${cardList}
${params.alreadyUpgraded.length > 0 ? `\nNOT ELIGIBLE (already upgraded, DO NOT recommend these): ${params.alreadyUpgraded.join(", ")}` : ""}

Prioritize: key engine card > most-played card > scaling card > AoE.
Your card_name response MUST exactly match one of the ELIGIBLE names above.`;
}
