import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import type { EvaluationContext } from "@sts2/shared/evaluation/types";
// buildPromptContext is the verbose format — buildCompactContext is used instead
// import { buildPromptContext } from "@sts2/shared/evaluation/context-builder";
import {
  buildSystemPrompt,
  buildCompactContext,
  compactStrategy,
  compactBossReference,
  type EvalType,
} from "@sts2/shared/evaluation/prompt-builder";
import {
  getStatisticalEvaluation,
  logEvaluation,
  parseClaudeCardRewardResponse,
  parseToolUseInput,
} from "@sts2/shared/evaluation/evaluation-service";
import { tierToValue, type TierLetter } from "@sts2/shared/evaluation/tier-utils";
import { applyPostEvalWeights, buildWeightContext, adjustTier as adjustTierByDelta } from "@sts2/shared/evaluation/post-eval-weights";
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

// System prompt is now built by prompt-builder.ts with type-specific addenda.
// See packages/shared/evaluation/prompt-builder.ts for the centralized prompt text.

interface EvaluateRequest {
  type: "card_reward" | "shop" | "map";
  evalType?: string; // Specific eval type for system prompt (rest_site, event, etc.)
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

  // Determine eval type for the prompt builder
  // Hooks can specify evalType explicitly (rest_site, event, etc.)
  // Otherwise fall back to the request type
  const evalType: EvalType = (body.evalType as EvalType) ?? (type === "map" && body.mapPrompt ? "map" : type as EvalType);
  const systemPrompt = buildSystemPrompt(evalType);
  console.log("[Evaluate] evalType:", evalType, "system prompt length:", systemPrompt.length);

  // ─── MAP EVALUATION (includes event, rest, card_removal, etc. via mapPrompt) ───
  if (type === "map" && body.mapPrompt) {
    let mapPromptFull = "";
    if (runHistory) mapPromptFull += `${runHistory}\n\n`;
    if (body.runNarrative) mapPromptFull += `${body.runNarrative}\n\n`;
    if (characterStrategy) mapPromptFull += `=== BUILD GUIDE ===\n${compactStrategy(characterStrategy) ?? characterStrategy}\n\n`;
    mapPromptFull += body.mapPrompt;
    if (bosses) {
      const bossCompact = compactBossReference(bosses);
      if (bossCompact) mapPromptFull += `\n\n${bossCompact}`;
    }

    try {
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: systemPrompt,
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

  // Check statistical cache for each item (ascension-scoped via evaluation_stats_v2)
  const cachedResults = await Promise.all(
    items.map(async (item) => {
      const stat = await getStatisticalEvaluation(supabase, item.id, context, context.ascension);
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

  // Build compact prompt — history + narrative + strategy + compact context + items LAST (Haiku recency bias)
  let contextStr = "";
  if (runHistory) {
    contextStr += `${runHistory}\n\n`;
  }
  if (body.runNarrative) {
    contextStr += `${body.runNarrative}\n\n`;
  }
  const strategy = compactStrategy(characterStrategy);
  if (strategy) {
    contextStr += `=== BUILD GUIDE ===\n${strategy}\n\n`;
  }
  contextStr += buildCompactContext(context);
  // Boss reference: compressed for card/shop evals
  const bossCompact = compactBossReference(bosses);
  if (bossCompact) {
    contextStr += `\n${bossCompact}`;
  }

  // Items go LAST for Haiku's recency bias
  // Flag duplicates and energy cost inline so Claude can't miss them
  const deckCardNames = new Set((context.deckCards ?? []).map((c) => c.name.toLowerCase()));
  const itemsStr = items
    .map(
      (item, i) => {
        const isDuplicate = deckCardNames.has(item.name.toLowerCase());
        const dupWarning = isDuplicate ? " [2nd copy — good if core engine piece, bad if mediocre]" : "";
        return `${i + 1}. ${item.name}${item.cost != null ? ` (${item.cost}E` : ""}${item.type ? `, ${item.type}` : ""}${item.rarity ? `, ${item.rarity}` : ""}${item.cost != null ? ")" : ""} — ${item.description}${dupWarning}`;
      }
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
          description: `Exactly ${items.length} entries in this EXACT order: ${items.map((item, i) => `${i + 1}=${item.name}`).join(", ")}.`,
          items: {
            type: "object",
            properties: {
              position: { type: "integer", description: "Item position (1-indexed)" },
              tier: { type: "string", enum: ["S", "A", "B", "C", "D", "F"] },
              confidence: { type: "integer", description: "0-100" },
              reasoning: { type: "string", description: "Under 20 words. Reference archetype fit." },
            },
            required: ["position", "tier", "confidence", "reasoning"],
          },
        },
        pick_summary: { type: "string", description: "'Pick [name] — [reason]' or 'Skip — [reason]'. Max 15 words." },
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

Return exactly ${items.length} rankings using position numbers (1, 2, 3...) matching the order above.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: items.length > 5 ? 4096 : 1024,
      system: systemPrompt,
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

    // Position-based matching: Claude returns items by position (1-indexed).
    // Map each ranking to the original item using position, not name/ID matching.
    for (const ranking of evaluation.rankings) {
      // Position is 1-indexed from Claude, convert to 0-indexed array position
      const idx = (ranking.itemIndex ?? -1);
      if (idx >= 0 && idx < items.length) {
        ranking.itemId = items[idx].id;
        ranking.itemName = items[idx].name;
        ranking.itemIndex = idx;
      }
    }

    // If we got fewer rankings than items, fill missing with position-based fallback
    if (evaluation.rankings.length < items.length) {
      const coveredPositions = new Set(evaluation.rankings.map((r) => r.itemIndex));
      for (let i = 0; i < items.length; i++) {
        if (!coveredPositions.has(i)) {
          evaluation.rankings.push({
            itemId: items[i].id,
            itemName: items[i].name,
            itemIndex: i,
            rank: items.length,
            tier: "C" as const,
            tierValue: 3,
            synergyScore: 50,
            confidence: 30,
            recommendation: "situational",
            reasoning: "Not evaluated",
            source: "claude",
          });
        }
      }
    }

    console.log("[Evaluate] Final rankings count:", evaluation.rankings.length);

    // Save original tier values before weight adjustments
    const originalTiers = new Map(
      evaluation.rankings.map((r) => [r.itemIndex, r.tierValue])
    );

    // Apply heuristic weight adjustments
    const itemDescs = new Map(items.map((item, i) => [i, item.description]));
    const wctx = buildWeightContext(evalType, context);
    applyPostEvalWeights(evaluation, wctx, itemDescs);

    // Apply data-driven weights from card_win_rates materialized view
    if (evalType === "card_reward" || evalType === "shop") {
      const ascTier = context.ascension <= 4 ? "low" : context.ascension <= 9 ? "mid" : "high";
      type WinRateRow = { item_id: string; pick_win_rate: number | null; skip_win_rate: number | null; times_picked: number; times_skipped: number };
      let winRates: WinRateRow[] | null = null;
      try {
        // Materialized views aren't in generated types — use untyped query
        const { data } = await supabase
          .from("card_win_rates" as "evaluations") // type bypass for materialized view
          .select("item_id, pick_win_rate, skip_win_rate, times_picked, times_skipped")
          .in("item_id", items.map((i) => i.id))
          .eq("character" as "item_id", context.character)
          .eq("act" as "item_id", context.act as unknown as string)
          .eq("ascension_tier" as "item_id", ascTier);
        winRates = data as unknown as WinRateRow[] | null;
      } catch {
        // View may not exist yet or be empty
      }

      if (winRates && winRates.length > 0) {
        const winRateMap = new Map(winRates.map((w) => [w.item_id, w]));
        for (const ranking of evaluation.rankings) {
          const wr = winRateMap.get(ranking.itemId);
          if (!wr || (wr.times_picked ?? 0) < 10) continue; // need min sample

          const pickWr = wr.pick_win_rate ?? 0.5;
          const skipWr = wr.skip_win_rate ?? 0.5;

          // If picking this card has significantly higher win rate than skipping
          if (pickWr > skipWr + 0.15 && (wr.times_picked ?? 0) >= 20) {
            ranking.tier = adjustTierByDelta(ranking.tier as TierLetter, 1);
            ranking.tierValue = tierToValue(ranking.tier as TierLetter);
            ranking.reasoning = (ranking.reasoning ?? "") + ` [+data: ${Math.round(pickWr * 100)}% pick WR]`;
          }

          // If skipping has significantly higher win rate than picking
          if (skipWr > pickWr + 0.15 && (wr.times_skipped ?? 0) >= 20) {
            ranking.tier = adjustTierByDelta(ranking.tier as TierLetter, -1);
            ranking.tierValue = tierToValue(ranking.tier as TierLetter);
            ranking.reasoning = (ranking.reasoning ?? "") + ` [-data: ${Math.round(skipWr * 100)}% skip WR]`;
          }
        }
      }
    }

    // Log evaluations async (don't block response)
    Promise.all(
      evaluation.rankings.map((ranking) => {
        const origTier = originalTiers.get(ranking.itemIndex) ?? ranking.tierValue;
        const adjustments = origTier !== ranking.tierValue
          ? [{ from: origTier, to: ranking.tierValue }]
          : null;
        return logEvaluation(
          supabase, context, ranking, runId, gameVersion, body.userId,
          evalType, origTier, adjustments ?? undefined
        );
      })
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
