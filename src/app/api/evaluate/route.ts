import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import type { EvaluationContext } from "@/evaluation/types";
import { buildPromptContext } from "@/evaluation/context-builder";
import {
  getStatisticalEvaluation,
  logEvaluation,
  parseClaudeCardRewardResponse,
} from "@/evaluation/evaluation-service";
import { tierToValue } from "@/evaluation/tier-utils";

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You are an expert Slay the Spire 2 advisor with deep knowledge of current STS2 meta strategies, card synergies, and high-ascension play patterns. You evaluate decisions the way a top-level player would — not in a vacuum, but in the context of the current run state.

CRITICAL PRINCIPLE — DECK DISCIPLINE:
Skipping is ALWAYS a viable and often correct choice. A lean, focused deck is far stronger than a bloated one. Every card added must justify its inclusion by directly supporting the deck's win condition. Cards that are "generically good" but dilute draw consistency, energy efficiency, or archetype focus should be rated as skips. A 12-card deck that draws its key cards every fight beats a 25-card deck with individually strong cards. When in doubt, recommend skip.

CRITICAL PRINCIPLE — STARTER CARDS ARE TEMPORARY:
Strike and Defend are weak cards that will be removed from the deck over the course of the run. Do NOT evaluate synergies with Strike/Defend as meaningful — any card that "works well with Strikes" is building on a foundation that is actively being demolished. Evaluate cards based on synergy with the deck's real win condition cards, not starter cards.

Evaluate cards by asking:
1. Does this card directly advance the deck's archetype/win condition?
2. Does adding this card make the deck draw its key combos LESS consistently?
3. Would I rather see this card or my existing cards in a critical turn?
4. Is the deck at a size where adding ANY card is a net negative?
5. Am I evaluating synergy with cards that will be removed (Strike/Defend)?

For shop evaluations: card removal is often the highest-value action. Removing a Strike or Defend frequently outperforms buying a new card. Include a "spending_plan" field with a CONCISE recommended gold allocation — only list what the player CAN afford. Do NOT list items that exceed the budget or deliberate about impossible options. One clear recommendation, no alternatives.

Respond in JSON only — no markdown, no code fences.
IMPORTANT: You MUST include ALL items in your rankings array. Keep reasoning to 1 sentence max for shop evaluations with many items.

Confidence calibration:
- 90-100: Clear-cut (e.g., key archetype card the deck is missing)
- 70-89: Solid addition that supports the strategy without dilution
- 40-69: Genuinely close call — card is good but deck might not need it
- Below 40: Insufficient information or unfamiliar STS2 mechanic`;

interface EvaluateRequest {
  type: "card_reward" | "shop" | "map";
  context: EvaluationContext;
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
  const body: EvaluateRequest = await request.json();
  const { type, context, items, runId, gameVersion } = body;

  const supabase = createServiceClient();

  // ─── MAP EVALUATION ───
  if (type === "map" && body.mapPrompt) {
    try {
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: body.mapPrompt }],
      });

      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        return NextResponse.json({ error: "No response" }, { status: 502 });
      }

      let jsonText = textBlock.text.trim();
      if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      }

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
  const contextStr = buildPromptContext(context);
  const itemsStr = items
    .map(
      (item, i) =>
        `${i + 1}. ${item.name}${item.cost != null ? ` (${item.cost} energy` : ""}${item.type ? `, ${item.type}` : ""}${item.rarity ? `, ${item.rarity}` : ""}${item.cost != null ? ")" : ""} — ${item.description}`
    )
    .join("\n");

  const responseFormat =
    type === "card_reward"
      ? `{
  "rankings": [
    {
      "item_id": "CARD_ID",
      "rank": 1,
      "tier": "S|A|B|C|D|F",
      "synergy_score": 0-100,
      "confidence": 0-100,
      "recommendation": "strong_pick|good_pick|situational|skip",
      "reasoning": "1-2 sentences"
    }
  ],
  "skip_recommended": false,
  "skip_reasoning": "Only if skip is better than all options"
}`
      : `{
  "rankings": [
    {
      "item_id": "ITEM_ID",
      "rank": 1,
      "tier": "S|A|B|C|D|F",
      "synergy_score": 0-100,
      "confidence": 0-100,
      "recommendation": "strong_pick|good_pick|situational|skip",
      "reasoning": "1 sentence"
    }
  ],
  "skip_recommended": false,
  "skip_reasoning": null,
  "spending_plan": "With Xg available, I recommend: [specific purchases with costs, total spend, gold remaining]. 1-2 sentences."
}`;

  const userPrompt = `${contextStr}

${type === "card_reward" ? "Offered cards" : "Shop items"}:
${itemsStr}

Respond as JSON:
${responseFormat}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: items.length > 5 ? 4096 : 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "No text response from Claude" },
        { status: 502 }
      );
    }

    // Strip markdown code fences if Claude wraps the response
    let jsonText = textBlock.text.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(jsonText);
    const evaluation = parseClaudeCardRewardResponse(parsed);

    // Update item IDs and names from our items array
    // Claude may return different casing, add/remove "+" suffix, or use underscored names
    for (const ranking of evaluation.rankings) {
      const normalize = (s: string) =>
        s.toLowerCase().replace(/[+\s_]/g, "").replace(/plus$/, "");

      const matchingItem = items.find(
        (item) =>
          item.id.toLowerCase() === ranking.itemId.toLowerCase() ||
          normalize(item.name) === normalize(ranking.itemId) ||
          normalize(item.id) === normalize(ranking.itemId)
      );
      if (matchingItem) {
        ranking.itemId = matchingItem.id;
        ranking.itemName = matchingItem.name;
      }
    }

    // Log evaluations async (don't block response)
    Promise.all(
      evaluation.rankings.map((ranking) =>
        logEvaluation(supabase, context, ranking, runId, gameVersion)
      )
    ).catch(console.error);

    return NextResponse.json(evaluation);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("Evaluation failed:", message, stack);
    return NextResponse.json(
      { error: "Evaluation failed", detail: message },
      { status: 500 }
    );
  }
}
