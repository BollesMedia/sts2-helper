import type { DeckState } from "./deck-state";
import type { CardTags } from "./card-tags";

export interface TaggedOffer {
  index: number;
  name: string;
  rarity: string;
  type: string;
  cost: number | null;
  description: string;
  tags: CardTags;
}

function yesNo(b: boolean): string {
  return b ? "yes" : "no";
}

function archetypeLine(a: { name: string; supportCount: number; hasKeystone: boolean }): string {
  return `  - ${a.name} (support: ${a.supportCount}, keystone: ${a.hasKeystone ? "YES" : "NO"})`;
}

export function formatCardFacts(state: DeckState, offers: TaggedOffer[]): string {
  const ratio = Math.round(state.hp.ratio * 100);
  const upgradePct = Math.round(state.composition.upgradeRatio * 100);

  const lines: string[] = [
    "=== DECK STATE ===",
    `Deck: ${state.size} cards, ${state.composition.upgraded} upgraded (${upgradePct}%) | Basics: ${state.composition.strikes} Strike, ${state.composition.defends} Defend | Dead-card count: ${state.composition.deadCards} | Size verdict: ${state.sizeVerdict.toUpperCase()}`,
    `Act ${state.act}, Floor ${state.floor}, Ascension ${state.ascension} | HP: ${state.hp.current}/${state.hp.max} (${ratio}%)`,
    "",
  ];

  if (state.archetypes.viable.length === 0) {
    lines.push("Archetypes viable: none");
  } else {
    lines.push("Archetypes viable:");
    for (const a of state.archetypes.viable) lines.push(archetypeLine(a));
  }
  lines.push(`Committed archetype: ${state.archetypes.committed ?? "none yet"}`);
  lines.push(
    state.archetypes.orphaned.length === 0
      ? "Orphaned support: none"
      : `Orphaned support: ${state.archetypes.orphaned.map((o) => `${o.archetype}(${o.cards.length})`).join(", ")}`,
  );
  lines.push("");
  lines.push(
    `Engine status: scaling: ${yesNo(state.engine.hasScaling)} | block_payoff: ${yesNo(state.engine.hasBlockPayoff)} | draw_power: ${yesNo(state.engine.hasDrawPower)} | upgrades_remaining: ${state.engine.hasRemovalMomentum}`,
  );
  lines.push("");

  const nextNode = state.upcoming.nextNodeType ?? "unknown";
  const bosses = state.upcoming.bossesPossible.length
    ? ` | act bosses possible: ${state.upcoming.bossesPossible.join(", ")}`
    : "";
  lines.push(`Upcoming: next node = ${nextNode}${bosses}`);
  if (state.upcoming.dangerousMatchups.length > 0) {
    lines.push(`Dangerous matchups (from history): ${state.upcoming.dangerousMatchups.join(", ")}`);
  }

  lines.push("", "=== OFFERED CARDS ===");
  for (const o of offers) {
    const costLabel = o.cost != null ? `, cost ${o.cost}` : "";
    lines.push(`${o.index}. ${o.name} (${o.rarity} ${o.type}${costLabel}) — ${o.description}`);
    lines.push(
      `   Tags: role=${o.tags.role} | fits_archetypes=[${o.tags.fitsArchetypes.join(",")}] | keystone_for=${o.tags.keystoneFor ?? "null"} | dead_with_current_deck=${o.tags.deadWithCurrentDeck} | duplicate_penalty=${o.tags.duplicatePenalty}`,
    );
  }

  return lines.join("\n");
}
