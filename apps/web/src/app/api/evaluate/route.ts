import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
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
  bossBriefingSchema,
  buildMapEvalSchema,
  genericEvalSchema,
  simpleEvalSchema,
} from "@sts2/shared/evaluation/eval-schemas";
import { EVAL_MODELS } from "@sts2/shared/evaluation/models";
import {
  parseToolUseInput,
  parseClaudeCardRewardResponse,
} from "@sts2/shared/evaluation/parse-tool-response";
import { getStatisticalEvaluation } from "@sts2/shared/evaluation/statistical-evaluator";
import { logEvaluation } from "@sts2/shared/evaluation/evaluation-logger";
import { tierToValue, type TierLetter } from "@sts2/shared/evaluation/tier-utils";
import { applyPostEvalWeights, buildWeightContext, adjustTier as adjustTierByDelta, reconcileSkipRecommended } from "@sts2/shared/evaluation/post-eval-weights";
import { getRunHistoryContext } from "@/evaluation/run-history-context";
import { logUsage } from "@/lib/usage-logger";
import { requireAuth } from "@/lib/api-auth";
import { getCharacterStrategy } from "@/evaluation/strategy/character-strategies";

// Legacy SDK — only used by call sites pending migration to the AI SDK in
// later phases of sts2-helper#46. Renamed to avoid colliding with the
// `anthropic` provider import from `@ai-sdk/anthropic` above.
const anthropicLegacy = new Anthropic();

// ─── Cached game data (loaded once per cold start, ~30min TTL on Vercel) ───

// Boss reference
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

// Keyword + status effect glossary
let keywordGlossaryPromise: Promise<string> | null = null;

function getKeywordGlossary(): Promise<string> {
  if (!keywordGlossaryPromise) {
    keywordGlossaryPromise = loadKeywordGlossary();
  }
  return keywordGlossaryPromise;
}

async function loadKeywordGlossary(): Promise<string> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("keywords")
      .select("name, description")
      .order("name");

    if (!data || data.length === 0) return "";

    const lines = data.map((k) => `- ${k.name}: ${k.description}`);
    return `\nGAME KEYWORD & STATUS EFFECT REFERENCE (use these definitions when evaluating):\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}

// Incremental card data cache — only fetches cards not already cached
interface CachedCard {
  description: string;
  type: string;
  keywords: string[];
}

const cardCache = new Map<string, CachedCard>();

async function enrichCards(
  ids: string[]
): Promise<Map<string, CachedCard>> {
  const missing = ids.filter((id) => !cardCache.has(id));

  if (missing.length > 0) {
    try {
      const supabase = createServiceClient();
      const { data } = await supabase
        .from("cards")
        .select("id, description, description_raw, type, keywords")
        .in("id", missing);

      if (data) {
        for (const card of data) {
          cardCache.set(card.id, {
            description: card.description_raw ?? card.description,
            type: card.type,
            keywords: (card.keywords as string[]) ?? [],
          });
        }
      }
    } catch {
      // Non-critical — fall back to mod-provided descriptions
    }
  }

  return cardCache;
}

// System prompt is now built by prompt-builder.ts with type-specific addenda.
// See packages/shared/evaluation/prompt-builder.ts for the centralized prompt text.

type WinRateRow = {
  item_id: string;
  pick_win_rate: number | null;
  skip_win_rate: number | null;
  times_picked: number;
  times_skipped: number;
};

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
    keywords?: string[];
  }[];
  mapPrompt?: string;
  runNarrative?: string | null;
  runId: string | null;
  gameVersion: string | null;
  goldBudget?: number | null;
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body: EvaluateRequest = await request.json();
  const { type, context, items, runId, gameVersion } = body;

  console.log("[Evaluate] type:", type, "items:", items?.map(i => `${i.id}/${i.name}`));

  const supabase = createServiceClient();

  // Load contextual data (in parallel)
  const itemIds = items?.map((i) => i.id) ?? [];
  const [bosses, runHistory, characterStrategy, keywordGlossary, enrichedCards] = await Promise.all([
    getBossReference(),
    getRunHistoryContext(),
    body.context ? getCharacterStrategy(body.context.character) : null,
    getKeywordGlossary(),
    itemIds.length > 0 ? enrichCards(itemIds) : cardCache,
  ]);

  // Determine eval type for the prompt builder
  const evalType: EvalType = (body.evalType as EvalType) ?? (type === "map" && body.mapPrompt ? "map" : type as EvalType);
  const isMultiplayer = context?.isMultiplayer === true;
  const systemPrompt = buildSystemPrompt(evalType, isMultiplayer) + keywordGlossary;

  // Enrich offered items with authoritative Supabase descriptions + keywords
  if (items) {
    for (const item of items) {
      const cached = enrichedCards.get(item.id);
      if (cached) {
        item.description = cached.description;
        if (cached.keywords.length > 0) {
          item.keywords = cached.keywords;
        }
      }
    }
  }

  // Enrich deck cards with type info from card cache (Attack/Skill/Power)
  if (context?.deckCards) {
    // Fetch any deck cards not already in cache
    const deckCardNames = context.deckCards.map((c) => c.name.toLowerCase());
    // Card cache is keyed by ID, but deck cards only have names.
    // Build a name→type lookup from the cache.
    const nameToType = new Map<string, string>();
    for (const [, card] of enrichedCards) {
      // We don't have name in cache key, but we can match via description
    }
    // Simpler: query by name for deck cards not yet typed
    const untypedNames = context.deckCards
      .filter((c) => !c.type)
      .map((c) => c.name.replace(/\+$/, "")); // strip upgrade suffix for lookup
    if (untypedNames.length > 0) {
      try {
        const supabase = createServiceClient();
        const { data } = await supabase
          .from("cards")
          .select("name, type")
          .in("name", [...new Set(untypedNames)]);
        if (data) {
          const typeMap = new Map(data.map((c) => [c.name.toLowerCase(), c.type]));
          for (const card of context.deckCards) {
            if (!card.type) {
              const baseName = card.name.replace(/\+$/, "").toLowerCase();
              card.type = typeMap.get(baseName);
            }
          }
        }
      } catch {
        // Non-critical
      }
    }
  }
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

    // Boss briefing: structured strategy via AI SDK + zod
    if (evalType === "boss_briefing") {
      try {
        const result = await generateText({
          model: anthropic(EVAL_MODELS.boss),
          maxOutputTokens: 512,
          system: systemPrompt,
          prompt: mapPromptFull,
          output: Output.object({ schema: bossBriefingSchema }),
        });

        logUsage(supabase, {
          userId: body.userId ?? null,
          evalType: "boss_briefing",
          model: EVAL_MODELS.boss,
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
        }).catch(console.error);

        return NextResponse.json({ strategy: result.output.strategy });
      } catch (err) {
        console.error("[Evaluate] Boss briefing error:", err);
        return NextResponse.json({ error: "Boss briefing failed" }, { status: 500 });
      }
    }

    // Dispatch the right zod schema per eval type. Each branch is its own
    // generateText call so TypeScript can infer a concrete output type
    // (Output.object infers from the schema, and a union of three different
    // schemas can't be unified).
    const isMapEval = evalType === "map";
    const isSimpleEval =
      evalType === "card_removal" ||
      evalType === "card_upgrade" ||
      evalType === "card_select";
    const optionCount = body.mapPrompt.match(/Option \d+/g)?.length ?? 3;
    const callOptions = {
      model: anthropic(EVAL_MODELS.default),
      maxOutputTokens: 2048,
      system: systemPrompt,
      prompt: mapPromptFull,
    };

    try {
      const result = isMapEval
        ? await generateText({
            ...callOptions,
            output: Output.object({ schema: buildMapEvalSchema(optionCount) }),
          })
        : isSimpleEval
          ? await generateText({
              ...callOptions,
              output: Output.object({ schema: simpleEvalSchema }),
            })
          : await generateText({
              ...callOptions,
              output: Output.object({ schema: genericEvalSchema }),
            });

      logUsage(supabase, {
        userId: body.userId ?? null,
        evalType: evalType,
        model: EVAL_MODELS.default,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      }).catch(console.error);

      console.log("[Evaluate] Map/freeform output:", JSON.stringify(result.output));
      return NextResponse.json(result.output);
    } catch (error) {
      // Strict-fail: surface zod validation failures as 502 instead of
      // silently degrading. The b11bef8 incident is exactly the case we
      // want to surface — the old workaround masked Haiku's stringified
      // rankings quirk and silently dropped node_preferences.
      if (NoObjectGeneratedError.isInstance(error)) {
        // Best-effort usage logging for the failed call so token cost
        // is still captured.
        if (error.usage) {
          logUsage(supabase, {
            userId: body.userId ?? null,
            evalType: evalType,
            model: EVAL_MODELS.default,
            inputTokens: error.usage.inputTokens ?? 0,
            outputTokens: error.usage.outputTokens ?? 0,
          }).catch(console.error);
        }
        const detail = error.cause instanceof Error ? error.cause.message : error.message;
        console.error("[Evaluate] Map/freeform schema validation failed:", detail, "raw text:", error.text);
        return NextResponse.json(
          { error: "Schema validation failed", detail },
          { status: 502 }
        );
      }
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

  // Query win rates once — reused for both prompt injection and post-eval weight adjustment
  const ascTier = context.ascension <= 4 ? "low" : context.ascension <= 9 ? "mid" : "high";
  let winRates: WinRateRow[] | null = null;
  try {
    const { data } = await supabase
      .from("card_win_rates")
      .select("item_id, pick_win_rate, skip_win_rate, times_picked, times_skipped")
      .in("item_id", items.map((i) => i.id))
      .eq("character", context.character)
      .eq("act", context.act)
      .eq("ascension_tier", ascTier);
    winRates = data as WinRateRow[] | null;
  } catch {
    // View may not exist yet
  }

  let winRateContext = "";
  if (winRates && winRates.length > 0) {
    const wrLines = winRates
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
  // Flag duplicates and cost inline so Claude can't miss them
  const isShop = type === "shop";
  const costUnit = isShop ? "g" : " energy";
  const deckCardNames = new Set((context.deckCards ?? []).map((c) => c.name.toLowerCase()));
  const itemsStr = items
    .map(
      (item, i) => {
        const isDuplicate = deckCardNames.has(item.name.toLowerCase());
        const dupWarning = isDuplicate ? " [2nd copy — good if core engine piece, bad if mediocre]" : "";
        const saleTag = (item as Record<string, unknown>).on_sale ? " [SALE 50% OFF]" : "";
        const kwTag = item.keywords?.length ? ` [${item.keywords.join(",")}]` : "";
        return `${i + 1}. ${item.name}${item.cost != null ? ` (${item.cost}${costUnit}` : ""}${item.type ? `, ${item.type}` : ""}${item.rarity ? `, ${item.rarity}` : ""}${item.cost != null ? ")" : ""}${kwTag}${saleTag} — ${item.description}${dupWarning}`;
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
        skip_recommended: { type: "boolean" },
        skip_reasoning: { type: "string", description: "Why skip is recommended, if applicable" },
        ...(type === "shop" ? {
          spending_plan: { type: "string", description: "Concise gold allocation recommendation. Only affordable items." },
        } : {}),
      },
      required: ["rankings", "skip_recommended"],
    },
  };

  const goldBudget = isShop && body.goldBudget != null ? `\nGOLD BUDGET: ${body.goldBudget}g — only recommend items you can afford. All items listed below are affordable.\n` : "";

  // Pre-computed budget summary for shop evals — placed AFTER items for Haiku recency bias
  const budgetSummary = isShop && body.goldBudget != null
    ? `\nBUDGET SUMMARY: ${body.goldBudget}g available. Exact costs: ${items.map((i) => `${i.name}=${i.cost}g`).join(", ")}. Use ONLY these exact costs in your spending_plan. Do NOT invent discounted prices.`
    : "";

  const userPrompt = `${contextStr}
${goldBudget}
CRITICAL: This is Slay the Spire 2. Many cards have DIFFERENT effects than STS1. Evaluate ONLY by the description shown after the dash (—). Do NOT assume what a card does from its name.

${type === "card_reward" ? "Offered cards" : "Shop items (affordable only)"}:
${itemsStr}
${isExclusive ? "\nEXCLUSIVE choice — pick ONE or skip ALL. If none deserve a deck slot, set skip_recommended: true and mark all as skip." : "\nYou may select MULTIPLE items. Evaluate each independently."}
${budgetSummary}

Return exactly ${items.length} rankings using position numbers (1, 2, 3...) matching the order above.`;

  try {
    const message = await anthropicLegacy.messages.create({
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
      evalType: evalType,
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

    // Apply data-driven weights from card_win_rates (already fetched above)
    if ((evalType === "card_reward" || evalType === "shop") && winRates && winRates.length > 0) {
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

    // Reconcile skipRecommended with actual tiers — Claude can return
    // contradictory data (A-tier card + skip_recommended: true)
    reconcileSkipRecommended(evaluation);

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
