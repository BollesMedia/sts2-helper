import { NextResponse } from "next/server";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createServiceClient } from "@/lib/supabase/server";
import type { EvaluationContext } from "@sts2/shared/evaluation/types";
import {
  buildSystemPrompt,
  buildCompactContext,
  compactStrategy,
  compactBossReference,
  MAP_NARRATOR_PROMPT,
  type EvalType,
} from "@sts2/shared/evaluation/prompt-builder";
import {
  bossBriefingSchema,
  buildCardRewardSchema,
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
import { deriveBranches } from "@sts2/shared/evaluation/map/derive-branches";
import { buildNarratorInput } from "@sts2/shared/evaluation/map/build-narrator-input";
import type { RunState } from "@sts2/shared/evaluation/map/run-state";
import { EVAL_MODELS } from "@sts2/shared/evaluation/models";
import { toCardRewardEvaluation } from "@sts2/shared/evaluation/parse-tool-response";
import { sanitizeRankings } from "@sts2/shared/evaluation/sanitize-rankings";
import { computeDeckState } from "@sts2/shared/evaluation/card-reward/deck-state";
import { tagCard } from "@sts2/shared/evaluation/card-reward/card-tags";
import { formatCardFacts } from "@sts2/shared/evaluation/card-reward/format-card-facts";
import { sanitizeCardRewardCoachOutput } from "@sts2/shared/evaluation/card-reward-coach-schema";
import { CARD_REWARD_SCAFFOLD } from "@sts2/shared/evaluation/prompt-builder";
import { getStatisticalEvaluation } from "@sts2/shared/evaluation/statistical-evaluator";
import { getCommunityTierSignals } from "@sts2/shared/evaluation/community-tier";
import { logEvaluation } from "@sts2/shared/evaluation/evaluation-logger";
import { tierToValue, type TierLetter } from "@sts2/shared/evaluation/tier-utils";
import { applyPostEvalWeights, buildWeightContext, adjustTier as adjustTierByDelta, reconcileSkipRecommended } from "@sts2/shared/evaluation/post-eval-weights";
import { getRunHistoryContext } from "@/evaluation/run-history-context";
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

        const scored = scorePaths(
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
        const winner = scored[0];
        const runnerUp = scored[1];

        const confidence = (() => {
          if (!runnerUp) return 0.95;
          const gap = winner.score - runnerUp.score;
          const gapRatio = gap / Math.max(1, Math.abs(winner.score));
          if (gapRatio >= 0.25) return 0.95;
          if (gapRatio >= 0.15) return 0.80;
          if (gapRatio >= 0.07) return 0.65;
          return 0.50;
        })();

        const branches = runnerUp
          ? deriveBranches(winner, runnerUp, { confidence })
          : [];

        const narratorInput = buildNarratorInput(
          winner,
          scored.slice(1, 3),
          compliance.runState,
        );

        const narratorPrompt = `${MAP_NARRATOR_PROMPT}\n\nINPUT:\n${JSON.stringify(narratorInput)}`;

        const mapResult = await generateText({
          ...callOptions,
          prompt: narratorPrompt,
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

        const macroPath = {
          floors: winner.nodes.map((n) => ({
            floor: n.floor,
            node_type: mapNodeType(n.type),
            node_id: n.nodeId ?? `${n.floor},${n.floor}`,
          })),
          summary: narratorInput.chosenPath.summary,
        };

        const response: MapCoachOutputRaw = {
          reasoning: {
            risk_capacity: narratorText.reasoning,
            act_goal: narratorText.headline,
          },
          headline: narratorText.headline,
          confidence,
          macro_path: macroPath,
          key_branches: branches,
          teaching_callouts: narratorText.teaching_callouts.map((c) => ({
            pattern: c.pattern,
            floors: [],
            explanation: c.explanation,
          })),
          compliance: {
            repaired: false,
            reranked: false,
            rerank_reason: null,
            repair_reasons: [],
            // scoredPaths telemetry flows through to choices.rankings_snapshot
            // via the desktop listener's existing `raw: parsed` channel.
            // @ts-expect-error augmenting compliance with telemetry (Task 12)
            scoredPaths: scored.map((p) => ({
              id: p.id,
              score: p.score,
              scoreBreakdown: p.scoreBreakdown,
              disqualified: p.disqualified,
              disqualifyReasons: p.disqualifyReasons,
            })),
          },
        };

        return NextResponse.json(sanitizeMapCoachOutput(response));
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
              if (isMapEval) {
                // Narrator-only recovery — the scorer already ran
                // client-side (and the server-side call above would have
                // thrown on missing compliance). Return the narrator text
                // and let the desktop fall back gracefully.
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
                return NextResponse.json(
                  {
                    error: "narrator_parse_recovered",
                    narrator: sanitizeMapNarratorOutput(parsed),
                  },
                  { status: 200 },
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

  // Community tier list consensus — prior from pro player / community sources
  let communityTierContext = "";
  try {
    const signals = await getCommunityTierSignals(
      supabase,
      items.map((i) => i.id),
      context.character,
      gameVersion,
    );
    if (signals.size > 0) {
      const ctLines = items
        .filter((i) => signals.has(i.id))
        .map((i) => {
          const s = signals.get(i.id)!;
          const agreementTag =
            s.agreement === "strong" ? " [consensus]"
            : s.agreement === "split" ? ` [sources disagree: stddev ${s.stddev.toFixed(2)}]`
            : "";
          const stalenessTag = s.staleness === "aging" ? " [aging]" : "";
          return `${i.name}: community ${s.consensusTierLetter}-tier (${s.sourceCount} source${s.sourceCount === 1 ? "" : "s"}${agreementTag})${stalenessTag}`;
        });
      if (ctLines.length > 0) {
        communityTierContext = `\n[Community tier lists]\n${ctLines.join("\n")}\nTreat as a prior; trust your analysis of the current deck over it.`;
      }
    }
  } catch (err) {
    console.warn("[Evaluate] Community tier signal fetch failed:", err);
    // Non-critical — continue without the signal
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
  if (communityTierContext) contextStr += communityTierContext;

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

  // Card reward coach enrichment. Skip for shops (phase 5) — only fires
  // when type === "card_reward". On any failure, fall through with empty
  // factsBlock/scaffold so legacy prompt behavior is preserved.
  let factsBlock = "";
  let scaffold = "";
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

      const deckState = computeDeckState({
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
      const taggedOffers = items.map((it, i) => ({
        index: i + 1,
        name: it.name,
        rarity: it.rarity ?? "",
        type: it.type ?? "",
        cost: it.cost ?? null,
        description: it.description ?? "",
        tags: tagCard(
          { name: it.name },
          deckState,
          siblings.filter((s) => s.name !== it.name),
          deckCards.map((c) => ({ name: c.name })),
        ),
      }));

      factsBlock = "\n" + formatCardFacts(deckState, taggedOffers) + "\n";
      scaffold = "\n" + CARD_REWARD_SCAFFOLD + "\n";
    } catch (err) {
      console.error("[Evaluate] card reward enrichment failed, continuing without:", err);
      // Falls through with empty factsBlock/scaffold — legacy prompt behavior.
    }
  }

  const isExclusive = body.exclusive !== false; // default true for card_reward
  const cardSchema = buildCardRewardSchema(items, type === "shop");

  const goldBudget = isShop && body.goldBudget != null ? `\nGOLD BUDGET: ${body.goldBudget}g — only recommend items you can afford. All items listed below are affordable.\n` : "";

  // Pre-computed budget summary for shop evals — placed AFTER items for Haiku recency bias
  const budgetSummary = isShop && body.goldBudget != null
    ? `\nBUDGET SUMMARY: ${body.goldBudget}g available. Exact costs: ${items.map((i) => `${i.name}=${i.cost}g`).join(", ")}. Use ONLY these exact costs in your spending_plan. Do NOT invent discounted prices.`
    : "";

  const userPrompt = `${contextStr}
${goldBudget}${factsBlock}${scaffold}
CRITICAL: This is Slay the Spire 2. Many cards have DIFFERENT effects than STS1. Evaluate ONLY by the description shown after the dash (—). Do NOT assume what a card does from its name.

${type === "card_reward" ? "Offered cards" : "Shop items (affordable only)"}:
${itemsStr}
${isExclusive ? "\nEXCLUSIVE choice — pick ONE or skip ALL. If none deserve a deck slot, set skip_recommended: true and mark all as skip." : "\nYou may select MULTIPLE items. Evaluate each independently."}
${budgetSummary}

Return exactly ${items.length} rankings using position numbers (1, 2, 3...) matching the order above.`;

  try {
    // With the card-reward coaching block (reasoning, headline, up to 3
    // tradeoffs, up to 3 callouts) layered on top of the per-card rankings,
    // a 3-card reward can easily exceed 1024 output tokens. Bump the
    // baseline so Haiku doesn't truncate its own structured output.
    const result = await generateText({
      model: anthropic(EVAL_MODELS.default),
      maxOutputTokens: items.length > 5 ? 4096 : 2048,
      system: systemPrompt,
      prompt: userPrompt,
      maxRetries: 3,
      output: Output.object({ schema: cardSchema }),
    });

    logUsage(supabase, {
      userId: body.userId ?? null,
      evalType: evalType,
      model: EVAL_MODELS.default,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    }).catch(console.error);

    console.log("[Evaluate] Card/shop output:", JSON.stringify(result.output));

    // Sanitize rankings before the camelCase adapter. See #54 for the drift
    // patterns this handles (position 0 summary entries, out-of-range
    // placeholders, out-of-order, duplicates).
    const cleanedRankings = sanitizeRankings({
      rankings: result.output.rankings,
      indexKey: "position",
      expectedCount: items.length,
    });
    if (cleanedRankings.length !== items.length) {
      console.error(
        `[Evaluate] Card/shop ranking count mismatch: expected ${items.length}, got ${cleanedRankings.length} valid (from ${result.output.rankings.length} returned). Raw:`,
        JSON.stringify(result.output.rankings),
      );
      return NextResponse.json(
        {
          error: "Ranking count mismatch",
          detail: `Expected ${items.length} rankings, got ${cleanedRankings.length} valid after sanitization`,
        },
        { status: 502 },
      );
    }
    result.output.rankings = cleanedRankings;

    // Sanitize coaching block if present (caps tradeoffs/callouts, clamps confidence).
    if (result.output.coaching) {
      result.output.coaching = sanitizeCardRewardCoachOutput(result.output.coaching);
    }

    const evaluation = toCardRewardEvaluation(result.output, items);
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
    // Strict-fail: zod validation failure (e.g. Haiku returns fewer rankings
    // than items, or returns a stringified-blob shape) → 502 with detail.
    // Replaces the previous fallback fill at the now-deleted route.ts:573-592.
    if (NoObjectGeneratedError.isInstance(error)) {
      // Attempt to repair trailing commas in LLM-generated JSON
      if (error.text) {
        const repaired = repairJson(error.text);
        if (repaired !== error.text) {
          try {
            const parsed = cardSchema.parse(JSON.parse(repaired));
            console.log("[Evaluate] Card/shop JSON repaired (trailing comma)");
            if (error.usage) {
              logUsage(supabase, {
                userId: body.userId ?? null,
                evalType: evalType,
                model: EVAL_MODELS.default,
                inputTokens: error.usage.inputTokens ?? 0,
                outputTokens: error.usage.outputTokens ?? 0,
              }).catch(console.error);
            }
            // Continue with normal post-processing
            const evaluation = toCardRewardEvaluation(parsed, items);
            return NextResponse.json(evaluation);
          } catch {
            // Repair didn't help — fall through to original error handling
          }
        }
      }

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
      console.error("[Evaluate] Card/shop schema validation failed:", detail, "raw text:", error.text);
      return NextResponse.json(
        { error: "Schema validation failed", detail },
        { status: 502 }
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    // Log the full error chain so we can tell truncation from rate-limit from
    // model halt. "No output generated" is uninformative on its own; the
    // cause + finish reason + raw text are what we need.
    const causeChain: string[] = [];
    {
      let cur: unknown = error;
      for (let i = 0; i < 4 && cur instanceof Error && cur.cause !== undefined; i++) {
        const next: unknown = cur.cause;
        if (next instanceof Error) {
          causeChain.push(`cause[${i}]: ${next.message}`);
          cur = next;
        } else {
          causeChain.push(`cause[${i}]: ${String(next)}`);
          break;
        }
      }
    }
    const noOutputExtras: string[] = [];
    if (NoObjectGeneratedError.isInstance(error)) {
      if (error.finishReason) noOutputExtras.push(`finishReason=${error.finishReason}`);
      if (error.usage) {
        noOutputExtras.push(
          `usage in=${error.usage.inputTokens ?? "?"}/out=${error.usage.outputTokens ?? "?"}`,
        );
      }
      if (error.text) noOutputExtras.push(`text[first 200]=${error.text.slice(0, 200)}`);
    }
    console.error(
      "Evaluation failed:",
      message,
      ...(noOutputExtras.length ? ["|", ...noOutputExtras] : []),
      ...(causeChain.length ? ["|", ...causeChain] : []),
    );

    // Walk the error chain — AI SDK wraps Anthropic 429s inside
    // NoObjectGeneratedError / APICallError, so the outer message often says
    // "No output generated" while the cause carries the rate-limit signal.
    const isRateLimit = (() => {
      let cur: unknown = error;
      for (let i = 0; i < 4 && cur; i++) {
        if (cur instanceof Error) {
          const m = cur.message ?? "";
          if (m.includes("429") || /rate[\s_-]?limit/i.test(m)) return true;
          // @ts-expect-error optional statusCode on API errors
          if (cur.statusCode === 429) return true;
          cur = cur.cause;
        } else {
          break;
        }
      }
      return false;
    })();
    const status = isRateLimit ? 429 : 500;
    const detail = isRateLimit
      ? "Rate limited — please wait a moment and retry"
      : "Evaluation service error";

    return NextResponse.json(
      { error: "Evaluation failed", detail },
      { status }
    );
  }
}
