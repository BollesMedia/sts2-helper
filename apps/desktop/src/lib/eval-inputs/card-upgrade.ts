import type { EvaluationContext } from "@sts2/shared/evaluation/types";
import { buildCompactContext } from "@sts2/shared/evaluation/prompt-builder";
import { getUpgradeInfo } from "../upgrade-lookup";

interface SelectableCard {
  name: string;
  description: string;
  cost?: number | string;
  type?: string;
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

  const cardList = params.eligibleCards.map((c) => {
    const costStr = c.cost != null ? `${c.cost} energy` : "?";
    const typeStr = c.type ? `, ${c.type}` : "";
    const upgradeInfo = getUpgradeInfo(c.name);
    const upgradeStr = upgradeInfo
      ? ` → UPGRADE: ${upgradeInfo.delta}${upgradeInfo.upgradedDescription ? ` | Becomes: "${upgradeInfo.upgradedDescription}"` : ""}`
      : "";
    return `- ${c.name} (${costStr}${typeStr}): ${c.description}${upgradeStr}`;
  }).join("\n");

  return `${contextStr}

CARD UPGRADE: Choose ONE card to upgrade.

ELIGIBLE (with upgrade effects shown after →):
${cardList}
${params.alreadyUpgraded.length > 0 ? `\nNOT ELIGIBLE (already upgraded): ${params.alreadyUpgraded.join(", ")}` : ""}

UPGRADE PRIORITY — choose by IMPACT of the upgrade, not card quality:
- Compare the upgrade deltas above. A big delta on a key card beats a small delta on a great card.
- 0-cost cards: upgrades are free value every play.
- Scaling powers (played once): permanent benefit from upgrade.
- Multi-hit attacks: +damage per hit multiplies with hit count.
- Cards played every combat: high frequency = high upgrade value.

Your card_name response MUST exactly match one of the ELIGIBLE names above.`;
}
