"use client";
import { apiFetch } from "../../lib/api-client";

import { useCallback, useRef, useState } from "react";
import type { RestSiteState, CombatCard } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { EvaluationContext, CardRewardEvaluation } from "../../evaluation/types";
import { buildEvaluationContext, buildPromptContext } from "../../evaluation/context-builder";
import { getPromptContext, updateFromContext } from "../../evaluation/run-narrative";
import { registerLastEvaluation } from "../../evaluation/last-evaluation-registry";
import { loadMapContext } from "../map/map-context-cache";
import { getCached, setCache } from "../../lib/local-cache";

const CACHE_KEY = "sts2-rest-eval-cache";

interface UseRestEvaluationResult {
  evaluation: CardRewardEvaluation | null;
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

export function useRestEvaluation(
  state: RestSiteState,
  deckCards: CombatCard[],
  player: TrackedPlayer | null,
  runId: string | null = null
): UseRestEvaluationResult {
  const options = state.rest_site.options.filter((o) => o.is_enabled);

  if (options.length <= 1) {
    return { evaluation: null, isLoading: false, error: null, retry: () => {} };
  }

  const restKey = `rest:${state.run.floor}:${options.map((o) => o.id).join(",")}`;

  const cachedRef = useRef<string | null>(null);
  const initialEval = cachedRef.current !== restKey ? getCached<CardRewardEvaluation>(CACHE_KEY, restKey) : null;

  const [evaluation, setEvaluation] = useState<CardRewardEvaluation | null>(initialEval);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evaluatedKey = useRef<string>(initialEval ? restKey : "");

  cachedRef.current = restKey;

  const evaluate = useCallback(async () => {
    if (restKey === evaluatedKey.current) return;

    const cached = getCached<CardRewardEvaluation>(CACHE_KEY, restKey);
    if (cached) {
      evaluatedKey.current = restKey;
      setEvaluation(cached);
      return;
    }

    evaluatedKey.current = restKey;
    setIsLoading(true);
    setError(null);

    const ctx: EvaluationContext | null = buildEvaluationContext(
      state,
      deckCards,
      player
    );

    if (!ctx) {
      setError("Could not build evaluation context");
      setIsLoading(false);
      return;
    }

    updateFromContext(ctx);

    const restPlayer = state.rest_site.player;
    ctx.hpPercent = restPlayer.max_hp > 0 ? restPlayer.hp / restPlayer.max_hp : 1;
    ctx.gold = restPlayer.gold;

    const contextStr = buildPromptContext(ctx);
    const optionsStr = options
      .map((o, i) => `${i + 1}. ${o.name} (${o.id}): ${o.description}`)
      .join("\n");

    // Compute passive healing per combat from relics
    const relicDescs = (ctx.relics ?? []).map((r) => `${r.name}: ${r.description}`.toLowerCase());
    let passiveHealPerCombat = 0;
    for (const desc of relicDescs) {
      // Match patterns like "heal 6 hp" at end of combat
      const healMatch = desc.match(/(?:end of combat|after combat|heal)\D*(\d+)\s*hp/);
      if (healMatch) passiveHealPerCombat += parseInt(healMatch[1], 10);
      // Meat on the Bone: heal 12 HP if below 50% at end of combat
      if (desc.includes("meat on the bone")) passiveHealPerCombat += 6; // average value
    }

    const missing = restPlayer.max_hp - restPlayer.hp;
    const floor = state.run.floor;

    // Detect if boss is imminent — boss floors are typically 17, 34, 51
    const bossFloors = [17, 34, 51];
    const isBossNext = bossFloors.some((bf) => floor >= bf - 1 && floor < bf);
    const floorsToNextBoss = Math.min(...bossFloors.filter((bf) => bf > floor).map((bf) => bf - floor));

    // Load cached map context for upcoming threat awareness
    const mapCtx = loadMapContext();
    const hasEliteAhead = mapCtx?.hasEliteAhead ?? false;
    const hasRestAhead = mapCtx?.hasRestAhead ?? false;
    const isEliteOrBossNext = isBossNext || hasEliteAhead;

    // If boss is next, passive healing is irrelevant (no combat before the boss)
    const effectivePassiveHeal = isBossNext ? 0 : passiveHealPerCombat;
    const effectiveMissing = Math.max(0, missing - effectivePassiveHeal);
    const effectiveHpPercent = Math.round(((restPlayer.max_hp - effectiveMissing) / Math.max(1, restPlayer.max_hp)) * 100);

    // Find best upgrade target candidates (unupgraded cards only)
    const upgradeCandidates = (ctx.deckCards ?? [])
      .filter((c) => !c.name.includes("+"))
      .map((c) => c.name);
    // Deduplicate (multiple copies of same card)
    const uniqueCandidates = [...new Set(upgradeCandidates)];
    const upgradeNote = uniqueCandidates.length > 0
      ? `UPGRADEABLE (only these can be upgraded): ${uniqueCandidates.join(", ")}\nCards with + are ALREADY upgraded and CANNOT be upgraded again. Do NOT recommend upgrading any card with + in its name.`
      : "No upgradeable cards remaining — all cards have been upgraded.";

    try {
      const res = await apiFetch("/api/evaluate", {
        method: "POST",
        body: JSON.stringify({
          type: "map",
          context: ctx,
          runNarrative: getPromptContext(),
          mapPrompt: `${contextStr}

HP: ${restPlayer.hp}/${restPlayer.max_hp} (${Math.round((restPlayer.hp / Math.max(1, restPlayer.max_hp)) * 100)}%) | Missing: ${missing} HP
${isBossNext ? `⚠ BOSS IS NEXT FLOOR. Passive healing will NOT apply. Current HP is your boss HP.` : `Passive healing per combat: ${passiveHealPerCombat} HP | Effective missing: ${effectiveMissing} | Effective HP: ${effectiveHpPercent}%`}
${hasEliteAhead && !isBossNext ? `⚠ ELITE FIGHT AHEAD on the current path. Factor elite damage (~20-30 HP) into heal decision.` : ""}
${!isBossNext && floorsToNextBoss <= 3 ? `Boss in ${floorsToNextBoss} floors.` : ""}
${!hasRestAhead && !isBossNext ? `No rest site ahead before boss — this is the last chance to heal.` : ""}
${upgradeNote}

REST SITE — choose ONE:
${optionsStr}

${isBossNext ? `BOSS NEXT: Heal if missing >15% HP. Only upgrade if HP >85%.` : isEliteOrBossNext ? `ELITE/BOSS AHEAD: Heal if HP <50%. The player needs HP to survive the upcoming fight. Only upgrade if HP >65%.` : `UPGRADE IS DEFAULT at >50% HP. Heal if HP <40%.`} If recommending Smith, NAME the specific card. Already-upgraded cards (with +) cannot be upgraded.

Respond as JSON:
{
  "rankings": [{"item_id": "OPTION_ID", "rank": 1, "tier": "S-F", "synergy_score": 0-100, "confidence": 0-100, "recommendation": "strong_pick|good_pick|situational|skip", "reasoning": "max 12 words, name card if Smith"}],
  "skip_recommended": false,
  "skip_reasoning": null
}`,
          runId,
          gameVersion: null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Evaluation failed: ${res.status}`);
      }

      const data = await res.json();

      // Parse map-style response into CardRewardEvaluation format
      const rankings = (data.rankings ?? []).map((r: { item_id: string; rank: number; tier: string; synergy_score: number; confidence: number; recommendation: string; reasoning: string }, i: number) => ({
        itemId: r.item_id,
        itemName: r.item_id,
        itemIndex: i,
        rank: r.rank,
        tier: r.tier,
        tierValue: { S: 6, A: 5, B: 4, C: 3, D: 2, F: 1 }[r.tier] ?? 3,
        synergyScore: r.synergy_score,
        confidence: r.confidence,
        recommendation: r.recommendation,
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
        pickSummary: data.pick_summary ?? null,
        skipRecommended: data.skip_recommended ?? false,
        skipReasoning: data.skip_reasoning ?? null,
      };

      setEvaluation(evaluation);
      setCache(CACHE_KEY, restKey, evaluation);
      registerLastEvaluation("rest_site", {
        recommendedId: rankings?.[0]?.itemId ?? null,
        reasoning: rankings?.[0]?.reasoning ?? "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setIsLoading(false);
    }
  }, [state, deckCards, player, options, restKey, runId]);

  const retry = () => {
    evaluatedKey.current = "";
    setError(null);
    setEvaluation(null);
  };

  if (restKey !== evaluatedKey.current && !isLoading) {
    evaluate();
  }

  return { evaluation, isLoading, error, retry };
}
