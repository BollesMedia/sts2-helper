"use client";

import { useCallback, useRef, useState } from "react";
import type { MapState, CombatCard } from "@/lib/types/game-state";
import type { TrackedPlayer } from "@/features/connection/use-player-tracker";
import type { EvaluationContext } from "@/evaluation/types";
import { buildEvaluationContext } from "@/evaluation/context-builder";
import { buildPromptContext } from "@/evaluation/context-builder";
import { NODE_TYPE_ICONS } from "./map-scoring";

const CACHE_KEY = "sts2-map-eval-cache";

export interface MapPathEvaluation {
  rankings: {
    optionIndex: number;
    nodeType: string;
    tier: string;
    confidence: number;
    recommendation: string;
    reasoning: string;
  }[];
  overallAdvice: string | null;
}

interface CachedEvaluation {
  key: string;
  evaluation: MapPathEvaluation;
}

function getCached(key: string): MapPathEvaluation | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (!stored) return null;
    const cached: CachedEvaluation = JSON.parse(stored);
    return cached.key === key ? cached.evaluation : null;
  } catch {
    return null;
  }
}

function setCache(key: string, evaluation: MapPathEvaluation) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ key, evaluation }));
  } catch {}
}

interface UseMapEvaluationResult {
  evaluation: MapPathEvaluation | null;
  isLoading: boolean;
  error: string | null;
}

export function useMapEvaluation(
  state: MapState,
  deckCards: CombatCard[],
  player: TrackedPlayer | null
): UseMapEvaluationResult {
  const options = state.map.next_options;
  const mapKey = options.map((o) => `${o.col},${o.row}`).sort().join("|");

  const cachedRef = useRef<string | null>(null);
  const initialEval = cachedRef.current !== mapKey ? getCached(mapKey) : null;

  const [evaluation, setEvaluation] = useState<MapPathEvaluation | null>(initialEval);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evaluatedKey = useRef<string>(initialEval ? mapKey : "");

  cachedRef.current = mapKey;

  const evaluate = useCallback(async () => {
    if (mapKey === evaluatedKey.current) return;

    const cached = getCached(mapKey);
    if (cached) {
      evaluatedKey.current = mapKey;
      setEvaluation(cached);
      return;
    }

    evaluatedKey.current = mapKey;
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

    // Override context gold/HP with map state's player data (most current)
    const mapPlayer = state.map.player;
    ctx.gold = mapPlayer.gold;
    ctx.hpPercent = mapPlayer.max_hp > 0 ? mapPlayer.hp / mapPlayer.max_hp : 1;

    const contextStr = buildPromptContext(ctx);

    const optionsStr = options
      .map((opt, i) => {
        const leadsTo = opt.leads_to
          ?.map((l) => `${NODE_TYPE_ICONS[l.type] ?? ""} ${l.type}`)
          .join(", ") ?? "unknown";
        return `${i + 1}. ${NODE_TYPE_ICONS[opt.type] ?? ""} ${opt.type} (col ${opt.col}, row ${opt.row}) → leads to: ${leadsTo}`;
      })
      .join("\n");

    // Build a broader map context: count remaining node types
    const allNodes = state.map.nodes;
    const currentRow = state.map.current_position?.row ?? 0;
    const futureNodes = allNodes.filter((n) => n.row > currentRow);
    const typeCounts: Record<string, number> = {};
    for (const n of futureNodes) {
      typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
    }
    const mapOverview = Object.entries(typeCounts)
      .map(([t, c]) => `${t}: ${c}`)
      .join(", ");

    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "map",
          context: ctx,
          mapPrompt: `${contextStr}

Current HP: ${mapPlayer.hp}/${mapPlayer.max_hp} (${Math.round((mapPlayer.hp / Math.max(1, mapPlayer.max_hp)) * 100)}%)
Gold: ${mapPlayer.gold}g ${mapPlayer.gold < 75 ? "(too low for most shop purchases or card removal)" : mapPlayer.gold < 150 ? "(enough for card removal or 1-2 cheap cards)" : "(healthy gold reserve)"}

Map overview (remaining nodes ahead): ${mapOverview}
Boss at row ${state.map.boss.row}, currently at row ${currentRow}, ${state.map.boss.row - currentRow} floors to boss

Available paths:
${optionsStr}

Evaluate each path option. Consider:
- HP safety (do I need healing before hard fights?)
- Rest site proximity to elites (heal then fight)
- Deck readiness (is the deck strong enough for elites?)
- Gold and shop value (shops are only valuable if gold > 75g for card removal)
- Total fights on path (fragile decks want fewer)
- Distance to boss and preparation needed

Respond as JSON:
{
  "rankings": [
    {
      "option_index": 1,
      "node_type": "Monster",
      "tier": "S|A|B|C|D|F",
      "confidence": 0-100,
      "recommendation": "strong_pick|good_pick|situational|skip",
      "reasoning": "1 sentence"
    }
  ],
  "overall_advice": "1 sentence overall pathing strategy"
}`,
          runId: null,
          gameVersion: null,
        }),
      });

      if (!res.ok) {
        throw new Error(`Evaluation failed: ${res.status}`);
      }

      const data = await res.json();
      const parsed: MapPathEvaluation = {
        rankings: (data.rankings ?? []).map((r: { option_index: number; node_type: string; tier: string; confidence: number; recommendation: string; reasoning: string }) => ({
          optionIndex: r.option_index,
          nodeType: r.node_type,
          tier: r.tier,
          confidence: r.confidence,
          recommendation: r.recommendation,
          reasoning: r.reasoning,
        })),
        overallAdvice: data.overall_advice ?? null,
      };

      setEvaluation(parsed);
      setCache(mapKey, parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setIsLoading(false);
    }
  }, [state, deckCards, player, options, mapKey]);

  if (mapKey !== evaluatedKey.current && !isLoading) {
    evaluate();
  }

  return { evaluation, isLoading, error };
}
