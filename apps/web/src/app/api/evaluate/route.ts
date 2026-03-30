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

const SYSTEM_PROMPT = `You are an expert Slay the Spire 2 advisor with deep knowledge of current STS2 meta strategies, card synergies, and high-ascension play patterns. You evaluate decisions the way a top-level player would — not in a vacuum, but in the context of the current run state.

CRITICAL PRINCIPLE — DECK DISCIPLINE:
Skipping is ALWAYS a viable and often correct choice. A lean, focused deck is far stronger than a bloated one. Every card added must justify its inclusion by directly supporting the deck's win condition. Cards that are "generically good" but dilute draw consistency, energy efficiency, or archetype focus should be rated as skips. A 12-card deck that draws its key cards every fight beats a 25-card deck with individually strong cards. When in doubt, recommend skip.

CRITICAL PRINCIPLE — UPGRADES ARE ONCE ONLY:
Cards can only be upgraded ONCE. An upgraded card has a "+" suffix (e.g., "Bash+"). There is no "Bash++" or further upgrades. When evaluating upgrade choices at rest sites or events, never suggest upgrading an already-upgraded card (one with "+" in its name) and never reference double-upgraded card names.

CRITICAL PRINCIPLE — STARTER CARDS ARE TEMPORARY:
Strike and Defend are weak cards that will be removed from the deck over the course of the run. Do NOT evaluate synergies with Strike/Defend as meaningful — any card that "works well with Strikes" is building on a foundation that is actively being demolished. Evaluate cards based on synergy with the deck's real win condition cards, not starter cards.

Evaluate cards by asking:
1. Does this card directly advance the deck's archetype/win condition?
2. Does adding this card make the deck draw its key combos LESS consistently?
3. Would I rather see this card or my existing cards in a critical turn?
4. Is the deck at a size where adding ANY card is a net negative?
5. Am I evaluating synergy with cards that will be removed (Strike/Defend)?

For shop evaluations: card removal is often the highest-value action. Removing a Strike or Defend frequently outperforms buying a new card. You can only remove ONE card per shop visit (cost increases by 25g each time). Include a "spending_plan" field with a CONCISE recommended gold allocation — only list what the player CAN afford. Do NOT list items that exceed the budget or deliberate about impossible options. One clear recommendation, no alternatives.

Respond in JSON only — no markdown, no code fences.
CRITICAL: Your rankings array MUST contain EXACTLY one entry for EVERY item listed. Do not omit any item, even if it's a skip. Every item gets a tier, score, and reasoning. Missing items is a failure. Keep reasoning to 1 sentence max for shop evaluations with many items.

Confidence calibration:
- 90-100: Clear-cut (e.g., key archetype card the deck is missing)
- 70-89: Solid addition that supports the strategy without dilution
- 40-69: Genuinely close call — card is good but deck might not need it
- Below 40: Insufficient information or unfamiliar STS2 mechanic`;

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
    let mapPromptFull = body.mapPrompt;
    if (characterStrategy) mapPromptFull += `\n\nCharacter strategy guide:\n${characterStrategy}`;
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

      return NextResponse.json(JSON.parse(jsonText));
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

  // Build prompt for Claude
  let contextStr = buildPromptContext(context);
  if (characterStrategy) {
    contextStr += `\n\nCharacter strategy guide:\n${characterStrategy}`;
  }
  if (bosses) {
    contextStr += `\n\nBoss reference:\n${bosses}`;
  }
  if (runHistory) {
    contextStr += `\n\n${runHistory}\nUse this history to avoid repeating past mistakes.`;
  }
  const itemsStr = items
    .map(
      (item, i) =>
        `${i + 1}. ${item.name}${item.cost != null ? ` (${item.cost} energy` : ""}${item.type ? `, ${item.type}` : ""}${item.rarity ? `, ${item.rarity}` : ""}${item.cost != null ? ")" : ""} — ${item.description}`
    )
    .join("\n");

  const isExclusive = body.exclusive !== false; // default true for card_reward

  const exclusiveInstructions = isExclusive
    ? `\nThis is an EXCLUSIVE choice — you can only pick ONE card (or skip). Rank them against each other. Only the #1 pick should be "strong_pick" or "good_pick". Lower-ranked options should be "situational" or "skip" since they are alternatives you're NOT recommending.`
    : `\nYou may select MULTIPLE cards here. Evaluate each card independently — multiple cards can be "strong_pick" if they're all worth adding.`;

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
              reasoning: { type: "string", description: "1-2 sentences" },
            },
            required: ["item_id", "rank", "tier", "synergy_score", "confidence", "recommendation", "reasoning"],
          },
        },
        skip_recommended: { type: "boolean" },
        skip_reasoning: { type: "string", description: "Why skip is recommended, if applicable" },
        ...(type === "shop" ? {
          spending_plan: { type: "string", description: "Concise gold allocation recommendation. Only affordable items." },
        } : {}),
      },
      required: ["rankings", "skip_recommended"],
    },
  };

  const userPrompt = `${contextStr}

${type === "card_reward" ? "Offered cards" : "Shop items"}:
${itemsStr}
${isExclusive ? "\nThis is an EXCLUSIVE choice — pick ONE. Only #1 should be strong_pick/good_pick. Others should be situational/skip." : "\nYou may select MULTIPLE items. Evaluate each independently."}

Evaluate ALL ${items.length} items. Return EXACTLY ${items.length} rankings in the SAME ORDER as listed above.`;

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
    const evaluation = parseClaudeCardRewardResponse(parsed);

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
