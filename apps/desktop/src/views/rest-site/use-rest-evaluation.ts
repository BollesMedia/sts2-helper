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
import { loadMapContext } from "../map/map-context-cache";
import { preEvalRestWeights, applyRestWeights } from "@sts2/shared/evaluation/post-eval-weights";
import { useEvaluation, type UseEvaluationResult } from "@sts2/shared/evaluation/use-evaluation";
import { useEvaluateRestSiteMutation } from "../../services/evaluationApi";
import { useAppSelector } from "../../store/hooks";
import { selectActiveDeck, selectActivePlayer } from "../../features/run/runSelectors";
import { selectActiveRunId } from "../../features/run/runSlice";

const CACHE_KEY = "sts2-rest-eval-cache";

export function useRestEvaluation(
  state: RestSiteState,
): UseEvaluationResult<CardRewardEvaluation> {
  const deckCards = useAppSelector(selectActiveDeck);
  const player = useAppSelector(selectActivePlayer);
  const runId = useAppSelector(selectActiveRunId);
  const [trigger] = useEvaluateRestSiteMutation();

  const options = state.rest_site.options.filter((o) => o.is_enabled);
  const enabled = options.length > 1;
  const restKey = enabled ? `rest:${state.run.floor}:${options.map((o) => o.id).join(",")}` : "disabled";

  const preEval = useCallback((): CardRewardEvaluation | null => {
    const restPlayer = getPlayer(state);
    if (!restPlayer) return null;

    const hpPercent = restPlayer.max_hp > 0 ? restPlayer.hp / restPlayer.max_hp : 1;
    const missing = restPlayer.max_hp - restPlayer.hp;
    const mapCtx = loadMapContext();
    const hasEliteAhead = mapCtx?.hasEliteAhead ?? false;
    const currentFloor = state.run.floor;
    const bossDistance = mapCtx?.floorsToNextBoss ?? Math.min(
      ...[17, 34, 51].filter((bf) => bf > currentFloor).map((bf) => bf - currentFloor)
    );
    const hasBossNear = bossDistance <= 3;

    const preResult = preEvalRestWeights(
      hpPercent,
      missing,
      restPlayer.max_hp,
      hasEliteAhead,
      hasBossNear,
      options.map((o) => ({ id: o.id, name: o.name }))
    );

    return preResult.shortCircuit ?? null;
  }, [state, options]);

  const fetcher = useCallback(async (): Promise<CardRewardEvaluation> => {
    const restPlayer = getPlayer(state);
    if (!restPlayer) throw new Error("Player data unavailable");

    const hpPercent = restPlayer.max_hp > 0 ? restPlayer.hp / restPlayer.max_hp : 1;
    const missing = restPlayer.max_hp - restPlayer.hp;
    const mapCtx = loadMapContext();
    const hasEliteAhead = mapCtx?.hasEliteAhead ?? false;
    const currentFloor = state.run.floor;
    const bossDistance = mapCtx?.floorsToNextBoss ?? Math.min(
      ...[17, 34, 51].filter((bf) => bf > currentFloor).map((bf) => bf - currentFloor)
    );
    const hasBossNear = bossDistance <= 3;

    const ctx: EvaluationContext | null = buildEvaluationContext(state, deckCards, player);
    if (!ctx) throw new Error("Could not build evaluation context");

    updateFromContext(ctx);
    ctx.hpPercent = hpPercent;
    ctx.gold = restPlayer.gold;

    const contextStr = buildCompactContext(ctx);
    const optionsStr = options
      .map((o, i) => `${i + 1}. ${o.name} (${o.id}): ${o.description}`)
      .join("\n");

    // Compute passive healing from relics
    const relicDescs = (ctx.relics ?? []).map((r) => `${r.name}: ${r.description}`.toLowerCase());
    let passiveHealPerCombat = 0;
    for (const desc of relicDescs) {
      const healMatch = desc.match(/(?:end of combat|after combat|heal)\D*(\d+)\s*hp/);
      if (healMatch) passiveHealPerCombat += parseInt(healMatch[1], 10);
      if (desc.includes("meat on the bone")) passiveHealPerCombat += 6;
    }

    const missingPercent = Math.round((missing / Math.max(1, restPlayer.max_hp)) * 100);
    const floor = state.run.floor;
    const hasRestAhead = mapCtx?.hasRestAhead ?? false;
    const floorsToNextBoss = bossDistance;
    const isBossNext = floorsToNextBoss <= 1;
    const isBossSoon = floorsToNextBoss <= 3;

    const effectivePassiveHeal = isBossNext ? 0 : passiveHealPerCombat;
    const effectiveMissing = Math.max(0, missing - effectivePassiveHeal);
    const effectiveHpPercent = Math.round(((restPlayer.max_hp - effectiveMissing) / Math.max(1, restPlayer.max_hp)) * 100);

    const upgradeCandidates = (ctx.deckCards ?? [])
      .filter((c) => !c.name.includes("+"))
      .map((c) => c.name);
    const uniqueCandidates = [...new Set(upgradeCandidates)];
    const upgradeNote = uniqueCandidates.length > 0
      ? `UPGRADEABLE (only these can be upgraded): ${uniqueCandidates.join(", ")}\nCards with + are ALREADY upgraded and CANNOT be upgraded again. Do NOT recommend upgrading any card with + in its name.`
      : "No upgradeable cards remaining — all cards have been upgraded.";

    const raw = await trigger({
      evalType: "rest_site",
      context: ctx,
      runNarrative: getPromptContext(),
      mapPrompt: `${contextStr}

HP: ${restPlayer.hp}/${restPlayer.max_hp} (${Math.round((restPlayer.hp / Math.max(1, restPlayer.max_hp)) * 100)}%) | Missing: ${missing} HP | Rest heals: ${Math.min(missing, Math.floor(restPlayer.max_hp * 0.3))} HP (capped at missing)
${isBossNext ? `⚠ BOSS IS NEXT FLOOR. Passive healing will NOT apply. Current HP is your boss HP.` : `Passive healing per combat: ${passiveHealPerCombat} HP | Effective missing: ${effectiveMissing} | Effective HP: ${effectiveHpPercent}%`}
${hasEliteAhead && !isBossNext ? `⚠ ELITE FIGHT AHEAD on the current path. Factor elite damage (~20-30 HP) into heal decision.` : ""}
${!isBossNext && isBossSoon ? `Boss in ${floorsToNextBoss} floors.` : ""}
${!hasRestAhead && !isBossNext ? `No rest site ahead before boss — this is the last chance to heal.` : ""}
${upgradeNote}

REST SITE — choose ONE:
${optionsStr}

CONTEXT: Missing ${missingPercent}% HP. Effective HP after passive healing: ${effectiveHpPercent}%. Consider whether upgrading a key card provides more long-term value than healing chip damage.

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

    applyRestWeights(evaluation, hpPercent, hasEliteAhead, hasBossNear, ctx?.deckMaturity);

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
