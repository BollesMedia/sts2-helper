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

const BASE_PROMPT = `You are an STS2 deck-building coach. Evaluate decisions against the player's current deck needs, not individual card power.

CORE RULES (priority order):
1. DECK SIZE BY ASCENSION. At A0-A4: take good cards freely — 18-25 cards is healthy, skip only genuinely bad or off-archetype cards. At A5-A9: 15-20 cards, be more selective. At A10+: 14-18 cards, skip aggressively. A thin deck with no tools loses to encounters it can't answer.
2. ARCHETYPE FIRST. When locked, evaluate against the archetype. Off-archetype = skip unless it fills a critical gap (AoE, block, draw). No lock yet = evaluate for front-loaded combat value.
3. ACT TIMING. Act 1: damage + AoE to survive fights — take most decent cards. Act 2: scaling for multi-enemy encounters. Act 3: complete engine for boss — be selective.
4. ENERGY COST. 2-cost in 3-energy deck = 67% of your turn. Always weigh cost vs available energy.
5. BUILD GUIDE. When provided, it is authoritative. "Always pick" / "S-tier" = strong picks. "Always skip" = skips. Once locked, prefer archetype cards or gap-fillers.
6. DUPLICATES. Second copy of a core engine card (draw, scaling, key damage) is GOOD. Second copy of a mediocre card is bad. Evaluate duplicates by card quality, not by being a duplicate.

GAME FACTS:
- STS2 has 3 acts. There is no Act 4. Gold is worthless after the Act 3 boss.
- Unplayable and Curse cards are always the #1 removal priority, above Strikes.
- Relics are vital for clearing Act 3 — maximize relic acquisition opportunities (elites, treasures, events).

OUTPUT RULES:
- Only name cards already in the player's deck. Say "enables [archetype]" not "synergizes with [unowned card]."
- Reasoning: under 15 words. State tier reason only.
- Respond in JSON only. Rankings MUST have exactly one entry per item, in listed order.
- Confidence: 90-100 clear pick, 70-89 solid, 40-69 close call, <40 uncertain.`;

// --- Type-Specific Addenda ---

const TYPE_ADDENDA: Record<string, string> = {
  card_reward: `
CARD REWARD:
- Exclusive choice: pick ONE or skip ALL.
- Evaluate against current deck and archetype, not card power in vacuum.
- At A0-A4 early acts: lean toward picking — most decent cards make the deck better. Skip only genuinely bad or off-archetype cards.
- At A5+ or late game: skip if none advance the win condition.
- Include a pick_summary: "Pick [name] — [reason]" or "Skip — [reason]". Max 15 words.`,

  shop: `
SHOP:
- Card removal is high priority if Strikes/Defends remain. Keep 75g reserve for removal.
- Relics are permanent power — an archetype-enabling relic is almost always the top purchase.
- Each item evaluated independently (not exclusive). Include spending_plan for affordable items only.
- Gold management: do not recommend spending below 75g unless buying a critical piece.
- In Act 3: spend ALL gold. It has zero value after the final boss.`,

  map: `
MAP PATHING — CORE: Maximize relics while keeping HP high. Relics win Act 3. Cards come naturally.
- Relic sources (elite, treasure, mystery/event) are the highest-value nodes. Prefer paths with MORE relic opportunities.
- RestSite → Elite is the IDEAL elite path: heal/upgrade then fight for a relic.
- Treasure nodes = free relic = always high priority.
- Unknown/Event nodes: safer than Monster, can give relics/transforms/gold. Prefer over Monster.
- Shops: high value at 150g+ (can buy relic or remove). Route to shop when gold >= removal cost AND deck has removal targets.
- Rest sites: critical for HP preservation. Paths with rest sites before elite/boss are safer.
- At high ascension: sometimes you MUST take risky elite paths to accumulate enough relics to clear Act 3. Factor whether the run can win without more relics.
- Budget ~20 HP per remaining fight for safety.`,

  rest_site: `
REST SITE:
- Dig (if available): best option unless HP critically low before boss.
- Smith: name the best upgrade target. Priority: win-condition scaler > most-played card > AoE > power.
- Rest: when HP is low relative to upcoming threats. Elite within 2 nodes: heal at <75% HP. Boss within 3 nodes: heal at <80% HP. Otherwise heal at <40% HP.
- SURVIVAL > OPTIMIZATION when elite or boss is near. A dead run gets zero value from upgrades.
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

  const starterCards = new Set(["strike", "defend"]);
  const deckStr = [...cardCounts.entries()]
    .map(([name, info]) => {
      const prefix = info.count > 1 ? `${info.count}x ` : "";
      const tags = info.keywords.length > 0 ? ` [${info.keywords.join(",")}]` : "";
      // Include short description for non-starter cards so Claude knows what they do
      const isStarter = starterCards.has(name.toLowerCase());
      const desc = !isStarter && info.desc
        ? ` (${info.desc.slice(0, 30).trim()}${info.desc.length > 30 ? "..." : ""})`
        : "";
      return `${prefix}${name}${desc}${tags}`;
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
 * Extract archetype names + pick/skip lists from the full character strategy.
 * Keeps archetype headers (numbered lines) so Claude knows what builds exist,
 * plus S-tier, always-skip, and key principle lines.
 */
export function compactStrategy(fullStrategy: string | null): string | null {
  if (!fullStrategy) return null;

  const lines = fullStrategy.split("\n");
  const parts: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    // Keep archetype header lines (e.g., "1. EXHAUST ENGINE (strongest): ...")
    // These start with a digit followed by a period
    if (/^\d+\.\s+/.test(trimmed)) {
      parts.push(trimmed);
      continue;
    }

    // Keep S-tier, always-skip, and key principle lines
    if (
      lower.includes("s-tier") ||
      lower.includes("always strong") ||
      lower.includes("always skip") ||
      lower.includes("key principle")
    ) {
      parts.push(trimmed);
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
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

// --- Tool Schemas for freeform eval types ---

/**
 * Build a tool schema for map/event/rest/etc evaluations.
 * Replaces fragile freeform JSON parsing with structured tool_use output.
 */
export function buildMapToolSchema(optionCount: number) {
  return {
    name: "submit_map_evaluation",
    description: `Evaluate ${optionCount} path options. Return exactly ${optionCount} rankings.`,
    input_schema: {
      type: "object" as const,
      properties: {
        rankings: {
          type: "array",
          description: `Exactly ${optionCount} entries, one per path option in order.`,
          items: {
            type: "object",
            properties: {
              option_index: { type: "integer", description: "Path option number (1-indexed)" },
              node_type: { type: "string", description: "First node type on this path" },
              tier: { type: "string", enum: ["S", "A", "B", "C", "D", "F"] },
              confidence: { type: "integer", description: "0-100" },
              recommendation: { type: "string", enum: ["strong_pick", "good_pick", "situational", "skip"] },
              reasoning: { type: "string", description: "Max 15 words about the WHOLE path." },
            },
            required: ["option_index", "tier", "confidence", "reasoning"],
          },
        },
        overall_advice: { type: "string", description: "Max 15 words overall pathing strategy." },
        recommended_path: {
          type: "array",
          description: "Full recommended route from current position to boss. Array of {col, row} node coordinates in order, starting from the recommended next option through to the boss.",
          items: {
            type: "object",
            properties: {
              col: { type: "integer" },
              row: { type: "integer" },
            },
            required: ["col", "row"],
          },
        },
      },
      required: ["rankings", "overall_advice", "recommended_path"],
    },
  };
}

export function buildGenericToolSchema(description: string) {
  return {
    name: "submit_evaluation",
    description,
    input_schema: {
      type: "object" as const,
      properties: {
        rankings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item_id: { type: "string" },
              rank: { type: "integer" },
              tier: { type: "string", enum: ["S", "A", "B", "C", "D", "F"] },
              synergy_score: { type: "integer" },
              confidence: { type: "integer" },
              recommendation: { type: "string", enum: ["strong_pick", "good_pick", "situational", "skip"] },
              reasoning: { type: "string", description: "Max 15 words." },
            },
            required: ["item_id", "tier", "confidence", "reasoning"],
          },
        },
        pick_summary: { type: "string", description: "Max 15 words." },
        skip_recommended: { type: "boolean" },
        skip_reasoning: { type: "string" },
        overall_advice: { type: "string" },
      },
      required: ["rankings"],
    },
  };
}

export function buildSimpleToolSchema() {
  return {
    name: "submit_recommendation",
    description: "Submit a single card recommendation",
    input_schema: {
      type: "object" as const,
      properties: {
        card_name: { type: "string", description: "Exact card name to recommend" },
        reasoning: { type: "string", description: "Max 15 words." },
      },
      required: ["card_name", "reasoning"],
    },
  };
}
