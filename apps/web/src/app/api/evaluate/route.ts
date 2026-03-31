import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import type { EvaluationContext } from "@sts2/shared/evaluation/types";
import {
  buildSystemPrompt,
  buildCompactContext,
  compactStrategy,
  compactBossReference,
  buildMapToolSchema,
  buildGenericToolSchema,
  buildSimpleToolSchema,
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

  // ─── MAP/EVENT/REST/ETC EVALUATION (via mapPrompt) ───
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

    // Select tool schema based on eval type
    const isMapEval = evalType === "map";
    const isSimpleEval = evalType === "card_removal" || evalType === "card_upgrade";
    const toolSchema = isMapEval
      ? buildMapToolSchema(body.mapPrompt.match(/Option \d+/g)?.length ?? 3)
      : isSimpleEval
        ? buildSimpleToolSchema()
        : buildGenericToolSchema(`Submit ${evalType} evaluation`);

    try {
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: mapPromptFull }],
        tools: [toolSchema as Anthropic.Tool],
        tool_choice: { type: "tool", name: toolSchema.name },
      });

      // Log usage
      logUsage(supabase, {
        userId: body.userId ?? null,
        evalType: evalType,
        model: "claude-haiku-4-5-20251001",
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      }).catch(console.error);

      // Extract tool_use result — structured, no JSON parsing needed
      const toolUse = message.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        return NextResponse.json(
          { error: "No tool use response from Claude" },
          { status: 502 }
        );
      }

      const result = toolUse.input as Record<string, unknown>;

      // Fix Haiku quirk: rankings sometimes returned as JSON string instead of array
      if (typeof result.rankings === "string") {
        try {
          const str = result.rankings as string;
          // Extract the array portion (may have trailing fields appended)
          const start = str.indexOf("[");
          if (start !== -1) {
            let depth = 0;
            for (let i = start; i < str.length; i++) {
              if (str[i] === "[") depth++;
              else if (str[i] === "]") depth--;
              if (depth === 0) {
                result.rankings = JSON.parse(str.slice(start, i + 1));
                break;
              }
            }
          }
          // Also extract overall_advice if embedded in the string
          if (!result.overall_advice) {
            const adviceMatch = str.match(/"overall_advice"\s*:\s*"([^"]*)"/);
            if (adviceMatch) result.overall_advice = adviceMatch[1];
          }
        } catch {
          result.rankings = [];
        }
      }

      console.log("[Evaluate] Map/freeform tool result:", JSON.stringify(result));
      return NextResponse.json(result);
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

  // Fetch statistical data for each item to augment Claude's evaluation
  const cachedResults = await Promise.all(
    items.map(async (item) => {
      const stat = await getStatisticalEvaluation(supabase, item.id, context, context.ascension);
      return { itemId: item.id, itemName: item.name, stat };
    })
  );

  // Build historical context string to inject into Claude's prompt
  const statsWithData = cachedResults.filter((r) => r.stat !== null);
  let historicalContext = "";
  if (statsWithData.length > 0) {
    const lines = statsWithData.map((r) => {
      const s = r.stat!;
      const tierLetter = ["", "F", "D", "C", "B", "A", "S"][s.tierValue] ?? "?";
      return `${r.itemName}: historically ${tierLetter}-tier (${s.confidence}% confidence, ${s.recommendation})`;
    });
    historicalContext = `\n[Historical data from ${statsWithData.length > 1 ? "prior runs" : "prior run"}]\n${lines.join("\n")}\nUse this as context but evaluate based on the CURRENT deck state.`;
  }

  // Also query win rates if available
  type WinRateRow = { item_id: string; pick_win_rate: number | null; skip_win_rate: number | null; times_picked: number; times_skipped: number };
  let winRateContext = "";
  try {
    const ascTier = context.ascension <= 4 ? "low" : context.ascension <= 9 ? "mid" : "high";
    const { data: winRates } = await supabase
      .from("card_win_rates" as "evaluations")
      .select("item_id, pick_win_rate, skip_win_rate, times_picked, times_skipped")
      .in("item_id", items.map((i) => i.id))
      .eq("character" as "item_id", context.character)
      .eq("act" as "item_id", context.act as unknown as string)
      .eq("ascension_tier" as "item_id", ascTier);
    const wr = winRates as unknown as WinRateRow[] | null;
    if (wr && wr.length > 0) {
      const wrLines = wr
        .filter((w) => (w.times_picked ?? 0) >= 5)
        .map((w) => {
          const item = items.find((i) => i.id === w.item_id);
          const pickWr = w.pick_win_rate != null ? `${Math.round(w.pick_win_rate * 100)}%` : "?";
          const skipWr = w.skip_win_rate != null ? `${Math.round(w.skip_win_rate * 100)}%` : "?";
          return `${item?.name ?? w.item_id}: pick WR ${pickWr} (n=${w.times_picked}), skip WR ${skipWr} (n=${w.times_skipped})`;
        });
      if (wrLines.length > 0) {
        winRateContext = `\n[Win rate data]\n${wrLines.join("\n")}`;
      }
    }
  } catch {
    // View may not exist yet
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

  // Inject historical data before items (gives Claude context without overriding)
  if (historicalContext) contextStr += historicalContext;
  if (winRateContext) contextStr += winRateContext;

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
