import type { EvaluationContext } from "./types";

/**
 * Centralized prompt construction for all evaluation types.
 * Optimized for Claude Haiku 4.5:
 * - Base system prompt ~450 tokens with 6 priority-ordered rules
 * - Type-specific addenda ~100-150 tokens each
 * - Compact user prompt format with labeled sections
 * - Total target: 1,500-2,200 input tokens per eval
 */

// --- Evaluation Types ---

export type EvalType =
  | "card_reward"
  | "shop"
  | "map"
  | "rest_site"
  | "event"
  | "card_removal"
  | "card_upgrade"
  | "relic_select"
  | "boss_briefing";

// --- Base System Prompt (~450 tokens, 6 rules) ---

const BASE_PROMPT = `You are an STS2 deck-building coach. Evaluate decisions against the player's win condition, not individual card power.

CORE RULES (priority order):
1. SKIP IS DEFAULT. A focused 12-15 card deck that draws key cards every fight beats a pile of good cards. Every add must advance the win condition or fix a critical gap.
2. ARCHETYPE FIRST. When locked, evaluate everything against the archetype. Off-archetype = skip even if individually strong. No lock yet = evaluate for front-loaded combat value.
3. DECK SIZE. At A0-A4: 16-22 cards is healthy, skip only genuinely bad/off-archetype cards. At A5+: over 15 cards be selective, over 20 skip most.
4. ENERGY COST. 2-cost in 3-energy deck = 67% of your turn. Always weigh cost vs available energy.
5. ACT TIMING. Act 1: damage + AoE to survive fights. Act 2: scaling for multi-enemy. Act 3: complete engine for boss.
6. BUILD GUIDE. When provided, it is authoritative. "Always pick" = strong picks. "Always skip" = skips. Once locked, only archetype cards or gap-fillers.

OUTPUT RULES:
- Only name cards already in the player's deck. Say "enables [archetype]" not "synergizes with [unowned card]."
- Thinking: 1-2 sentences analyzing deck's archetype, phase, and needs before evaluating.
- Reasoning: under 15 words. State tier reason only.
- Cards scaling with starter cards (Strikes/Defends) are F-tier — starters get removed.
- Second copy of a card = significant downside unless core engine piece.
- Respond in JSON only. Rankings MUST have exactly one entry per item, in listed order.
- Confidence: 90-100 clear pick, 70-89 solid, 40-69 close call, <40 uncertain.`;

// --- Type-Specific Addenda ---

const TYPE_ADDENDA: Record<string, string> = {
  card_reward: `
CARD REWARD:
- Exclusive choice: pick ONE or skip ALL.
- If none advance the win condition, skip. Skipping is correct more often than picking.
- Evaluate against current deck and archetype, not card power in vacuum.
- Include a pick_summary: "Pick [name] — [reason]" or "Skip — [reason]". Max 15 words.`,

  shop: `
SHOP:
- Card removal is high priority if Strikes/Defends remain. Keep 75g reserve for removal.
- Relics are permanent power — an archetype-enabling relic is almost always the top purchase.
- Each item evaluated independently (not exclusive). Include spending_plan for affordable items only.
- Gold management: do not recommend spending below 75g unless buying a critical piece.`,

  map: `
MAP PATHING:
- Elites = relics = permanent power multipliers. Early relics benefit 30+ fights. Prioritize elite paths.
- Act 1: elites at >50% HP with front-loaded damage. Aim for 2 elites.
- Act 2: elites at >60% HP if deck has AoE. 1-2 elites.
- Act 3: elites only if deck is strong AND HP >60%. Boss prep > greed.
- Unknown/Event nodes: safer than Monster with comparable+ rewards. Prefer Unknown over Monster.
- Shops: high value at 150g+. Below 75g with no starters left = skip.
- Budget ~20 HP per remaining fight. If HP minus (fights * 20) < 0 before boss, too aggressive.`,

  rest_site: `
REST SITE — UPGRADE IS DEFAULT:
- Dig (if available): best option. Skip only at <30% HP before boss.
- Smith: name the best upgrade target. Priority: win-condition scaler > most-played card > AoE > power.
- Rest: ONLY when effective HP <40% (or <50% if elite/boss next). You die from weak decks, not chip damage.
- Already-upgraded cards (with +) cannot be upgraded again.`,

  event: `
EVENT:
- HP loss: only take if reward advances win condition AND HP >60%.
- Curse: avoid unless reward is exceptional AND removal available soon.
- Gold: only valuable if shop is coming AND you need something from it.
- Card transform: only if transforming a Strike/Defend.
- Max HP: always valuable at higher ascension.`,

  card_removal: `
CARD REMOVAL:
- Recommend ONE card. Strikes first (worst damage/card), then Defends, then off-archetype.
- Cards marked ETERNAL cannot be removed.`,

  card_upgrade: `
CARD UPGRADE:
- Recommend ONE card from the upgradeable list ONLY. Cards with + cannot be upgraded.
- Priority: win-condition scaler > most-played card > AoE > power.`,

  relic_select: `
BOSS RELIC:
- Permanent, run-defining choice. Evaluate which relic best supports the archetype and win condition.
- Include pick_summary: "Pick [name] — [reason]".`,

  boss_briefing: `
BOSS STRATEGY:
- Based ONLY on boss move data and player's deck. Do not invent moves.
- 2-3 sentence strategy focusing on what matters for THIS deck against THIS boss.`,
};

// --- System Prompt Builder ---

export function buildSystemPrompt(type: EvalType): string {
  const addendum = TYPE_ADDENDA[type] ?? "";
  return `${BASE_PROMPT}${addendum}`;
}

// --- Compact Context Builder ---

/**
 * Build compact game context for Haiku (~350 tokens vs ~900 for full).
 * Uses labeled [Section] headers that Haiku parses reliably.
 */
export function buildCompactContext(ctx: EvaluationContext): string {
  const hpPct = Math.round(ctx.hpPercent * 100);

  // Compact deck: group duplicates, abbreviate descriptions
  const cardCounts = new Map<string, { count: number; desc: string; keywords: string[] }>();
  for (const c of ctx.deckCards) {
    const existing = cardCounts.get(c.name);
    if (existing) {
      existing.count++;
    } else {
      const kwNames = (c.keywords ?? []).map((k) => k.name.toLowerCase());
      const tags: string[] = [];
      if (kwNames.includes("exhaust")) tags.push("Exhaust");
      if (kwNames.includes("innate")) tags.push("Innate");
      if (kwNames.includes("retain")) tags.push("Retain");
      if (kwNames.includes("eternal")) tags.push("ETERNAL");

      // Compress description: keep first 80 chars, preserve numbers and keywords
      const shortDesc = c.description.length > 80
        ? c.description.slice(0, 77) + "..."
        : c.description;

      cardCounts.set(c.name, {
        count: 1,
        desc: shortDesc,
        keywords: tags,
      });
    }
  }

  const deckStr = [...cardCounts.entries()]
    .map(([name, info]) => {
      const prefix = info.count > 1 ? `${info.count}x ` : "";
      const tags = info.keywords.length > 0 ? ` [${info.keywords.join(",")}]` : "";
      return `${prefix}${name}${tags}`;
    })
    .join(", ");

  const relicStr = ctx.relics.length > 0
    ? ctx.relics.map((r) => {
        // Compress relic description to key effect
        const short = r.description.length > 40
          ? r.description.slice(0, 37) + "..."
          : r.description;
        return `${r.name} (${short})`;
      }).join(", ")
    : "none";

  const archStr = ctx.archetypes.length > 0
    ? ctx.archetypes.slice(0, 2).map((a) => `${a.archetype} ${a.confidence}%`).join(", ")
    : "none detected";

  const lines = [
    `[State] ${ctx.character} | Act ${ctx.act} F${ctx.floor} | HP ${hpPct}% | ${ctx.energy}E | ${ctx.gold}g`,
    `[Deck ${ctx.deckSize}] ${deckStr}`,
    `[Draw] ${ctx.drawSources.length > 0 ? ctx.drawSources.join(", ") : "none"} | [Scaling] ${ctx.scalingSources.length > 0 ? ctx.scalingSources.join(", ") : "none"} | [Curses] ${ctx.curseCount}`,
    `[Relics] ${relicStr}`,
    ...(ctx.potionNames.length > 0 ? [`[Potions] ${ctx.potionNames.join(", ")}`] : []),
    `[Archetype] ${archStr}`,
  ];

  // Ascension note — brief, ascension-aware
  if (ctx.ascension > 0) {
    if (ctx.ascension <= 4) {
      lines.push(`[A${ctx.ascension}] Be permissive — take more cards, fights are easier`);
    } else if (ctx.ascension <= 7) {
      lines.push(`[A${ctx.ascension}] Standard difficulty`);
    } else {
      lines.push(`[A${ctx.ascension}] Be strict — deck purity critical, fights are brutal`);
    }
  }

  return lines.join("\n");
}

// --- Compact Character Strategy ---

/**
 * Extract just the pick/skip lists from the full character strategy.
 * For card/shop evals where the full strategy is too verbose.
 */
export function compactStrategy(fullStrategy: string | null): string | null {
  if (!fullStrategy) return null;

  const lines = fullStrategy.split("\n");
  const sTier = lines.find((l) => l.toLowerCase().includes("s-tier") || l.toLowerCase().includes("always strong") || l.toLowerCase().includes("always good"));
  const skipList = lines.find((l) => l.toLowerCase().includes("always skip"));
  const principle = lines.find((l) => l.toLowerCase().includes("key principle"));

  if (!sTier && !skipList && !principle) return null;

  const parts: string[] = [];
  if (sTier) parts.push(sTier.trim());
  if (skipList) parts.push(skipList.trim());
  if (principle) parts.push(principle.trim());
  return parts.join("\n");
}

// --- Compact Boss Reference ---

/**
 * Compress boss reference to ~30 tokens.
 */
export function compactBossReference(fullReference: string | null): string | null {
  if (!fullReference) return null;

  // Already formatted as "BossName (HP): move1, move2..."
  // Just take the boss names and key threat type
  const lines = fullReference.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;

  const compact = lines.map((line) => {
    const nameMatch = line.match(/^(.+?)\s*\(/);
    return nameMatch ? nameMatch[1].trim() : line.slice(0, 20);
  });

  return `[Bosses] ${compact.join(", ")}`;
}

// --- Item Formatting ---

export interface EvalItem {
  id: string;
  name: string;
  description: string;
  cost?: number;
  type?: string;
  rarity?: string;
}

/**
 * Format items for evaluation. Items go LAST in the prompt (Haiku recency bias).
 */
export function formatItems(
  items: EvalItem[],
  label: string = "Evaluate"
): string {
  const itemsStr = items
    .map((item, i) => {
      const parts = [item.name];
      if (item.cost != null) parts.push(`${item.cost}E`);
      if (item.type) parts.push(item.type);
      if (item.rarity) parts.push(item.rarity);
      return `${i + 1}. ${parts.join(", ")} — ${item.description}`;
    })
    .join("\n");

  return `${label}:\n${itemsStr}`;
}
