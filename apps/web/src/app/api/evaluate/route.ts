import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import type { EvaluationContext } from "@sts2/shared/evaluation/types";
import { buildPromptContext } from "@sts2/shared/evaluation/context-builder";
import {
  getStatisticalEvaluation,
  logEvaluation,
  parseClaudeCardRewardResponse,
  parseToolUseInput,
} from "@sts2/shared/evaluation/evaluation-service";
import { tierToValue } from "@sts2/shared/evaluation/tier-utils";
import { getRunHistoryContext } from "@/evaluation/run-history-context";
import { logUsage } from "@/lib/usage-logger";
import { requireAuth } from "@/lib/api-auth";
import { getCharacterStrategy } from "@/evaluation/strategy/character-strategies";

const anthropic = new Anthropic();

// Compact boss reference for Claude — loaded once, shared via Promise
let bossReferencePromise: Promise<string> | null = null;

function getBossReference(): Promise<string> {
  if (!bossReferencePromise) {
    bossReferencePromise = loadBossReference();
  }
  return bossReferencePromise;
}

async function loadBossReference(): Promise<string> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("monsters")
      .select("name, min_hp, max_hp, moves")
      .eq("type", "Boss");

    if (!data || data.length === 0) return "";

    return data
      .map((b) => {
        const moves = Array.isArray(b.moves)
          ? (b.moves as { name: string }[]).slice(0, 4).map((m) => m.name).join(", ")
          : "";
        return `${b.name} (${b.min_hp ?? "?"}HP): ${moves}`;
      })
      .join("\n");
  } catch {
    return "";
  }
}

const SYSTEM_PROMPT = `You are an elite Slay the Spire 2 coach. You think in deck architecture, risk management, and run trajectory — not individual card power.

SKIP FIRST: A focused deck that draws key cards every fight beats a pile of individually strong cards. Every add must advance the win condition or fix a critical weakness. Default to skip.

DECK SIZE IS CRITICAL:
- 10-15 cards: Ideal. Draws are consistent. Add cards freely if they serve the archetype.
- 16-20 cards: Acceptable if the deck has draw sources. Be selective — only add cards that are clearly better than your worst card.
- 21-25 cards: Bloated. Set skip_recommended: true for MOST offerings. Only add a card if it fixes a critical weakness the deck cannot win without.
- 26+ cards: Severely bloated. ALWAYS set skip_recommended: true unless the card is a must-have engine piece. Draw consistency is destroyed at this size — adding more cards makes the deck WORSE, not better.

WIN CONDITION: Every deck needs a plan for the act boss. "Generally good" cards that don't serve the plan are skips.

ACT-AWARE EVALUATION:
- Act 1: Survive hallway fights and the elite. Take front-loaded damage and AoE. You need to FIGHT, not set up engine pieces.
- Act 2: Hallway fights spike hard. Scaling and AoE become critical. Deck must handle multi-enemy fights.
- Act 3: Boss preparation. Deck needs a complete engine — scaling, draw, and block for multi-turn fights.

ENERGY ECONOMY: A 2-cost card in a 3-energy deck uses 67% of your turn. Always factor energy cost vs available energy.

PHASE DISCIPLINE:
- Floors 1-5: Take cards that solve immediate combat needs (front-loaded damage, AoE, efficient block). Do NOT take setup cards or engine pieces yet. If an S-tier archetype-defining card appears, take it and lock in.
- Floors 6-8: Commit to the archetype with strongest signals. Only take cards that synergize with existing pieces.
- Floor 9+: LOCKED. Every card must serve the archetype. Off-archetype cards are skips even if individually S-tier. Deck coherence wins runs.

STARTER CARDS: Strikes and Defends are removal targets, not engine cards. But a deck still full of them needs raw damage/block upgrades more than engine pieces. NEVER mention Strikes or Defends in your reasoning — they are temporary and irrelevant to card evaluation. If a card happens to work with attacks, explain why it works with the deck's REAL attack cards, not Strikes.

DUPLICATES: If a card being offered is already in the deck, that is a significant downside. A second copy dilutes draws and reduces consistency. Only recommend a duplicate if it is a core engine card the deck wants to see every fight (e.g., a key 0-cost, a primary scaling source). Never recommend a third copy of any card.

TRAP CARDS — NEVER RECOMMEND THESE:
- Cards that scale with Strikes/Defends (e.g., Perfected Strike, Twin Strike scaling). These get WORSE as the deck improves because Strikes are being removed. They are anti-synergy with every good deck.
- Cards that add Strikes/Defends or other weak cards to the deck (deck pollution).
- Cards whose only value is in a deck full of starter cards. A good deck removes starters, so these cards become dead draws.
If a card's power comes from counting or synergizing with starter cards, it is ALWAYS a skip regardless of current deck composition.

UPGRADES: Cards upgrade once only (Bash → Bash+). Never suggest upgrading a card already marked with +.

CHARACTER BUILD GUIDE: When a character build guide is provided, treat it as authoritative. Evaluate every card against the archetypes listed. Cards on the "always skip" list are skips. Cards on the "always good" list are strong picks in the exploring phase. Once an archetype is locked, only recommend cards listed as key cards for that archetype or that directly address a critical weakness.

RUN NARRATIVE: When provided, maintain strategic consistency. If the player frequently diverges, adapt to their signals. If a card justifies a pivot, say so explicitly.

SHOP: Card removal is high-value but context-dependent. Consider: remaining Strikes/Defends, escalating removal cost, whether a key synergy card/relic is available, gold for future shops. Keep 75g reserve for removal unless buying a critical piece. One removal per visit. Include spending_plan for affordable items only. Shop relics are permanent power — a relic that enables the archetype is almost always the top purchase.

MAP PATHING:
- Relics are permanent power multipliers — an early relic benefits 30+ fights. ALWAYS prioritize elite paths unless death risk is real.
- Act 1: Take elites aggressively (>50% HP, have front-loaded damage). You do NOT need scaling yet — you need the relic. Aim for 2 elites.
- Act 2: Elites at >60% HP if deck has AoE. Fights spike hard. 1-2 elites is correct.
- Act 3: Elites only if deck is strong AND HP >60%. A bad elite ends the run. Boss prep > greed.
- Unknown/Event nodes: safer than Monster nodes with comparable+ rewards. Act 1 events are generally positive (transforms, relics, max HP). Prefer Unknown over Monster when pathing.
- Shops: high value at 150g+ (removal + relic/card). Route to shop if gold >= removal cost + 25g. Below 75g with no Strikes left = skip.
- Rest sites: route toward them before elites/boss for the heal OPTION. Dead floors only if HP is full AND all key cards upgraded.
- Consecutive fights: budget ~15-25 HP per fight. If HP minus (remaining fights * 20) < 0 before boss, path is too risky.
- Boss proximity: 2-3 floors = upgrade/remove. 1 floor = heal if <70% HP. Arrive at boss healthy with key cards upgraded.

REST SITES — UPGRADE IS DEFAULT. Heal is the exception, not the rule.
- Dig (if available): Best option. Skip only at effective HP <30% before a boss.
- Smith (upgrade): DEFAULT CHOICE. NAME the best upgrade target using this priority:
  1. Win-condition scaler (Demon Form, Limit Break, Noxious Fumes, etc.)
  2. Most-played damage/block card that gains the most per upgrade
  3. AoE card (especially pre-Act 2)
  4. Power that gains meaningful stats from upgrade
  Pick the card you play most often that gains the most. +4 damage on a card played 2x/combat > +1 on a power played once.
- Rest (heal): ONLY when effective missing HP puts you at death risk:
  - Effective HP <40%: heal (or <50% if elite/boss is next)
  - Effective HP 40-70%: UPGRADE. You die from weak decks, not chip damage.
  - Effective HP >70%: ALWAYS upgrade. Healing 10-15 HP is near-worthless.
- Act matters: Act 1 upgrades benefit ~30 fights. Act 3 upgrades benefit ~3. Upgrade MORE aggressively in Act 1.
- If all key archetype cards are already upgraded (+), heal threshold rises to <55%.
- "Effective HP" = current HP + passive healing from relics (shown in prompt as effective_missing).
- Already-upgraded cards (with +) cannot be upgraded again.

EVENTS:
- HP loss: only take if reward directly advances win condition AND HP > 60%.
- Curse: avoid unless reward is exceptional AND removal is available soon.
- Gold: only valuable if a shop is coming AND you need something from it.
- Card transform: only if transforming a Strike/Defend.
- Max HP: always valuable at high ascension.

BREVITY: All reasoning MUST be under 12 words. Fragments only. Example: "Strong AoE, deck needs it" or "Dilutes draw, skip". pick_summary/spending_plan/skip_reasoning/overall_advice: max 15 words.

GROUNDING: ONLY reference cards and relics the player CURRENTLY has (listed in the deck/relic context). NEVER mention cards the player does not have, even if they are in the character build guide. The build guide shows what to LOOK FOR, not what the player owns.

Respond in JSON only — no markdown, no code fences.
CRITICAL: Rankings array MUST contain EXACTLY one entry for EVERY item listed.
Confidence: 90-100 clear pick, 70-89 solid, 40-69 close call, <40 uncertain.`;

interface EvaluateRequest {
  type: "card_reward" | "shop" | "map";
  context: EvaluationContext;
  exclusive?: boolean;
  userId?: string | null;
  items?: {
    id: string;
    name: string;
    description: string;
    cost?: number;
    type?: string;
    rarity?: string;
  }[];
  mapPrompt?: string;
  runNarrative?: string | null;
  runId: string | null;
  gameVersion: string | null;
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body: EvaluateRequest = await request.json();
  const { type, context, items, runId, gameVersion } = body;

  console.log("[Evaluate] type:", type, "items:", items?.map(i => `${i.id}/${i.name}`));

  const supabase = createServiceClient();

  // Load contextual data
  const bosses = await getBossReference();
  const runHistory = await getRunHistoryContext();
  const characterStrategy = body.context
    ? await getCharacterStrategy(body.context.character)
    : null;

  // ─── MAP EVALUATION ───
  if (type === "map" && body.mapPrompt) {
    let mapPromptFull = "";
    if (body.runNarrative) mapPromptFull += `${body.runNarrative}\n\n`;
    if (characterStrategy) mapPromptFull += `=== CHARACTER BUILD GUIDE (follow this) ===\n${characterStrategy}\n\n`;
    mapPromptFull += body.mapPrompt;
    if (bosses) mapPromptFull += `\n\nBoss reference (these are the bosses you may face):\n${bosses}`;
    if (runHistory) mapPromptFull += `\n\n${runHistory}\nUse this history to avoid repeating past mistakes. Tailor advice to this player's patterns.`;

    try {
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: mapPromptFull }],
      });

      // Log usage
      logUsage(supabase, {
        userId: body.userId ?? null,
        evalType: "map",
        model: "claude-haiku-4-5-20251001",
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      }).catch(console.error);

      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        return NextResponse.json({ error: "No response" }, { status: 502 });
      }

      // Extract JSON object from response — find first { to last }
      const rawText = textBlock.text;
      const firstBrace = rawText.indexOf("{");
      const lastBrace = rawText.lastIndexOf("}");
      if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return NextResponse.json(
          { error: "No JSON found in response", detail: rawText.slice(0, 200) },
          { status: 502 }
        );
      }
      const jsonText = rawText.slice(firstBrace, lastBrace + 1);

      const mapResult = JSON.parse(jsonText);
      console.log("[Evaluate] Map result:", JSON.stringify(mapResult));
      return NextResponse.json(mapResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Map evaluation failed:", message);
      return NextResponse.json(
        { error: "Map evaluation failed", detail: message },
        { status: 500 }
      );
    }
  }

  // ─── CARD/SHOP EVALUATION ───
  if (!items || items.length === 0) {
    return NextResponse.json({ error: "No items to evaluate" }, { status: 400 });
  }

  // Check statistical cache for each item
  const cachedResults = await Promise.all(
    items.map(async (item) => {
      const stat = await getStatisticalEvaluation(supabase, item.id, context);
      return { itemId: item.id, stat };
    })
  );

  const allCached = cachedResults.every((r) => r.stat !== null);

  if (allCached) {
    const rankings = cachedResults
      .map((r, i) => ({
        ...r.stat!,
        itemName: items[i].name,
        rank: i + 1,
      }))
      .sort((a, b) => b.tierValue - a.tierValue || b.synergyScore - a.synergyScore);

    // Re-rank after sorting
    rankings.forEach((r, i) => {
      r.rank = i + 1;
    });

    return NextResponse.json({
      rankings,
      skipRecommended: false,
      skipReasoning: null,
      source: "statistical",
    });
  }

  // Build prompt for Claude — narrative + archetype guide first (strategic frame)
  let contextStr = "";
  if (body.runNarrative) {
    contextStr += `${body.runNarrative}\n\n`;
  }
  if (characterStrategy) {
    contextStr += `=== CHARACTER BUILD GUIDE (follow this) ===\n${characterStrategy}\n\n`;
  }
  contextStr += buildPromptContext(context);
  if (bosses) {
    contextStr += `\n\nBoss reference:\n${bosses}`;
  }
  if (runHistory) {
    contextStr += `\n\n${runHistory}`;
  }
  const itemsStr = items
    .map(
      (item, i) =>
        `${i + 1}. ${item.name}${item.cost != null ? ` (${item.cost} energy` : ""}${item.type ? `, ${item.type}` : ""}${item.rarity ? `, ${item.rarity}` : ""}${item.cost != null ? ")" : ""} — ${item.description}`
    )
    .join("\n");

  const isExclusive = body.exclusive !== false; // default true for card_reward

  // Build tool schema for structured output
  const evaluationTool: Anthropic.Tool = {
    name: "submit_evaluation",
    description: "Submit the evaluation of all items",
    input_schema: {
      type: "object" as const,
      properties: {
        rankings: {
          type: "array",
          description: `Evaluation for EACH item, in the SAME ORDER they were listed. Must have exactly ${items.length} entries.`,
          items: {
            type: "object",
            properties: {
              item_id: { type: "string", description: "The item ID exactly as provided" },
              rank: { type: "integer", description: "Rank (1 = best)" },
              tier: { type: "string", enum: ["S", "A", "B", "C", "D", "F"] },
              synergy_score: { type: "integer", description: "0-100" },
              confidence: { type: "integer", description: "0-100" },
              recommendation: { type: "string", enum: ["strong_pick", "good_pick", "situational", "skip"] },
              reasoning: { type: "string", description: "Max 12 words. NEVER mention Strikes/Defends or cards not in the deck." },
            },
            required: ["item_id", "rank", "tier", "synergy_score", "confidence", "recommendation", "reasoning"],
          },
        },
        pick_summary: { type: "string", description: "One phrase: what to pick and why, e.g. 'Pick Corruption — starts exhaust engine' or 'Skip — none fit the build'. Max 12 words." },
        skip_recommended: { type: "boolean" },
        skip_reasoning: { type: "string", description: "Why skip is recommended, if applicable" },
        ...(type === "shop" ? {
          spending_plan: { type: "string", description: "Concise gold allocation recommendation. Only affordable items." },
        } : {}),
      },
      required: ["rankings", "pick_summary", "skip_recommended"],
    },
  };

  const userPrompt = `${contextStr}

${type === "card_reward" ? "Offered cards" : "Shop items"}:
${itemsStr}
${isExclusive ? "\nEXCLUSIVE choice — pick ONE or skip ALL. If none deserve a deck slot, set skip_recommended: true and mark all as skip." : "\nYou may select MULTIPLE items. Evaluate each independently."}

Evaluate ALL ${items.length} items. Return EXACTLY ${items.length} rankings in listed order.
REMINDER: NEVER reference Strikes/Defends or cards NOT in the current deck. Only reference cards the player actually has.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: items.length > 5 ? 4096 : 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      tools: [evaluationTool],
      tool_choice: { type: "tool", name: "submit_evaluation" },
    });

    // Log usage
    logUsage(supabase, {
      userId: body.userId ?? null,
      evalType: type,
      model: "claude-haiku-4-5-20251001",
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    }).catch(console.error);

    // Extract structured tool use result — no JSON parsing needed
    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json(
        { error: "No tool use response from Claude" },
        { status: 502 }
      );
    }

    console.log("[Evaluate] Tool use input:", JSON.stringify(toolUse.input));
    const parsed = parseToolUseInput(toolUse.input);
    console.log("[Evaluate] Parsed rankings count:", parsed.rankings.length);
    const evaluation = parseClaudeCardRewardResponse(parsed);
    console.log("[Evaluate] Final rankings count:", evaluation.rankings.length);

    // Match Claude's returned IDs back to our original items
    // and set a stable itemIndex for position-based client matching
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[+\s_]/g, "").replace(/plus$/, "");

    for (const ranking of evaluation.rankings) {
      const rId = ranking.itemId.toLowerCase();
      const rName = ranking.itemName?.toLowerCase() ?? "";
      const rNorm = normalize(ranking.itemId);

      const matchIdx = items.findIndex(
        (item) => {
          const iId = item.id.toLowerCase();
          const iName = item.name.toLowerCase();
          const iNorm = normalize(item.id);
          const iNameNorm = normalize(item.name);

          return (
            iId === rId ||
            iName === rId ||
            iName === rName ||
            iNorm === rNorm ||
            iNameNorm === rNorm ||
            // Partial match: Claude's ID contains the item name or vice versa
            rId.includes(iName) ||
            rId.includes(iId) ||
            iName.includes(rNorm)
          );
        }
      );
      if (matchIdx !== -1) {
        ranking.itemId = items[matchIdx].id;
        ranking.itemName = items[matchIdx].name;
        ranking.itemIndex = matchIdx;
      }
    }

    // If Claude omitted items, re-evaluate just the missing ones
    const missingItems = items.filter(
      (_, i) => !evaluation.rankings.some((r) => r.itemIndex === i)
    );

    if (missingItems.length > 0) {
      try {
        const retryPrompt = `Evaluate these missing items in the same context:\n${missingItems.map((item, i) => `${i + 1}. ${item.name} (${item.cost ?? ""} ${item.type ?? ""}) — ${item.description}`).join("\n")}`;

        // Build tool_result for the prior tool_use so the message history is valid
        const toolResultBlocks = message.content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
          .map((b) => ({
            type: "tool_result" as const,
            tool_use_id: b.id,
            content: "Accepted, but some items were missing from your response.",
          }));

        const retryMsg = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [
            { role: "user", content: userPrompt },
            { role: "assistant", content: message.content },
            { role: "user", content: [...toolResultBlocks, { type: "text" as const, text: retryPrompt }] },
          ],
          tools: [evaluationTool],
          tool_choice: { type: "tool", name: "submit_evaluation" },
        });

        logUsage(supabase, {
          userId: body.userId ?? null,
          evalType: `${type}_retry`,
          model: "claude-haiku-4-5-20251001",
          inputTokens: retryMsg.usage.input_tokens,
          outputTokens: retryMsg.usage.output_tokens,
        }).catch(console.error);

        const retryToolUse = retryMsg.content.find((b) => b.type === "tool_use");
        if (retryToolUse && retryToolUse.type === "tool_use") {
          const retryParsed = parseClaudeCardRewardResponse(parseToolUseInput(retryToolUse.input));

          for (const ranking of retryParsed.rankings) {
            const matchIdx = items.findIndex(
              (item) =>
                item.id.toLowerCase() === ranking.itemId.toLowerCase() ||
                normalize(item.name) === normalize(ranking.itemId)
            );
            if (matchIdx !== -1) {
              ranking.itemId = items[matchIdx].id;
              ranking.itemName = items[matchIdx].name;
              ranking.itemIndex = matchIdx;
              evaluation.rankings.push(ranking);
            }
          }
        }
      } catch (retryError) {
        console.error("Retry evaluation failed:", retryError);
      }
    }

    // Log evaluations async (don't block response)
    Promise.all(
      evaluation.rankings.map((ranking) =>
        logEvaluation(supabase, context, ranking, runId, gameVersion, body.userId)
      )
    ).catch(console.error);

    return NextResponse.json(evaluation);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Evaluation failed:", message);

    // Detect rate limiting from Anthropic
    const isRateLimit = message.includes("rate") || message.includes("429");
    const status = isRateLimit ? 429 : 500;
    const detail = isRateLimit
      ? "Rate limited — please wait a moment"
      : "Evaluation service error";

    return NextResponse.json(
      { error: "Evaluation failed", detail },
      { status }
    );
  }
}
