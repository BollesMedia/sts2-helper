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

const SYSTEM_PROMPT = `You are an expert Slay the Spire 2 advisor. Evaluate ALL offered cards together and rank them. Always consider "skip" as an option. Respond in JSON only — no markdown, no code fences.

Confidence calibration:
- 90-100: Clear-cut (e.g., Offering in a draw-starved 3-energy deck)
- 70-89: Solid but context-dependent (e.g., 2nd Noxious Fumes in poison deck)
- 40-69: Genuinely close call (e.g., choosing between Footwork and Backflip when deck needs both)
- Below 40: Insufficient information or unfamiliar STS2 mechanic`;

interface EvaluateRequest {
  type: "card_reward" | "shop";
  context: EvaluationContext;
  items: {
    id: string;
    name: string;
    description: string;
    cost?: number;
    type?: string;
    rarity?: string;
  }[];
  runId: string | null;
  gameVersion: string | null;
}

export async function POST(request: Request) {
  const body: EvaluateRequest = await request.json();
  const { type, context, items, runId, gameVersion } = body;

  const supabase = createServiceClient();

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
      "reasoning": "1-2 sentences"
    }
  ],
  "skip_recommended": false,
  "skip_reasoning": null
}`;

  const userPrompt = `${contextStr}

${type === "card_reward" ? "Offered cards" : "Shop items"}:
${itemsStr}

Respond as JSON:
${responseFormat}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
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

    const parsed = JSON.parse(textBlock.text);
    const evaluation = parseClaudeCardRewardResponse(parsed);

    // Update item names from our items array
    for (const ranking of evaluation.rankings) {
      const matchingItem = items.find((item) => item.id === ranking.itemId);
      if (matchingItem) {
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
    console.error("Evaluation failed:", error);
    return NextResponse.json(
      { error: "Evaluation failed" },
      { status: 500 }
    );
  }
}
