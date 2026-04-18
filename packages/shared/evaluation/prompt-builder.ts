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
  | "ancient"
  | "card_removal"
  | "card_upgrade"
  | "card_select"
  | "relic_select"
  | "boss_briefing";

// --- Base System Prompt (~450 tokens, 6 rules) ---

const BASE_PROMPT = `You are an STS2 deck-building coach. Evaluate decisions against the player's current deck needs, not individual card power.

CORE RULES (priority order):
1. DECK SIZE BY ASCENSION. At Ascension 0-4: take good cards freely — 18-25 cards is healthy, skip only genuinely bad or off-archetype cards. At Ascension 5-9: 15-20 cards, be more selective. At Ascension 10+: 14-18 cards, skip aggressively. A thin deck with no tools loses to encounters it can't answer.
2. ARCHETYPE FIRST. When locked, evaluate against the archetype. Off-archetype = skip unless it fills a critical gap (AoE, block, draw). No lock yet = evaluate for front-loaded combat value.
3. ACT TIMING. Act 1: damage + AoE to survive fights — take most decent cards. Act 2: scaling for multi-enemy encounters. Act 3: complete engine for boss — be selective.
4. ENERGY COST. 2-cost in 3-energy deck = 67% of your turn. Always weigh cost vs available energy.
5. BUILD GUIDE. When provided, it is authoritative. "Always pick" / "S-tier" = strong picks. "Always skip" = skips. Once locked, prefer archetype cards or gap-fillers.
6. DUPLICATES. Second copy of a core engine card (draw, scaling, key damage) is GOOD. Second copy of a mediocre card is bad. Evaluate duplicates by card quality, not by being a duplicate.

GAME FACTS:
- STS2 has 3 acts. There is no Act 4.
- Unplayable and Curse cards are always the #1 removal priority, above Strikes.
- Relics are vital for clearing Act 3 — maximize relic acquisition opportunities (elites, treasures, events).
- ENCHANTED CARDS: Ancient events transform deck cards into stronger versions (e.g., Bash → Break). Evaluate the card by its DESCRIPTION, not its name. A card that "applies Vulnerable" IS a Vulnerable card regardless of its name.
- READ DESCRIPTIONS CAREFULLY: A card only has a keyword (Exhaust, Retain, Innate, etc.) if the description explicitly says so OR it has a [keyword] tag. Do NOT assume a card exhausts, retains, or has other keywords unless stated. "Gain 16 Block" does NOT mean the card exhausts.
- TARGET SCOPE: "Deal X damage" with no explicit "to ALL enemies" / "to each enemy" / "to all" language is SINGLE-TARGET. Examples: "Deal 10 damage" is single-target. "Deal 9 damage to ALL enemies" is AoE. Do NOT describe a single-target attack as AoE, multi-target, "hits all", or imply it damages multiple enemies. Only claim AoE when the description literally says so. This rule overrides any memory of how a similarly-named STS1 card behaved.
- SYNERGY CLAIMS: Only claim a synergy if you can explain the EXACT mechanical interaction. "Pairs with Dark Embrace" is only valid if the card actually has Exhaust. Block cards do NOT trigger exhaust synergies unless they explicitly say "Exhaust."
- UNKNOWN ITEMS: STS2 has many items that did not exist in STS1. If you don't recognize a card, relic, or event option — evaluate ONLY based on the description provided. Do NOT invent mechanics or effects. If the description is insufficient to evaluate, set confidence below 40 and say "Unknown item — evaluating from description only" in your reasoning. NEVER fabricate what an item does.

OUTPUT RULES:
- Reasoning MUST describe the card's actual mechanics as written. Do NOT invent target scope, keywords, AoE-ness, or effects that aren't in the description. If you claim a property (AoE, Exhaust, scaling, etc.), that property must appear literally in the card's description text.
- Only name deck cards that DIRECTLY interact with the evaluated card. "Fuels Body Slam" is valid (Body Slam uses block). "Pairs with Dark Embrace" is ONLY valid if the card exhausts. Do NOT list deck cards just because they exist.
- Reasoning: under 20 words. State the mechanical reason for the tier, not a list of deck cards.
- Respond in JSON only. Rankings MUST have exactly one entry per item, in listed order.
- Confidence: 90-100 clear pick, 70-89 solid, 40-69 close call, <40 uncertain.`;

// --- Map Pathing Reasoning Scaffold ---

export const MAP_PATHING_SCAFFOLD = `
Before ranking the candidate paths, reason step-by-step:

1. RISK CAPACITY: restate the buffer number and verdict from RUN STATE in your
   own words. Is this a run that can push for elites, or needs to consolidate?
2. ACT GOAL: one sentence. What should remaining floors accomplish?
   (e.g., "heal to 70%+ before pre-boss rest; take 1 more elite only if HP
   recovery aligns")
3. KEY BRANCHES: identify 1–3 floors where the decision is non-obvious.
   A close call is NOT a failure — say so explicitly and set close_call=true.

Then produce the output. Do not restate game rules; the RUN STATE block already
computed them. Your job is judgment under the specific run state, not general
theory.

Branch recommendations may be conditional, e.g.:
  "Elite IF HP ≥ 55 at f28, else Monster"

teaching_callouts should pick 1–4 patterns from the CANDIDATE PATHS facts that
the player would benefit from understanding — not every pattern, just the
pedagogically useful ones for this path.
`.trim();

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
MAP PATHING — GOAL SHAPING: The RUN STATE block quantifies risk, budgets, and thresholds for this specific run. Do NOT restate those rules; apply them.
- Treasure nodes = free relic = always high priority (zero HP cost).
- Act 1 philosophy: card acquisition density. Monster fights produce card rewards, and a thin low-quality deck is the biggest Act 1 risk. Prefer fights that yield picks over HP preservation for its own sake.
- Act 2 philosophy: peak window for elites, shops, and event gambles. Your deck should be able to convert HP into permanent power here (relics, removals, scaling). Push for density.
- Act 3 philosophy: boss preparation dominates. Seek upgrades, finish the engine, and avoid unnecessary HP spend. Extra elites/relics only if clearly safe.
- General: seek upgrades before more fights when HP is consolidated; prefer permanent power (relics, removals, upgrades) over transient gold/heal when the run state allows.`,

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
- Card transform: only if transforming a Strike/Defend.
- Max HP: always valuable at higher ascension.
- RANDOM EFFECTS: If an option says "random" (e.g., "upgrade 2 random cards"), the player does NOT choose which cards are affected. Do NOT name specific cards that will be upgraded/transformed/removed. Evaluate random effects by expected value across the whole deck, not by cherry-picking best targets.`,

  ancient: `
ANCIENT EVENT:
- You MUST choose exactly one option. Evaluate all three against your current deck needs, act timing, and ascension.
- OPTION CATEGORIES — identify each option's category tag and apply the matching framework:
  - CARD REMOVAL (remove N cards): High priority when Strikes/Defends remain. Value decreases as deck thins. In Acts 1-2, removal is almost always the best option.
  - GOLD TRADE (lose/gain gold): Gold buys card removal (75-100g), relics, and potions at shops. Evaluate gold loss against remaining shop opportunities. Losing 99g at Act 1 is significant — that is one card removal. Gaining 150-300g is strong if shops remain.
  - TRANSFORM (transform N cards): Strong when transforming Strikes/Defends into random cards. Risky when transforming engine cards. Transform + upgrade is premium.
  - MAX HP (raise max HP by N): Scales with ascension — more valuable at Ascension 8+. Always solid, never bad.
  - RELIC (obtain random relic/specific relic): Permanent power. High priority unless the specific relic has a downside (curse, HP loss, boss relics with drawbacks).
  - ENCHANTMENT (enchant cards with X): Archetype-dependent. Evaluate the enchantment effect against current deck composition. Strong when it enhances core cards.
  - CARD ADD (add specific cards): Evaluate added cards the same as a card reward — do they advance the deck's win condition?
  - HP TRADE (lose HP/Max HP for reward): Only take if reward is high-value AND current HP can absorb the cost safely.
- Evaluate based on DESCRIPTIONS PROVIDED. Do not assume you know what an enchantment, relic, or card does beyond what the description says.
- If unsure about an option's effect, set confidence below 50.
- Reasoning must reference the specific trade-off: what you gain vs what you lose.`,

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

// --- Mechanic Summary ---

/**
 * Scan deck card descriptions for key mechanics and build a summary line.
 * Helps Haiku understand what the deck can do without reading every description.
 */
function buildMechanicSummary(
  deckCards: { name: string; description: string }[]
): string {
  const vulnerableSources: string[] = [];
  const weakSources: string[] = [];
  const exhaustSources: string[] = [];
  const blockSources: string[] = [];
  const aoeCards: string[] = [];

  const seen = new Set<string>();
  for (const c of deckCards) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    const lower = c.description.toLowerCase();
    if (lower.includes("vulnerable")) vulnerableSources.push(c.name);
    if (lower.includes("weak") && !lower.includes("weakness")) weakSources.push(c.name);
    if (lower.includes("exhaust")) exhaustSources.push(c.name);
    if (lower.includes("all enemies") || lower.includes("all enemy")) aoeCards.push(c.name);
    if (/gain \d+ block/i.test(c.description) || /\d+ block/i.test(c.description)) blockSources.push(c.name);
  }

  const parts: string[] = [];
  if (vulnerableSources.length > 0) parts.push(`Vulnerable: ${vulnerableSources.join(", ")}`);
  if (weakSources.length > 0) parts.push(`Weak: ${weakSources.join(", ")}`);
  if (exhaustSources.length > 0) parts.push(`Exhaust: ${exhaustSources.join(", ")}`);
  if (aoeCards.length > 0) parts.push(`AoE: ${aoeCards.join(", ")}`);

  return parts.length > 0
    ? `[Deck mechanics] ${parts.join(" | ")}`
    : "[Deck mechanics] none detected";
}

// --- Compact Context Builder ---

/**
 * Build compact game context for Haiku (~350 tokens vs ~900 for full).
 * Uses labeled [Section] headers that Haiku parses reliably.
 */
export function buildCompactContext(ctx: EvaluationContext): string {
  const hpPct = Math.round(ctx.hpPercent * 100);

  // Compact deck: group duplicates, include type + keywords
  const cardCounts = new Map<string, { count: number; desc: string; type?: string; keywords: string[] }>();
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

      cardCounts.set(c.name, {
        count: 1,
        desc: c.description,
        type: "type" in c ? (c as { type: string }).type : undefined,
        keywords: tags,
      });
    }
  }

  const starterCards = new Set(["strike", "defend"]);
  const deckStr = [...cardCounts.entries()]
    .map(([name, info]) => {
      const prefix = info.count > 1 ? `${info.count}x ` : "";
      const allTags = [...(info.type ? [info.type] : []), ...info.keywords];
      const tags = allTags.length > 0 ? ` [${allTags.join(",")}]` : "";
      // Include full description for non-starter cards so Claude knows what they do
      const isStarter = starterCards.has(name.toLowerCase());
      const desc = !isStarter && info.desc ? ` (${info.desc})` : "";
      return `${prefix}${name}${desc}${tags}`;
    })
    .join(", ");

  const relicStr = ctx.relics.length > 0
    ? ctx.relics.map((r) => {
        // Compress relic description to key effect
        const short = r.description.length > 80
          ? r.description.slice(0, 77) + "..."
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
    buildMechanicSummary(ctx.deckCards),
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
      lines.push(`[Ascension ${ctx.ascension}] Be permissive — take more cards, fights are easier`);
    } else if (ctx.ascension <= 7) {
      lines.push(`[Ascension ${ctx.ascension}] Standard difficulty`);
    } else {
      lines.push(`[Ascension ${ctx.ascension}] Be strict — deck purity critical, fights are brutal`);
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
/**
 * Compact boss reference for the evaluation prompt.
 * Only includes the full reference for boss briefing evals —
 * for card/shop/map evals, boss distance is already in the context
 * and listing ALL boss names causes hallucinations (LLM references
 * wrong boss for the current act).
 */
export function compactBossReference(fullReference: string | null): string | null {
  // Don't include boss names in compact evals — causes hallucinations.
  // Boss distance is already communicated via map context / floor info.
  // Full boss data is only used by boss_briefing eval type.
  return null;
}
