import type { EvaluationContext } from "@sts2/shared/evaluation/types";
import { buildCompactContext } from "@sts2/shared/evaluation/prompt-builder";

interface SelectableCard {
  name: string;
  description: string;
}

export function computeCardRemovalEvalKey(cards: SelectableCard[]): string {
  return `removal:${cards.map((c) => c.name).sort().join(",")}`;
}

export function buildCardRemovalPrompt(params: {
  context: EvaluationContext;
  cards: SelectableCard[];
}): string {
  const contextStr = buildCompactContext(params.context);
  const cardList = params.cards.map((c) => `- ${c.name}: ${c.description}`).join("\n");

  return `${contextStr}

CARD REMOVAL: Recommend ONE card to remove from this list:
${cardList}

Priority: curses/unplayables > Strikes > Defends > off-archetype. ETERNAL cards cannot be removed. If archetype uses block-scaling, keep Defends longer.`;
}
