"use client";

import { useCallback } from "react";
import type { RestSiteState } from "@sts2/shared/types/game-state";
import { getPlayer } from "@sts2/shared/types/game-state";
import type { EvaluationContext, CardRewardEvaluation, CardEvaluation } from "@sts2/shared/evaluation/types";
import { tierToValue, type TierLetter } from "@sts2/shared/evaluation/tier-utils";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { buildCompactContext } from "@sts2/shared/evaluation/prompt-builder";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { registerLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import { selectMapContext } from "../../features/run/runSelectors";
import { preEvalRestWeights, applyRestWeights } from "@sts2/shared/evaluation/post-eval-weights";
import { useEvaluation, type UseEvaluationResult } from "@sts2/shared/evaluation/use-evaluation";
import { useEvaluateRestSiteMutation } from "../../services/evaluationApi";
import { useAppSelector } from "../../store/hooks";
import { selectActiveDeck, selectActivePlayer } from "../../features/run/runSelectors";
import { selectActiveRunId } from "../../features/run/runSlice";
import { buildRestContext, buildRestPromptSection } from "../../lib/build-rest-context";

const CACHE_KEY = "sts2-rest-eval-cache";

export function useRestEvaluation(
  state: RestSiteState,
): UseEvaluationResult<CardRewardEvaluation> {
  const deckCards = useAppSelector(selectActiveDeck);
  const player = useAppSelector(selectActivePlayer);
  const runId = useAppSelector(selectActiveRunId);
  const [trigger] = useEvaluateRestSiteMutation();
  const mapCtx = useAppSelector(selectMapContext);

  const options = state.rest_site.options.filter((o) => o.is_enabled);
  const enabled = options.length > 1;
  const restKey = enabled ? `rest:${state.run.floor}:${options.map((o) => o.id).join(",")}` : "disabled";

  const preEval = useCallback((): CardRewardEvaluation | null => {
    const restPlayer = getPlayer(state);
    if (!restPlayer) return null;

    const currentFloor = state.run.floor;
    const bossDistance = mapCtx?.floorsToNextBoss ?? Math.min(
      ...[17, 34, 51].filter((bf) => bf > currentFloor).map((bf) => bf - currentFloor)
    );

    const restCtx = buildRestContext({
      hp: restPlayer.hp,
      maxHp: restPlayer.max_hp,
      floorsToNextBoss: bossDistance,
      hasEliteAhead: mapCtx?.hasEliteAhead ?? false,
      hasRestAhead: mapCtx?.hasRestAhead ?? false,
      relicDescriptions: [],
      upgradeCandidates: [],
    });

    const preResult = preEvalRestWeights(
      restCtx.hpPercent,
      restCtx.missing,
      restPlayer.max_hp,
      restCtx.hasEliteAhead,
      restCtx.isBossSoon,
      options.map((o) => ({ id: o.id, name: o.name }))
    );

    return preResult.shortCircuit ?? null;
  }, [state, options]);

  const fetcher = useCallback(async (): Promise<CardRewardEvaluation> => {
    const restPlayer = getPlayer(state);
    if (!restPlayer) throw new Error("Player data unavailable");

    const ctx: EvaluationContext | null = buildEvaluationContext(state, deckCards, player);
    if (!ctx) throw new Error("Could not build evaluation context");

    updateFromContext(ctx);

    const currentFloor = state.run.floor;
    const bossDistance = mapCtx?.floorsToNextBoss ?? Math.min(
      ...[17, 34, 51].filter((bf) => bf > currentFloor).map((bf) => bf - currentFloor)
    );

    const restCtx = buildRestContext({
      hp: restPlayer.hp,
      maxHp: restPlayer.max_hp,
      floorsToNextBoss: bossDistance,
      hasEliteAhead: mapCtx?.hasEliteAhead ?? false,
      hasRestAhead: mapCtx?.hasRestAhead ?? false,
      relicDescriptions: (ctx.relics ?? []).map((r) => `${r.name}: ${r.description}`),
      upgradeCandidates: (ctx.deckCards ?? [])
        .filter((c) => !c.name.includes("+"))
        .map((c) => c.name),
    });

    ctx.hpPercent = restCtx.hpPercent;
    ctx.gold = restPlayer.gold;

    const contextStr = buildCompactContext(ctx);
    const optionsStr = options
      .map((o, i) => `${i + 1}. ${o.name} (${o.id}): ${o.description}`)
      .join("\n");

    const restPromptSection = buildRestPromptSection(restCtx, restPlayer.hp, restPlayer.max_hp);

    const raw = await trigger({
      evalType: "rest_site",
      context: ctx,
      runNarrative: getPromptContext(),
      mapPrompt: `${contextStr}

${restPromptSection}

REST SITE — choose ONE:
${optionsStr}

Respond as JSON:
{
  "rankings": [{"item_id": "OPTION_ID", "rank": 1, "tier": "S-F", "synergy_score": 0-100, "confidence": 0-100, "recommendation": "strong_pick|good_pick|situational|skip", "reasoning": "max 12 words, name card if Smith"}],
  "skip_recommended": false,
  "skip_reasoning": null
}`,
      runId,
      gameVersion: null,
    }).unwrap();

    // Parse snake_case response into CardRewardEvaluation format
    const rankings: CardEvaluation[] = (raw.rankings ?? []).map((r, i) => ({
      itemId: r.item_id,
      itemName: r.item_id,
      itemIndex: i,
      rank: r.rank,
      tier: r.tier as TierLetter,
      tierValue: tierToValue(r.tier as TierLetter),
      synergyScore: r.synergy_score,
      confidence: r.confidence,
      recommendation: r.recommendation as CardEvaluation["recommendation"],
      reasoning: r.reasoning,
      source: "claude" as const,
    }));

    // Match back to options by ID
    for (const ranking of rankings) {
      const rId = ranking.itemId.toLowerCase();
      const matchIdx = options.findIndex(
        (o) =>
          o.id.toLowerCase() === rId ||
          o.name.toLowerCase() === rId ||
          rId.includes(o.id.toLowerCase()) ||
          rId.includes(o.name.toLowerCase())
      );
      if (matchIdx !== -1) {
        ranking.itemId = options[matchIdx].id;
        ranking.itemName = options[matchIdx].name;
        ranking.itemIndex = matchIdx;
      }
    }

    const evaluation: CardRewardEvaluation = {
      rankings,
      pickSummary: raw.pick_summary ?? null,
      skipRecommended: raw.skip_recommended ?? false,
      skipReasoning: raw.skip_reasoning ?? null,
    };

    applyRestWeights(evaluation, restCtx.hpPercent, restCtx.hasEliteAhead, restCtx.isBossSoon, ctx?.deckMaturity);

    registerLastEvaluation("rest_site", {
      recommendedId: rankings?.[0]?.itemId ?? null,
      recommendedTier: rankings?.[0]?.tier ?? null,
      reasoning: rankings?.[0]?.reasoning ?? "",
      allRankings: rankings.map((r) => ({
        itemId: r.itemId,
        itemName: r.itemName,
        tier: r.tier,
        recommendation: r.recommendation,
      })),
      evalType: "rest_site",
    });

    return evaluation;
  }, [state, deckCards, player, options, runId, trigger]);

  return useEvaluation<CardRewardEvaluation>({
    cacheKey: CACHE_KEY,
    evalKey: restKey,
    enabled,
    fetcher,
    preEval,
  });
}
