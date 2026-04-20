import type { EvaluationContext } from "./types";

/**
 * Centralized prompt construction for all evaluation types.
 * Optimized for Claude Haiku 4.5.
 *
 * Structure (matters for prompt caching when it lands):
 * - BASE_PROMPT: stable across every eval of every type — hallucination
 *   guards first, then deck-building heuristics, then output rules.
 * - TYPE_ADDENDA[type]: stable per eval type.
 * - MAP_PATHING_SCAFFOLD / CARD_REWARD_SCAFFOLD: stable per eval type.
 * - User prompt carries the volatile runtime data (facts blocks, offers).
 * This ordering keeps the cacheable prefix maximal.
 *
 * Approximate sizes (tokens): BASE_PROMPT ~410, ancient addendum ~340
 * (largest), others ~30–140, MAP_PATHING_SCAFFOLD ~600,
 * CARD_REWARD_SCAFFOLD ~195.
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

// --- Base System Prompt ---
// Priority order: hallucination guards first (they prevent the most damaging
// failure mode), then deck-building heuristics. STS2 has 3 acts, Ascension
// cap is 10. STS1 mechanics are NOT STS2 mechanics — Haiku conflates them.

const BASE_PROMPT = `You are an STS2 deck-building coach. This is Slay the Spire 2; mechanics differ from STS1.

DESCRIPTION RULES — evaluate ONLY what the card/item description says.
- READ DESCRIPTIONS CAREFULLY. A card has a keyword (Exhaust, Retain, Innate, etc.) only if the description says so or shows a [keyword] tag. "Gain 16 Block" is NOT Exhaust.
- TARGET SCOPE. "Deal X damage" with no "to ALL enemies" / "to each enemy" / "to all" phrase is SINGLE-TARGET. "Deal 9 damage to ALL enemies" is AoE. Do NOT describe a single-target attack as AoE, multi-target, or "hits all". This overrides any memory of a similarly-named STS1 card.
- SYNERGY CLAIMS. Only claim a synergy you can explain mechanically. "Pairs with Dark Embrace" requires the card to have Exhaust. Only name deck cards that DIRECTLY interact with the evaluated item.
- UNKNOWN ITEMS. Many STS2 items did not exist in STS1. If you don't recognize one, evaluate ONLY from the description. NEVER fabricate effects. If the description is insufficient, set confidence below 0.40 and say "Unknown item — evaluating from description only".
- ENCHANTED CARDS. Ancient events can rename cards. Evaluate by description, not name.

DECK-BUILDING HEURISTICS.
1. ARCHETYPE FIRST. Once locked, evaluate against it; off-archetype = skip unless it fills a critical gap (AoE, block, draw). Unlocked = take front-loaded combat value.
2. DECK SIZE scales with Ascension. A0–4: 18–25 cards, be permissive. A5–8: 15–20, be selective. A9–10: 14–18, skip aggressively. A thin deck with no tools still loses.
3. ACT TIMING. Act 1: damage + AoE, take most decent cards. Act 2: scaling. Act 3: finish the engine for the boss.
4. ENERGY COST vs available energy — a 2-cost on 3-energy is 67% of a turn.
5. DUPLICATES are good for core engine pieces, bad for mediocre cards. Judge the underlying card, not the duplicate-ness.
6. REMOVAL priority: Unplayable + Curse > Strike > Defend > off-archetype. Relics are vital for Act 3; maximize elite/treasure/event opportunities.
7. BUILD GUIDE, when provided, is authoritative. "Always pick" = strong; "Always skip" = skip.

OUTPUT RULES.
- Reasoning MUST cite mechanics literally present in the description. Do NOT invent target scope, keywords, AoE-ness, or effects. If you claim a property (AoE, Exhaust, scaling), it must appear in the description text.
- Reasoning ≤ 20 words. State the mechanical reason for the tier.
- Rankings: exactly one entry per offered item, in listed order.
- confidence is a float 0.0–1.0. >0.90 clear, 0.70–0.90 solid, 0.40–0.70 close call, <0.40 uncertain. Values outside [0,1] are clamped server-side.
- Return JSON only.`;

// --- Map Pathing Reasoning Scaffold ---
// Elite count is the load-bearing rule. 2 elites per act is the FLOOR — this
// survives because Haiku defaults to HP conservation and under-takes elites.
// Path selection rules are HARD: applied before the prose reasoning.

export const MAP_PATHING_SCAFFOLD = `
PATH SELECTION (hard rules — apply before reasoning).
Pick the path with the MOST elites that isn't CRITICAL HP_risk or EXCEEDS_BUDGET. 2 elites per act is the FLOOR for every act, including Act 3 — elites drop relics, and at Ascension 10 the "Double Boss" finale makes relic density decisive. A 0-elite path with ABUNDANT or MODERATE risk_capacity is almost always wrong.

Tiebreakers, in order:
1. More elites.
2. Contains a REST→ELITE pair (rest absorbs elite damage). Two such pairs = gold standard.
3. HP_risk: SAFE > RISKY > CRITICAL.
4. fightBudget: WITHIN_BUDGET > TIGHT > EXCEEDS_BUDGET.

Only drop below 2 elites when every ≥2-elite alternative is CRITICAL HP_risk, or the map genuinely lacks them. Only pick EXCEEDS_BUDGET / CRITICAL when every alternative is equally bad — then surface the tradeoff in \`reasoning.act_goal\`.

REASONING STEPS.
1. risk_capacity: restate the RUN STATE verdict and HP buffer in your own words. Can this run push for elites or must it consolidate?
2. act_goal: one sentence. What should the remaining floors accomplish? Conditional goals are fine, e.g. "Take elite at f28 if HP ≥ 55, else monster."

SELF-CONSISTENCY. If act_goal mentions taking N elites, macro_path MUST contain ≥ N elite nodes. If they conflict, rewrite the goal to match the path.

MACRO_PATH FORMAT.
- Copy the chosen Path sequence from CANDIDATE PATHS verbatim — EVERY node from the chosen next-option through the act boss, inclusive. Partial paths break client highlighting.
- The FIRST floor is the chosen next-option node (NOT the player's current position).
- node_id is copied EXACTLY from the \`@col,row\` tokens (e.g., \`M@2,5\` → node_id "2,5"). Do NOT recompute coordinates.

KEY BRANCHES: 1–3 non-obvious decision points. Set close_call=true when it is one; that's not a failure state. Conditional recommendations are welcome ("Elite IF HP ≥ 55, else Monster").

TEACHING CALLOUTS: up to 4. Pick the patterns from CANDIDATE PATHS that are pedagogically useful for THIS path, not a complete list.

LENGTH.
- headline: 1 sentence. risk_capacity and act_goal: ≤ 2 sentences each.
- Branch decision: ≤ 10 words (a short question). recommended: ≤ 15 words. alternatives[].tradeoff: 1 sentence.
- teaching_callouts[].explanation: 1 sentence.

CAPS (server truncates extras): key_branches ≤ 3, teaching_callouts ≤ 4. confidence is a float in [0, 1] — out-of-range values are clamped.
`.trim();

// --- Card Reward Reasoning Scaffold ---

export const CARD_REWARD_SCAFFOLD = `
REASONING STEPS (the DECK STATE block has the facts; your job is judgment).
1. NEEDS: from DECK STATE, what does this deck need most — damage, block, scaling, removal, a keystone?
2. SKIP BAR: state the minimum tier/fit a pick must clear right now. Examples: "Skip unless A-tier", "B-tier only if on-archetype or fills the block gap."
3. ROLE: for each offered card, state its best-case role in THIS deck. Flag any \`dead_with_current_deck\` cards.
4. KEYSTONE OVERRIDE: if a keystone is offered and the deck supports its archetype, picking it may beat a higher raw tier — keystones unlock scaling. Say so explicitly.
5. DECIDE: apply the skip bar. If nothing clears it, set skip_recommended=true.

CAPS (server truncates extras): key_tradeoffs ≤ 3, teaching_callouts ≤ 3.
`.trim();

// --- Type-Specific Addenda ---

const TYPE_ADDENDA: Record<string, string> = {
  card_reward: `
CARD REWARD. Pick ONE or skip ALL (exclusive). In Act 1, prioritize raw card quality + landing a keystone. Act 2+, evaluate against the committed archetype. Act 3, only pick what helps the act 3 boss fight.
Include pick_summary: "Pick [name] — [reason]" or "Skip — [reason]" (≤ 15 words).`,

  shop: `
SHOP. Default priority: card removal > relic > card > potion. Evaluate each item independently; include spending_plan for affordable items only.
- Removal: strongly prefer early. Base cost 75g, +25g per use. Ascension 6 "Inflation" raises that to 100g start, +50g per use. Relic beats removal only when the deck has ≤ 2 basic cards left.
- Cards on 50% sale clear a much lower bar. Colorless cards are shop-exclusive — favor if on-archetype.
- Potions: only when a slot is open, the potion answers an imminent elite/boss, and gold still covers removal.
- Act 1: removal focus, save for Act 2's better cards. Act 2: peak shop — removal + relics + rares. Act 3: spend all gold; gold is worthless after the final boss.`,

  map: `
MAP PATHING. The RUN STATE block has risk, budgets, and thresholds — apply them, don't restate. Act-specific priorities:
- Treasure = free relic, always high priority.
- Act 1: card-acquisition density matters more than HP — a thin weak deck is Act 1's biggest risk.
- Act 2: peak window for elites + shops + event gambles. Convert HP into permanent power.
- Act 3: finish the engine via upgrades, but the 2-elite floor still applies. At Ascension 10 the "Double Boss" finale makes elite relics the decisive factor — don't conserve for a mythical safe lane.`,

  rest_site: `
REST SITE. Default actions: Rest (heal 30% max HP) and Forge (upgrade 1 card). Other actions only appear when a relic/event unlocks them.
- Forge is almost always correct — an upgraded key card compounds every remaining fight. Priority: win-condition scaler > most-played > AoE > power. Cards with + cannot be upgraded again.
- Rest only when: elite within 2 nodes and HP < 60%, OR boss within 3 and HP < 70%, OR no threats and HP < 40%. HP above 1 is spendable — it's a resource, not a score.`,

  event: `
EVENT.
- HP loss: only if reward advances the win condition AND HP > 60%.
- Curse: skip unless the reward is exceptional AND removal is available soon.
- Card transform: only if transforming a Strike/Defend.
- Max HP: always valuable, more so at higher ascension.
- RANDOM EFFECTS ("upgrade 2 random cards", "transform a random card"): the player does NOT choose targets. Do NOT name specific cards that "will" be affected — evaluate by expected value across the whole deck.`,

  ancient: `
ANCIENT EVENT. You MUST choose one of three options. Evaluate against deck needs, act timing, and ascension.
- IGNORE CURRENT HP. Ancients heal to full (100% of missing HP) at A0–1, or 80% of missing HP at A2+ ("Weary Traveler"). The player enters the next act near-full either way — do NOT let "low HP" or "survival" enter your reasoning.
- HP TRADE options: reason about the HP you enter the next fight with, not current HP. After the heal you start at (near-)max, so an HP cost comes out of (near-)max.
- Options typically fall in these categories — match the framework:
  - CARD REMOVAL: strongest in Acts 1–2 while Strikes/Defends remain. Value falls as the deck thins.
  - TRANSFORM: strong for Strike/Defend; risky for engine cards. Transform + upgrade is premium.
  - GOLD (lose/gain): weigh against remaining shops. Losing ~99g in Act 1 ≈ losing one removal. Gaining 150–300g is strong if shops remain.
  - MAX HP: always solid, scales with ascension.
  - RELIC: permanent power — high priority unless the specific relic carries a real drawback.
  - ENCHANTMENT: archetype-dependent; evaluate the effect against current deck.
  - CARD ADD: treat like a card reward — does it advance the win condition?
- Evaluate strictly from the descriptions. If an effect is unclear, set confidence < 0.50. Reasoning must state the specific tradeoff (what you gain vs what you give up).`,

  card_removal: `
CARD REMOVAL. Recommend ONE card. Priority: Strike (worst damage/card) > Defend > off-archetype. Cards tagged ETERNAL cannot be removed.`,

  card_upgrade: `
CARD UPGRADE. Recommend ONE card from the upgradeable list only (cards with + cannot be upgraded again). Priority: win-condition scaler > most-played > AoE > power.`,

  relic_select: `
BOSS RELIC. Permanent, run-defining. Evaluate fit to archetype and win condition. Include pick_summary: "Pick [name] — [reason]".`,

  boss_briefing: `
BOSS STRATEGY. Use ONLY the supplied boss move data and the player's deck — do not invent moves. 2–3 sentences focused on what matters for THIS deck vs THIS boss.`,
};

// --- Co-Op Addenda (appended when multiplayer) ---

const COOP_BASE = `

CO-OP RULES (2–3 players). Block is per-player — teammates' Block does not protect you. Debuffs from ANY player benefit ALL. If a teammate covers one role (debuffs, damage, defense), specialize in the others.`;

const COOP_ADDENDA: Record<string, string> = {
  card_reward: `
CO-OP: Debuffs (Vulnerable, Weak) are TOP priority — one player's Vulnerable gives the whole team +50% damage, but card resolution is sequential so debuffs must play BEFORE the damage cards they amplify. Co-op-exclusive cards (ally Block transfer, shared energy, attack redirect) appear only in multiplayer — prioritize if the role fits.`,

  shop: `
CO-OP: Gold is per-player; shop stock is shared (everyone can buy the same item independently). Throwing potions (target allies) gain value. Coordinate to avoid redundant relic purchases.`,

  map: `
CO-OP: Enemy HP and damage scale +50–80% per extra player. Treasure drops one relic per player — route through treasures aggressively. Path aggression is gated by the WEAKEST player. Dead players auto-revive at 1 HP after the team wins. Path chosen by vote; ties random.`,

  rest_site: `
CO-OP: Mend heals a teammate for 30% of their max HP at the cost of YOUR rest action — use on the player who auto-revived at 1 HP. Revive resurrects a dead ally but permanently costs a portion of YOUR max HP; treat as last resort.`,

  event: `
CO-OP: Most events give each player individual choices; a few are group votes (ties random). Budget HP costs against the team — a teammate may need to Mend you later.`,
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
    // STS2 Early Access caps at Ascension 10. Tier messaging is 1-3 / 4-7 / 8-10.
    if (ctx.ascension <= 3) {
      lines.push(`[Ascension ${ctx.ascension}] Be permissive — take more cards, fights are easier`);
    } else if (ctx.ascension <= 7) {
      lines.push(`[Ascension ${ctx.ascension}] Standard difficulty`);
    } else {
      lines.push(`[Ascension ${ctx.ascension}] Be strict — deck purity critical. At A10 expect the "Double Boss" Act 3 finale`);
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
