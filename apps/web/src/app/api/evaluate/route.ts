import { NextResponse } from "next/server";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createServiceClient } from "@/lib/supabase/server";
import type {
  CardEvaluation,
  CardRewardEvaluation,
  EvaluationContext,
} from "@sts2/shared/evaluation/types";
import { scoreCardOffers } from "@sts2/shared/evaluation/card-reward/score-offers";
import { scoreShopNonCards } from "@sts2/shared/evaluation/shop/score-non-cards";
import { buildCoaching } from "@sts2/shared/evaluation/card-reward/build-coaching";
import type { WinRateInput } from "@sts2/shared/evaluation/card-reward/modifier-stack";
import {
  buildSystemPrompt,
  compactStrategy,
  compactBossReference,
  MAP_NARRATOR_PROMPT,
  type EvalType,
} from "@sts2/shared/evaluation/prompt-builder";
import {
  bossBriefingSchema,
  genericEvalSchema,
  simpleEvalSchema,
} from "@sts2/shared/evaluation/eval-schemas";
import {
  mapNarratorOutputSchema,
  sanitizeMapCoachOutput,
  sanitizeMapNarratorOutput,
  type MapCoachOutputRaw,
} from "@sts2/shared/evaluation/map-coach-schema";
import type { EnrichedPath } from "@sts2/shared/evaluation/map/enrich-paths";
import { scorePaths } from "@sts2/shared/evaluation/map/score-paths";
import type { ScoredPath } from "@sts2/shared/evaluation/map/score-paths";
import { deriveBranches } from "@sts2/shared/evaluation/map/derive-branches";
import type { DerivedBranch } from "@sts2/shared/evaluation/map/derive-branches";
import { buildNarratorInput } from "@sts2/shared/evaluation/map/build-narrator-input";
import type { NarratorInput } from "@sts2/shared/evaluation/map/build-narrator-input";
import type { RunState } from "@sts2/shared/evaluation/map/run-state";
import { EVAL_MODELS } from "@sts2/shared/evaluation/models";
import { computeDeckState } from "@sts2/shared/evaluation/card-reward/deck-state";
import { tagCard } from "@sts2/shared/evaluation/card-reward/card-tags";
import { formatCardFacts } from "@sts2/shared/evaluation/card-reward/format-card-facts";
import { getCommunityTierSignals } from "@sts2/shared/evaluation/community-tier";
import type { TierLetter } from "@sts2/shared/evaluation/tier-utils";
import { getRunHistoryContext } from "@/evaluation/run-history-context";
import { logEvaluation } from "@sts2/shared/evaluation/evaluation-logger";
import { logUsage } from "@/lib/usage-logger";
import { requireAuth } from "@/lib/api-auth";
import { getCharacterStrategy } from "@/evaluation/strategy/character-strategies";

// ─── Trailing-comma repair for LLM-generated JSON ───
function repairJson(text: string): string {
  return text.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Narrow a node-type string from the desktop's loose payload down to the
 * schema's enum. Keeps unrecognized tokens as "unknown" so the assembled
 * response never fails zod's `nodeTypeEnum` gate.
 */
function mapNodeType(
  t: string,
):
  | "monster"
  | "elite"
  | "rest"
  | "shop"
  | "treasure"
  | "event"
  | "boss"
  | "unknown" {
  switch (t) {
    case "monster":
    case "elite":
    case "rest":
    case "shop":
    case "treasure":
    case "event":
    case "boss":
    case "unknown":
      return t;
    default:
      return "unknown";
  }
}

// ─── Map response assembler — shared by happy path and NoObjectGeneratedError recovery ───

interface NarratorText {
  headline: string;
  reasoning: string;
  teaching_callouts: { pattern: string; explanation: string }[];
}

function assembleMapResponse(args: {
  scored: ScoredPath[];
  winner: ScoredPath;
  confidence: number;
  branches: DerivedBranch[];
  narratorInput: NarratorInput;
  narratorText: NarratorText;
}): MapCoachOutputRaw {
  const macroPath = {
    floors: args.winner.nodes.map((n) => ({
      floor: n.floor,
      node_type: mapNodeType(n.type),
      node_id: n.nodeId ?? "",
    })),
    summary: args.narratorInput.chosenPath.summary,
  };
  return {
    reasoning: {
      risk_capacity: args.narratorText.reasoning,
      act_goal: args.narratorText.headline,
    },
    headline: args.narratorText.headline,
    confidence: args.confidence,
    macro_path: macroPath,
    key_branches: args.branches,
    teaching_callouts: args.narratorText.teaching_callouts.map((c) => ({
      pattern: c.pattern,
      floors: [],
      explanation: c.explanation,
    })),
    compliance: {
      repaired: false,
      reranked: false,
      rerank_reason: null,
      repair_reasons: [],
      scoredPaths: args.scored.map((p) => ({
        id: p.id,
        score: p.score,
        scoreBreakdown: p.scoreBreakdown as Record<string, number>,
        disqualified: p.disqualified,
        disqualifyReasons: p.disqualifyReasons,
      })),
    },
  };
}

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

/** Strip Spire Codex formatting tags like [blue], [gold], [/gold], etc. */
function stripMarkup(text: string): string {
  return text.replace(/\[\/?\w+\]/g, "");
}

/**
 * Categorize an ancient event option by pattern-matching its relic description.
 * Returns a category tag that maps to guidance in the ancient addendum.
 */
function categorizeAncientOption(description: string): string {
  const lower = stripMarkup(description).toLowerCase();
  if (lower.includes("remove") && lower.includes("card")) return "CARD REMOVAL";
  if (lower.includes("transform")) return "TRANSFORM";
  if (lower.includes("raise your max hp") || lower.includes("max hp")) return "MAX HP";
  if (lower.includes("enchant")) return "ENCHANTMENT";
  if (
    (lower.includes("lose") && lower.includes("gold")) ||
    (lower.includes("gain") && lower.includes("gold"))
  ) return "GOLD TRADE";
  if (lower.includes("obtain") && lower.includes("relic")) return "RELIC";
  if (
    (lower.includes("add") && lower.includes("deck")) ||
    (lower.includes("obtain") && lower.includes("card")) ||
    lower.includes("card reward")
  ) return "CARD ADD";
  if (
    (lower.includes("lose") && lower.includes("hp")) ||
    (lower.includes("lose") && lower.includes("max hp"))
  ) return "HP TRADE";
  return "UNKNOWN";
}

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
  /**
   * Inputs for the scorer + narrator pipeline. The desktop projects these
   * from map state in `buildMapPrompt`. `nodes` / `nextOptions` are kept in
   * a loose structural shape because the scorer only consumes
   * `enrichedPaths`; the other fields flow through for future use (e.g. a
   * server-side sanity check that `currentPosition` matches). `runState` is
   * also computed client-side — duplicating it here would require shipping
   * raw player/deck/relic state and running the builder twice.
   */
  mapCompliance?: {
    nodes: Array<{
      col: number;
      row: number;
      type: string;
      children?: Array<[number, number]>;
    }>;
    nextOptions: Array<{ col: number; row: number; type: string }>;
    boss: { col: number; row: number };
    currentPosition: { col: number; row: number } | null;
    enrichedPaths: EnrichedPath[];
    runState: RunState;
    cardRemovalCost: number;
  };
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
    // Event enrichment: pull authoritative data from DB for all events
    let eventReference = "";
    if (evalType === "ancient" || evalType === "event") {
      const eventIdMatch = body.mapPrompt.match(/EVENT_ID:\s*(\S+)/);
      const eventId = eventIdMatch?.[1] ?? null;

      if (eventId) {
        try {
          const isAncient = evalType === "ancient";

          // Fetch event data + relics (for ancients) in parallel
          const eventQuery = supabase
            .from("events")
            .select("name, type, act, options, pages, relics")
            .eq("id", eventId)
            .single();
          const relicsQuery = isAncient
            ? supabase.from("relics").select("name, description").not("description", "is", null)
            : null;

          const [eventResult, relicsResult] = await Promise.all([
            eventQuery,
            relicsQuery,
          ]);

          const eventData = eventResult.data as {
            name: string; type: string; act: string | null;
            options: { id: string; title: string; description: string }[] | null;
            pages: { id: string; description: string; options: { id: string; title: string; description: string }[] | null }[] | null;
            relics: string[] | null;
          } | null;

          if (eventData) {
            if (isAncient) {
              // --- ANCIENT EVENT ENRICHMENT ---
              const allRelics = relicsResult?.data as { name: string; description: string }[] | null;
              if (allRelics) {
                const relicMap = new Map(allRelics.map((r) => [r.name, r.description]));
                const poolSize = eventData.relics?.length ?? 0;

                const optionMatches = body.mapPrompt.matchAll(/^\d+\.\s+(.+?):/gm);
                const offeredOptions: { name: string; description: string; category: string; cardInfo?: string; enchantInfo?: string }[] = [];
                for (const match of optionMatches) {
                  const optionName = match[1].trim();
                  const relicDesc = relicMap.get(optionName) ?? "";
                  offeredOptions.push({
                    name: optionName,
                    description: relicDesc,
                    category: categorizeAncientOption(relicDesc),
                  });
                }

                // Enrich CARD ADD options with actual card descriptions
                const cardNames: string[] = [];
                for (const o of offeredOptions) {
                  const clean = stripMarkup(o.description);
                  const cardMatch = clean.match(/add \d+ (.+?) to your Deck/i);
                  if (cardMatch) cardNames.push(cardMatch[1]);
                }
                if (cardNames.length > 0) {
                  const { data: cards } = await supabase
                    .from("cards")
                    .select("name, description, type, cost, keywords")
                    .in("name", cardNames);
                  if (cards) {
                    const cardMap = new Map(cards.map((c) => [c.name, c]));
                    for (const o of offeredOptions) {
                      const clean = stripMarkup(o.description);
                      const cardMatch = clean.match(/add \d+ (.+?) to your Deck/i);
                      if (cardMatch) {
                        const card = cardMap.get(cardMatch[1]);
                        if (card) {
                          const kw = card.keywords?.length ? ` [${card.keywords.join(", ")}]` : "";
                          o.cardInfo = `${card.name} (${card.type}, Cost ${card.cost ?? 0}): ${stripMarkup(card.description)}${kw}`;
                        }
                      }
                    }
                  }
                }

                // Enrich ENCHANTMENT options with enchantment descriptions
                const enchantNames: string[] = [];
                for (const o of offeredOptions) {
                  const clean = stripMarkup(o.description);
                  const enchantMatch = clean.match(/[Ee]nchant.*?with (.+?)(?:\s*\d+)?\.?$/);
                  if (enchantMatch) enchantNames.push(enchantMatch[1].replace(/\s*\d+$/, "").trim());
                }
                if (enchantNames.length > 0) {
                  const { data: enchantments } = await supabase
                    .from("enchantments")
                    .select("name, description, extra_card_text")
                    .in("name", enchantNames);
                  if (enchantments) {
                    const enchantMap = new Map(enchantments.map((e) => [e.name, e]));
                    for (const o of offeredOptions) {
                      const clean = stripMarkup(o.description);
                      const enchantMatch = clean.match(/[Ee]nchant.*?with (.+?)(?:\s*\d+)?\.?$/);
                      if (enchantMatch) {
                        const enchantName = enchantMatch[1].replace(/\s*\d+$/, "").trim();
                        const enchant = enchantMap.get(enchantName);
                        if (enchant) {
                          const extra = enchant.extra_card_text ? ` Effect: ${enchant.extra_card_text}` : "";
                          o.enchantInfo = `${enchant.name}: ${stripMarkup(enchant.description)}${extra}`;
                        }
                      }
                    }
                  }
                }

                if (offeredOptions.length > 0) {
                  const optionLines = offeredOptions
                    .map((o, i) => {
                      let line = `${i + 1}. ${o.name} — ${stripMarkup(o.description)} [${o.category}]`;
                      if (o.cardInfo) line += `\n   Card: ${o.cardInfo}`;
                      if (o.enchantInfo) line += `\n   Enchantment: ${o.enchantInfo}`;
                      return line;
                    })
                    .join("\n");
                  eventReference = `[Ancient: ${eventData.name} | ${eventData.act ?? "Unknown Act"} | Pool: ${poolSize} options]\nOffered options with categories:\n${optionLines}\n\n`;
                }
              }
            } else {
              // --- SHRINE / REGULAR EVENT ENRICHMENT ---
              // Use authoritative option descriptions from DB
              const dbOptions = eventData.options ?? [];
              if (dbOptions.length > 0) {
                const optionLines = dbOptions.map((o, i) => {
                  let desc = stripMarkup(o.description);
                  // Flag random effects so the model doesn't cherry-pick targets
                  if (desc.toLowerCase().includes("random")) {
                    desc += " [RANDOM — player does NOT choose targets]";
                  }
                  return `${i + 1}. ${o.title} — ${desc}`;
                }).join("\n");
                eventReference = `[Event: ${eventData.name} | ${eventData.act ?? "Unknown Act"}]\nAuthoritative option descriptions:\n${optionLines}\n\n`;
              }
            }
          }
        } catch (err) {
          console.error("[Evaluate] Event enrichment failed:", err);
          // Non-critical — continue without enrichment
        }
      }
    }

    let mapPromptFull = "";
    if (eventReference) mapPromptFull += eventReference;
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
    const callOptions = {
      model: anthropic(EVAL_MODELS.default),
      maxOutputTokens: 2048,
      system: systemPrompt,
      prompt: mapPromptFull,
      // Default is 2 retries. Bump to 3 so one more exponential-backoff
      // attempt covers short rate-limit windows without blowing past the
      // Next.js function timeout.
      maxRetries: 3,
    };

    // Scorer context — hoisted so the NoObjectGeneratedError recovery path
    // can access them to reassemble a full MapCoachOutputRaw response.
    let scored: ScoredPath[] = [];
    let winner: ScoredPath | undefined;
    let confidence = 0.5;
    let branches: DerivedBranch[] = [];
    let narratorInput: NarratorInput | undefined;

    try {
      // Map coach has its own return path — the scorer runs deterministically
      // on the server and the LLM only produces narrator text. We assemble
      // the final MapCoachOutputRaw response so the desktop's adapter shape
      // stays stable.
      if (isMapEval) {
        const compliance = body.mapCompliance;
        if (!compliance || !compliance.enrichedPaths || !compliance.runState) {
          return NextResponse.json(
            { error: "Missing map compliance inputs" },
            { status: 400 },
          );
        }

        scored = scorePaths(
          compliance.enrichedPaths,
          compliance.runState,
          { cardRemovalCost: compliance.cardRemovalCost },
        );
        if (scored.length === 0) {
          return NextResponse.json(
            { error: "No candidate paths to score" },
            { status: 400 },
          );
        }
        winner = scored[0];
        const runnerUp = scored[1];

        confidence = (() => {
          if (!runnerUp) return 0.95;
          const gap = winner.score - runnerUp.score;
          const gapRatio = gap / Math.max(1, Math.abs(winner.score));
          if (gapRatio >= 0.25) return 0.95;
          if (gapRatio >= 0.15) return 0.80;
          if (gapRatio >= 0.07) return 0.65;
          return 0.50;
        })();

        branches = runnerUp
          ? deriveBranches(winner, runnerUp, { confidence })
          : [];

        narratorInput = buildNarratorInput(
          winner,
          scored.slice(1, 3),
          compliance.runState,
        );

        const mapResult = await generateText({
          ...callOptions,
          system: MAP_NARRATOR_PROMPT,
          prompt: `INPUT:\n${JSON.stringify(narratorInput)}`,
          output: Output.object({ schema: mapNarratorOutputSchema }),
        });

        logUsage(supabase, {
          userId: body.userId ?? null,
          evalType: evalType,
          model: EVAL_MODELS.default,
          inputTokens: mapResult.usage.inputTokens ?? 0,
          outputTokens: mapResult.usage.outputTokens ?? 0,
        }).catch(console.error);

        const narratorText = sanitizeMapNarratorOutput(mapResult.output);

        return NextResponse.json(
          sanitizeMapCoachOutput(
            assembleMapResponse({ scored, winner, confidence, branches, narratorInput, narratorText }),
          ),
        );
      }

      const result = isSimpleEval
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
        // Attempt to repair trailing commas in LLM-generated JSON
        if (error.text) {
          const repaired = repairJson(error.text);
          if (repaired !== error.text) {
            try {
              const repairedJson: unknown = JSON.parse(repaired);
              // Parse with the schema matching the current eval so the
              // resulting value is narrowly typed (no cast needed).
              if (isMapEval && winner && narratorInput) {
                // Reassemble a full MapCoachOutputRaw using the repaired narrator
                // text + the scorer variables that are still in scope. The desktop's
                // adaptMapCoach expects the complete shape — a partial narrator-only
                // response would crash it.
                const parsed = mapNarratorOutputSchema.parse(repairedJson);
                console.log("[Evaluate] Map narrator JSON repaired (trailing comma)");
                if (error.usage) {
                  logUsage(supabase, {
                    userId: body.userId ?? null,
                    evalType: evalType,
                    model: EVAL_MODELS.default,
                    inputTokens: error.usage.inputTokens ?? 0,
                    outputTokens: error.usage.outputTokens ?? 0,
                  }).catch(console.error);
                }
                const narratorText = sanitizeMapNarratorOutput(parsed);
                return NextResponse.json(
                  sanitizeMapCoachOutput(
                    assembleMapResponse({ scored, winner, confidence, branches, narratorInput, narratorText }),
                  ),
                );
              }
              const schema = isSimpleEval ? simpleEvalSchema : genericEvalSchema;
              const parsed = schema.parse(repairedJson);
              console.log("[Evaluate] Map/freeform JSON repaired (trailing comma)");
              if (error.usage) {
                logUsage(supabase, {
                  userId: body.userId ?? null,
                  evalType: evalType,
                  model: EVAL_MODELS.default,
                  inputTokens: error.usage.inputTokens ?? 0,
                  outputTokens: error.usage.outputTokens ?? 0,
                }).catch(console.error);
              }
              return NextResponse.json(parsed);
            } catch {
              // Repair didn't help — fall through to original error handling
            }
          }
        }

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

  // Win rates — fed into the scorer's modifier stack via `winRatesById`.
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

  // Community tier list consensus — prior for the card_reward scorer.
  let communityTierMap: Awaited<ReturnType<typeof getCommunityTierSignals>> = new Map();
  try {
    communityTierMap = await getCommunityTierSignals(
      supabase,
      items.map((i) => i.id),
      context.character,
      gameVersion,
    );
  } catch (err) {
    console.warn("[Evaluate] Community tier signal fetch failed:", err);
    // Non-critical — continue without the signal
  }

  // Card reward enrichment — produces `deckState` and `taggedOffers` for
  // the scorer short-circuit below. Only fires for card_reward; shop
  // rebuilds deckState inline from context.
  let deckState: ReturnType<typeof computeDeckState> | null = null;
  let taggedOffers: Parameters<typeof formatCardFacts>[1] | null = null;
  if (type === "card_reward" && body.context) {
    try {
      // EvaluationContext doesn't declare hp / upcoming fields, but callers
      // may send them in the JSON body (duck-typed request). Widen through
      // `unknown` so the enrichment works whether the client populates them
      // or not.
      const ctxExt = body.context as typeof body.context & {
        hp?: { current?: number; max?: number };
        upcomingNodeType?: "elite" | "monster" | "boss" | "rest" | "shop" | "event" | "treasure" | "unknown" | null;
        bossesPossible?: string[];
        dangerousMatchups?: string[];
      };
      const deckCards = ctxExt.deckCards ?? [];
      const relics = ctxExt.relics ?? [];
      const actRaw = ctxExt.act ?? 1;
      const act = (actRaw >= 1 && actRaw <= 3 ? actRaw : 1) as 1 | 2 | 3;
      const hpMax = ctxExt.hp?.max ?? 0;
      const hpCurrent = ctxExt.hp?.current ?? (
        ctxExt.hpPercent != null && hpMax > 0
          ? Math.round(ctxExt.hpPercent * hpMax)
          : 0
      );

      const localDeckState = computeDeckState({
        deck: deckCards as unknown as Parameters<typeof computeDeckState>[0]["deck"],
        relics: relics as unknown as Parameters<typeof computeDeckState>[0]["relics"],
        act,
        floor: ctxExt.floor ?? 0,
        ascension: ctxExt.ascension ?? 0,
        hp: { current: hpCurrent, max: hpMax },
        upcomingNodeType: ctxExt.upcomingNodeType ?? null,
        bossesPossible: ctxExt.bossesPossible ?? [],
        dangerousMatchups: ctxExt.dangerousMatchups ?? [],
      });

      const siblings = items.map((it) => ({ name: it.name }));
      const localTaggedOffers = items.map((it, i) => ({
        index: i + 1,
        name: it.name,
        rarity: it.rarity ?? "",
        type: it.type ?? "",
        cost: it.cost ?? null,
        description: it.description ?? "",
        tags: tagCard(
          { name: it.name },
          localDeckState,
          siblings.filter((s) => s.name !== it.name),
          deckCards.map((c) => ({ name: c.name })),
        ),
      }));

      deckState = localDeckState;
      taggedOffers = localTaggedOffers;
    } catch (err) {
      console.error("[Evaluate] card reward enrichment failed, continuing without:", err);
      // Leaves deckState/taggedOffers null — scorer short-circuit below
      // will be skipped and the request returns a 500 from the
      // unreachable-fallthrough handler.
    }
  }

  // Scorer + templated coaching short-circuit — bypasses the LLM entirely
  // for card_reward. If enrichment failed (deckState/taggedOffers null),
  // the request returns a 500 from the unreachable-fallthrough at the
  // bottom of this handler.
  if (type === "card_reward" && deckState && taggedOffers) {
    const winRatesById = new Map<string, WinRateInput>();
    for (const w of winRates ?? []) {
      winRatesById.set(w.item_id, {
        pickWinRate: w.pick_win_rate,
        skipWinRate: w.skip_win_rate,
        timesPicked: w.times_picked ?? 0,
        timesSkipped: w.times_skipped ?? 0,
      });
    }

    const itemIdsByIndex = new Map<number, string>();
    items.forEach((it, i) => itemIdsByIndex.set(i + 1, it.id));

    const scored = scoreCardOffers({
      offers: taggedOffers,
      deckState,
      communityTierById: communityTierMap,
      winRatesById,
      itemIdsByIndex,
    });

    const act = (context.act >= 1 && context.act <= 3 ? context.act : 1) as 1 | 2 | 3;
    const coaching = buildCoaching(scored, {
      act,
      floor: context.floor,
      deckSize: context.deckSize,
      committed: deckState.archetypes.committed,
    });

    const rankings: CardEvaluation[] = scored.offers.map((o) => ({
      itemId: o.itemId,
      itemName: o.itemName,
      itemIndex: o.itemIndex,
      rank: o.rank,
      tier: o.tier,
      tierValue: o.tierValue,
      synergyScore: 50,
      confidence: Math.round(coaching.confidence * 100),
      recommendation:
        o.rank === 1 && !scored.skipRecommended
          ? "strong_pick"
          : scored.skipRecommended
            ? "skip"
            : "situational",
      reasoning: o.reasoning,
      source: "claude",
    }));

    const evaluation: CardRewardEvaluation = {
      rankings,
      skipRecommended: scored.skipRecommended,
      skipReasoning: scored.skipReason,
      coaching: {
        reasoning: coaching.reasoning,
        headline: coaching.headline,
        confidence: coaching.confidence,
        keyTradeoffs: coaching.keyTradeoffs,
        teachingCallouts: coaching.teachingCallouts,
      },
      compliance: {
        scoredOffers: scored.offers.map((o) => ({
          itemId: o.itemId,
          rank: o.rank,
          tier: o.tier,
          tierValue: o.tierValue,
          breakdown: o.breakdown,
        })),
      },
    };

    // Persist each ranking for analytics — fire-and-forget.
    Promise.all(
      evaluation.rankings.map((ranking) =>
        logEvaluation(
          supabase,
          context,
          ranking,
          runId,
          gameVersion,
          body.userId ?? null,
          evalType,
          ranking.tierValue,
          undefined,
        ),
      ),
    ).catch(console.error);

    return NextResponse.json(evaluation);
  }

  // Shop scorer short-circuit — splits items into cards vs non-cards, runs
  // the card scorer for Attack/Skill/Power items and the non-card ranker for
  // removals/relics/potions, then merges into a unified ranking list.
  // Bypasses the LLM entirely. Task 10.
  if (type === "shop") {
    const cardItems = items.filter(
      (i) => i.type === "Attack" || i.type === "Skill" || i.type === "Power",
    );
    const nonCardItems = items.filter(
      (i) => !(i.type === "Attack" || i.type === "Skill" || i.type === "Power"),
    );

    const shopCommunityTierMap = await getCommunityTierSignals(
      supabase,
      cardItems.map((i) => i.id),
      context.character,
      gameVersion,
    );

    const winRatesById = new Map<string, WinRateInput>();
    for (const w of winRates ?? []) {
      winRatesById.set(w.item_id, {
        pickWinRate: w.pick_win_rate,
        skipWinRate: w.skip_win_rate,
        timesPicked: w.times_picked ?? 0,
        timesSkipped: w.times_skipped ?? 0,
      });
    }

    const itemIdsByIndex = new Map<number, string>();
    cardItems.forEach((it, i) => itemIdsByIndex.set(i + 1, it.id));

    // Rebuild tagged offers for card items only. deckState was built from
    // the enrichment pipeline (hoisted by Task 9). If it's missing (shop
    // without the card_reward enrichment path firing), compute it on the
    // spot.
    const shopDeckState = deckState ?? computeDeckState({
      deck: (context.deckCards ?? []) as unknown as Parameters<typeof computeDeckState>[0]["deck"],
      relics: (context.relics ?? []) as unknown as Parameters<typeof computeDeckState>[0]["relics"],
      act: (context.act >= 1 && context.act <= 3 ? context.act : 1) as 1 | 2 | 3,
      floor: context.floor,
      ascension: context.ascension,
      hp: { current: 0, max: 0 },
    });

    const cardTaggedOffers = cardItems.map((it, i) => ({
      index: i + 1,
      name: it.name,
      rarity: it.rarity ?? "",
      type: it.type ?? "",
      cost: it.cost ?? null,
      description: it.description ?? "",
      tags: tagCard(
        { name: it.name },
        shopDeckState,
        cardItems.filter((s) => s.id !== it.id).map((s) => ({ name: s.name })),
        (context.deckCards ?? []).map((c) => ({ name: c.name })),
      ),
    }));

    const cardScored = scoreCardOffers({
      offers: cardTaggedOffers,
      deckState: shopDeckState,
      communityTierById: shopCommunityTierMap,
      winRatesById,
      itemIdsByIndex,
    });

    const goldBudget = body.goldBudget ?? context.gold;
    const potionCount = context.potionNames.length;
    const shopAct = (context.act >= 1 && context.act <= 3 ? context.act : 1) as 1 | 2 | 3;

    const nonCardScored = scoreShopNonCards({
      items: nonCardItems.map((it, i) => ({
        itemId: it.id,
        itemName: it.name,
        itemIndex: cardItems.length + i + 1,
        cost: it.cost ?? 0,
        description: it.description ?? "",
      })),
      act: shopAct,
      goldBudget,
      potionCount,
    });

    type MergedEntry = {
      itemId: string;
      itemName: string;
      itemIndex: number;
      tier: TierLetter;
      tierValue: number;
      reasoning: string;
    };
    const merged: MergedEntry[] = [
      ...cardScored.offers.map((o) => ({
        itemId: o.itemId,
        itemName: o.itemName,
        itemIndex: o.itemIndex,
        tier: o.tier,
        tierValue: o.tierValue,
        reasoning: o.reasoning,
      })),
      ...nonCardScored.map((n) => ({
        itemId: n.itemId,
        itemName: n.itemName,
        itemIndex: n.itemIndex,
        tier: n.tier,
        tierValue: n.tierValue,
        reasoning: n.reasoning,
      })),
    ];
    merged.sort((a, b) => (b.tierValue - a.tierValue) || (a.itemIndex - b.itemIndex));

    const rankings: CardEvaluation[] = merged.map((m, i) => ({
      itemId: m.itemId,
      itemName: m.itemName,
      itemIndex: m.itemIndex,
      rank: i + 1,
      tier: m.tier,
      tierValue: m.tierValue,
      synergyScore: 50,
      confidence: 90,
      recommendation:
        i === 0 && m.tierValue >= 4
          ? "strong_pick"
          : m.tierValue >= 4
            ? "good_pick"
            : "skip",
      reasoning: m.reasoning,
      source: "claude",
    }));

    const allBelowB = rankings.every((r) => r.tierValue < 4);

    const evaluation: CardRewardEvaluation = {
      rankings,
      skipRecommended: allBelowB,
      skipReasoning: allBelowB ? "No shop item clears B-tier" : null,
      coaching: {
        reasoning: {
          deckState: `${context.deckSize}-card deck, ${shopDeckState.archetypes.committed ?? "uncommitted"}`,
          commitment: `Act ${shopAct}; ${shopDeckState.archetypes.committed ?? "archetypes still open"}`,
        },
        headline:
          rankings[0] && rankings[0].tierValue >= 4
            ? `Buy ${rankings[0].itemName} — ${rankings[0].reasoning}`
            : "Save gold — nothing clears B-tier",
        confidence: 0.9,
        keyTradeoffs: [],
        teachingCallouts: [],
      },
      compliance: {
        scoredOffers: [
          ...cardScored.offers.map((o) => ({
            itemId: o.itemId,
            rank: o.rank,
            tier: o.tier,
            tierValue: o.tierValue,
            breakdown: o.breakdown,
          })),
        ],
      },
    };

    // Persist each ranking for analytics — fire-and-forget.
    Promise.all(
      evaluation.rankings.map((ranking) =>
        logEvaluation(
          supabase,
          context,
          ranking,
          runId,
          gameVersion,
          body.userId ?? null,
          evalType,
          ranking.tierValue,
          undefined,
        ),
      ),
    ).catch(console.error);

    return NextResponse.json(evaluation);
  }

  // Task 9/10/11: card_reward and shop paths short-circuit above via the
  // Phase 5 scorer. The only eval types that reach this point are the
  // LLM-driven map/event/rest/etc paths, which return inside the
  // `type === "map" && body.mapPrompt` branch. If `type` is "card_reward"
  // without a matching short-circuit (enrichment failure) or any
  // unexpected shape, there's nothing left to do — bail with a 500.
  console.error(
    "[Evaluate] Unreachable card/shop fallthrough:",
    "type=", type,
    "enrichmentMissing=", type === "card_reward" && !(deckState && taggedOffers),
  );
  return NextResponse.json(
    { error: "Evaluation pipeline misconfigured — no handler matched" },
    { status: 500 }
  );
}
