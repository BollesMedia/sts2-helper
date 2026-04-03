"use client";

import { useCallback } from "react";
import type { EventState } from "@sts2/shared/types/game-state";
import type { EvaluationContext, CardRewardEvaluation, CardEvaluation } from "@sts2/shared/evaluation/types";
import { tierToValue, type TierLetter } from "@sts2/shared/evaluation/tier-utils";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { buildCompactContext } from "@sts2/shared/evaluation/prompt-builder";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { registerLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import { useEvaluation, type UseEvaluationResult } from "@sts2/shared/evaluation/use-evaluation";
import { useEvaluateEventMutation } from "../../services/evaluationApi";
import { useAppSelector } from "../../store/hooks";
import { selectActiveDeck, selectActivePlayer } from "../../features/run/runSelectors";
import { selectActiveRunId } from "../../features/run/runSlice";
import { initRelicLookup, getRelicDescription } from "../../lib/relic-lookup";
import { getEnchantmentDescription } from "../../lib/enchantment-lookup";

const CACHE_KEY = "sts2-event-eval-cache";

export function useEventEvaluation(
  state: EventState,
): UseEvaluationResult<CardRewardEvaluation> {
  const deckCards = useAppSelector(selectActiveDeck);
  const player = useAppSelector(selectActivePlayer);
  const runId = useAppSelector(selectActiveRunId);
  const [trigger] = useEvaluateEventMutation();

  initRelicLookup();
  const options = state.event.options.filter((o) => !o.is_proceed && !o.is_locked);
  const enabled = options.length > 1;
  const eventKey = enabled ? `${state.event.event_id}:${options.map((o) => o.index).join(",")}` : "disabled";

  const fetcher = useCallback(async (): Promise<CardRewardEvaluation> => {
    const ctx: EvaluationContext | null = buildEvaluationContext(state, deckCards, player);
    if (!ctx) throw new Error("Could not build evaluation context");

    updateFromContext(ctx);

    const contextStr = buildCompactContext(ctx);
    const optionsStr = options
      .map((o, i) => {
        let text = `${i + 1}. ${o.title}: ${o.description}`;
        if (o.relic_name) {
          const relicDesc = o.relic_description || getRelicDescription(o.relic_name);
          text += ` [Relic: ${o.relic_name}`;
          if (relicDesc) text += ` — ${relicDesc}`;
          text += "]";
        }
        // Check for enchantment references in the description
        const enchantDesc = getEnchantmentDescription(o.description);
        if (enchantDesc) {
          text += ` [Enchantment effect: ${enchantDesc}]`;
        }
        return text;
      })
      .join("\n");

    const raw = await trigger({
      evalType: "event",
      context: ctx,
      runNarrative: getPromptContext(),
      mapPrompt: `${contextStr}

EVENT: ${state.event.event_name}${state.event.is_ancient ? " (ANCIENT — this is an STS2-specific event. Do NOT assume you know what enchantments, relics, or effects do. Evaluate ONLY from the descriptions provided. If an option mentions an enchantment or effect you don't recognize, set confidence below 50.)" : ""}
You must choose EXACTLY ONE option:
${optionsStr}

This is an exclusive choice. Recommend ONE best option as "strong_pick". The others should be "situational" or "skip" — they are alternatives you're NOT recommending.

Respond as JSON:
{
  "rankings": [
    {
      "item_id": "EVENT_1",
      "rank": 1,
      "tier": "S|A|B|C|D|F",
      "synergy_score": 0-100,
      "confidence": 0-100,
      "recommendation": "strong_pick|good_pick|situational|skip",
      "reasoning": "Max 12 words"
    }
  ],
  "skip_recommended": false,
  "skip_reasoning": null
}

Use item_id EVENT_1, EVENT_2, EVENT_3 matching the numbered options above.`,
      runId,
      gameVersion: null,
    }).unwrap();

    // Parse snake_case response into CardRewardEvaluation format
    const rankings: CardEvaluation[] = (raw.rankings ?? []).map((r) => {
      const indexMatch = r.item_id.match(/(\d+)$/);
      const oneIndexed = indexMatch ? parseInt(indexMatch[1], 10) : 0;
      const optIndex = oneIndexed - 1;

      return {
        itemId: r.item_id,
        itemName: options[optIndex]?.title ?? r.item_id,
        itemIndex: optIndex,
        rank: r.rank,
        tier: r.tier as TierLetter,
        tierValue: tierToValue(r.tier as TierLetter),
        synergyScore: r.synergy_score,
        confidence: r.confidence,
        recommendation: r.recommendation as CardEvaluation["recommendation"],
        reasoning: r.reasoning,
        source: "claude" as const,
      };
    });

    const evaluation: CardRewardEvaluation = {
      rankings,
      pickSummary: raw.pick_summary ?? null,
      skipRecommended: raw.skip_recommended ?? false,
      skipReasoning: raw.skip_reasoning ?? null,
    };

    registerLastEvaluation("event", {
      recommendedId: rankings?.[0]?.itemId ?? null,
      recommendedTier: rankings?.[0]?.tier ?? null,
      reasoning: rankings?.[0]?.reasoning ?? "",
      allRankings: rankings.map((r) => ({
        itemId: r.itemId,
        itemName: r.itemName,
        tier: r.tier,
        recommendation: r.recommendation,
      })),
      evalType: "event",
    });

    return evaluation;
  }, [state, deckCards, player, options, runId, trigger]);

  return useEvaluation<CardRewardEvaluation>({
    cacheKey: CACHE_KEY,
    evalKey: eventKey,
    enabled,
    fetcher,
  });
}
