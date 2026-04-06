import type { EvaluationContext } from "@sts2/shared/evaluation/types";
import { buildCompactContext } from "@sts2/shared/evaluation/prompt-builder";

interface SelectableCard {
  name: string;
  description: string;
}

export function computeCardSelectEvalKey(prompt: string, cards: SelectableCard[]): string {
  return `select:${prompt}:${cards.map((c) => c.name).sort().join(",")}`;
}

export function buildCardSelectPrompt(params: {
  context: EvaluationContext;
  prompt: string;
  cards: SelectableCard[];
}): string {
  const contextStr = buildCompactContext(params.context);
  const cardList = params.cards.map((c) => `- ${c.name}: ${c.description}`).join("\n");

  return `${contextStr}

CARD SELECT: "${params.prompt}"
You must choose ONE card from your deck for this effect.
Cards available:
${cardList}

Choose the card that benefits MOST from this effect given the current archetype and win condition.
Prioritize: key engine cards > most-played cards > highest-impact cards.

Return your single pick via the submit_recommendation tool with the exact card name and under-20-words reasoning.`;
}
