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
- ENCHANTED CARDS: Ancient events transform deck cards into stronger versions (e.g., Bash → Break). Evaluate the card by its DESCRIPTION, not its name. A card that "applies Vulnerable" IS a Vulnerable card regardless of its name.
- READ DESCRIPTIONS: Always check what a card actually does. If the description mentions Vulnerable, Block, Strength, Draw, Exhaust, etc., that card supports those archetypes.

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
- ACT 1 PHILOSOPHY: Prioritize STANDALONE VALUE over archetype speculation. The biggest Act 1 risk is not having quality cards. Take cards that are strong on their own — good damage, good block, good draw. Do NOT take speculative archetype pieces that need other cards to function (e.g., a scaling power with no way to survive long enough to use it). Only commit to an archetype when a keystone card appears — UNTIL THEN do not select supporting pieces that don't provide immediate value.
- Act 2+: Evaluate against current deck and archetype. Skip if none advance the win condition.
- Include a pick_summary: "Pick [name] — [reason]" or "Skip — [reason]". Max 15 words.`,

  shop: `
SHOP:
- Default priority: card removal > relic > card > potion.
- Removal is high priority if Strikes/Defends/curses remain. Evaluate against the actual removal cost shown.
- Early removals (75-100g) are almost always correct. Later removals (125g+) compete with relics for value.
- Exception: Membership Card and Orange Pellets are auto-buys — spend to 0 for these.
- Relics are permanent power — but only beat removal when deck has <=2 basic cards remaining.
- Discounted cards (50% off) have a much lower purchase bar. Colorless cards are shop-exclusive — evaluate favorably if they fit the archetype.
- Potions: buy only with open slots, when potion answers an upcoming elite/boss, and gold covers removal + potion cost.
- Act 1: removal focus. Save remaining gold for Act 2 shops (best card options appear there).
- Act 2: peak shop value — removal + relics + build-defining rares all high priority.
- Act 3: spend ALL gold. Buy potions for the boss fight if slots open. Gold is worthless after the final boss.
- Each item evaluated independently. Include spending_plan for affordable items only.`,

  map: `
MAP PATHING — CORE: Balance relic acquisition against deck development and HP preservation.
- Treasure nodes = free relic = always high priority (zero HP cost).
- Act 1: PRIORITIZE MONSTER FIGHTS for card rewards. More fights = more card selections = value density. The biggest Act 1 risk is reaching the boss without quality cards.
- Act 2+: Unknown/Event nodes are safer than Monster and can give relics/transforms/gold. Prefer over Monster.
- Shops: high value at 150g+ (can buy relic or remove). Route to shop when gold >= removal cost AND deck has removal targets.
- Rest sites: you get ONE action per visit — heal OR upgrade, never both. Card upgrades compound over the entire run (~3-5 HP saved per fight). Prioritize upgrades when healthy.
- ELITE COST: fighting an elite means the next rest site is spent healing instead of upgrading. One elite = one lost upgrade. An upgrade compounds value every remaining fight — a random relic may not.
- ELITE PHILOSOPHY by act:
  - Act 1: Be cautious. Consider 1-2 elites when HP > 60% and a rest site follows. The relic compounds power across all remaining fights, but the HP cost forces healing instead of upgrading — weigh the tradeoff.
  - Act 2: Peak window. Deck should handle elites efficiently with less HP loss, making the relic worth the cost.
  - Act 3: Selective only. Boss preparation matters more than another relic. Avoid unless very healthy.
- Budget ~25 HP per remaining fight for safety (elites cost ~30-50 HP at high ascension).`,

  rest_site: `
REST SITE:
- Upgrade is almost always correct. An upgraded key card compounds value every remaining fight (~3-5 HP prevented per fight). Healing is a one-time HP gain.
- HP is a resource, not a score. HP above 1 is spendable.
- Smith: name the best upgrade target. Priority: win-condition scaler > most-played card > AoE > power.
- Dig (if available): best option unless HP critically low before boss.
- Rest (heal) ONLY when: elite within 2 nodes AND HP < 60%, OR boss within 3 nodes AND HP < 70%, OR no upcoming threats AND HP < 40%.
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

// --- Co-Op Addenda (appended when multiplayer) ---

const COOP_BASE = `

CO-OP RULES (2-3 players): Block is per-player — you MUST defend yourself; teammates' Block does not protect you. Debuffs applied by ANY player benefit ALL. Team synergy: if a teammate handles debuffs, prioritize damage/scaling. If teammates are damage-focused, prioritize debuff application and Block.`;

const COOP_ADDENDA: Record<string, string> = {
  card_reward: `
CO-OP: Debuffs (Vulnerable, Weak) are TOP PRIORITY — one player applying Vulnerable makes ALL teammates deal 50% more. Co-op exclusive cards (ally Block transfer, shared energy, attack redirect) appear ONLY in multiplayer — prioritize them. Role specialization: coordinate roles across 2-3 players (damage, debuff, defense). Card resolution is sequential — debuffs must be played BEFORE damage cards for full team benefit.`,

  shop: `
CO-OP: Gold is per-player, no sharing. Shop stock is shared — all players can buy the same item independently. Throwing potions (target allies) are higher value in co-op. Coordinate to avoid redundant relic purchases.`,

  map: `
CO-OP: Enemy HP and damage scale with player count (50-80% per extra player). Treasure chests drop one relic per player — route through treasures aggressively. Path aggression gated by WEAKEST player's survivability. If a player dies in combat, they auto-revive at 1 HP after the team wins. Map path decided by voting — ties broken randomly.`,

  rest_site: `
CO-OP: Mend heals a teammate for 30% of their max HP (costs YOUR rest site action). If a teammate died in combat and auto-revived at 1 HP, Mend them. Revive resurrects a dead ally but costs a portion of YOUR MAX HP permanently — heavy sacrifice. Coordinate: one player Mends the lowest-HP teammate, others Smith.`,

  event: `
CO-OP: Most events give each player individual choices with individual consequences. Some events have shared consequences decided by group vote (ties broken randomly). For HP-cost events, factor the team's total HP budget — a teammate may need to Mend you at the next rest site.`,
};

// --- System Prompt Builder ---

export function buildSystemPrompt(type: EvalType, isMultiplayer = false): string {
  const addendum = TYPE_ADDENDA[type] ?? "";
  const coopBase = isMultiplayer ? COOP_BASE : "";
  const coopAddendum = isMultiplayer ? (COOP_ADDENDA[type] ?? "") : "";
  return `${BASE_PROMPT}${coopBase}${addendum}${coopAddendum}`;
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

  // Teammate info (multiplayer only — supports 2-3 player co-op)
  if (ctx.isMultiplayer && ctx.teammates?.length) {
    for (const t of ctx.teammates) {
      const hp = t.hpPercent != null ? ` | HP ${Math.round(t.hpPercent * 100)}%` : "";
      const relicStr = t.relics?.length ? ` | Relics: ${t.relics.map((r) => r.name).join(", ")}` : "";
      lines.push(`[Teammate] ${t.character}${hp}${relicStr}`);
    }
  }

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
      },
      required: ["rankings", "overall_advice"],
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
