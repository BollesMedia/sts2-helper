"use client";
import { apiFetch } from "../../lib/api-client";

import { useCallback, useRef, useState } from "react";
import type { MapState, CombatCard } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { EvaluationContext } from "../../evaluation/types";
import { buildEvaluationContext } from "../../evaluation/context-builder";
import { buildPromptContext } from "../../evaluation/context-builder";
import { getPromptContext, updateFromContext } from "../../evaluation/run-narrative";
import { registerLastEvaluation } from "../../evaluation/last-evaluation-registry";
import { NODE_TYPE_ICONS } from "./map-scoring";
import { getCached, setCache } from "../../lib/local-cache";

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

interface UseMapEvaluationResult {
  evaluation: MapPathEvaluation | null;
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

export function useMapEvaluation(
  state: MapState,
  deckCards: CombatCard[],
  player: TrackedPlayer | null
): UseMapEvaluationResult {
  const options = state.map.next_options;
  const mapKey = options.map((o) => `${o.col},${o.row}`).sort().join("|");

  const cachedRef = useRef<string | null>(null);
  const initialEval = cachedRef.current !== mapKey ? getCached<MapPathEvaluation>(CACHE_KEY, mapKey) : null;

  const [evaluation, setEvaluation] = useState<MapPathEvaluation | null>(initialEval);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evaluatedKey = useRef<string>(initialEval ? mapKey : "");

  cachedRef.current = mapKey;

  const evaluate = useCallback(async () => {
    if (mapKey === evaluatedKey.current) return;

    // Only one path — no decision to make
    if (options.length <= 1) {
      evaluatedKey.current = mapKey;
      return;
    }

    const cached = getCached<MapPathEvaluation>(CACHE_KEY, mapKey);
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

    updateFromContext(ctx);

    // Override context gold/HP with map state's player data (most current)
    const mapPlayer = state.map.player;
    ctx.gold = mapPlayer.gold;
    ctx.hpPercent = mapPlayer.max_hp > 0 ? mapPlayer.hp / mapPlayer.max_hp : 1;

    const contextStr = buildPromptContext(ctx);

    // Build a node lookup for path tracing
    const allNodes = state.map.nodes;
    const nodeMap = new Map<string, typeof allNodes[0]>();
    for (const n of allNodes) {
      nodeMap.set(`${n.col},${n.row}`, n);
    }

    // Build a readable tree for each option showing exact branching
    function buildTree(
      col: number,
      row: number,
      depth: number,
      maxDepth: number,
      indent: string
    ): string[] {
      const node = nodeMap.get(`${col},${row}`);
      if (!node) return [];

      const icon = NODE_TYPE_ICONS[node.type] ?? "•";
      const lines: string[] = [`${indent}${icon} ${node.type}`];

      if (depth >= maxDepth || node.children.length === 0) return lines;

      const childNodes = node.children
        .map(([cc, cr]) => nodeMap.get(`${cc},${cr}`))
        .filter(Boolean);

      if (childNodes.length === 1) {
        // Single path — continue inline
        const child = childNodes[0]!;
        lines.push(...buildTree(child.col, child.row, depth + 1, maxDepth, indent));
      } else {
        // Branching — show each branch
        for (const child of childNodes) {
          if (!child) continue;
          lines.push(`${indent}  ├─`);
          lines.push(...buildTree(child.col, child.row, depth + 1, maxDepth, indent + "  │ "));
        }
      }

      return lines;
    }

    const optionsStr = options
      .map((opt, i) => {
        const tree = buildTree(opt.col, opt.row, 0, 6, "   ");
        return `Option ${i + 1}:\n${tree.join("\n")}`;
      })
      .join("\n\n");

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
      const res = await apiFetch("/api/evaluate", {
        method: "POST",
        body: JSON.stringify({
          type: "map",
          context: ctx,
          runNarrative: getPromptContext(),
          mapPrompt: `${contextStr}

HP: ${mapPlayer.hp}/${mapPlayer.max_hp} (${Math.round((mapPlayer.hp / Math.max(1, mapPlayer.max_hp)) * 100)}%) | Gold: ${mapPlayer.gold}g | Removal cost: ${player?.cardRemovalCost ?? "?"}g
Map: ${mapOverview} | Boss in ${state.map.boss.row - currentRow} floors

Paths (each line = node in order, ├─ = branch point):
${optionsStr}

Respond as JSON:
{
  "rankings": [{"option_index": 1, "node_type": "Monster", "tier": "S-F", "confidence": 0-100, "recommendation": "strong_pick|good_pick|situational|skip", "reasoning": "max 10 words"}],
  "overall_advice": "max 15 words"
}`,
          runId: null,
          gameVersion: null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Evaluation failed: ${res.status}`);
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
      setCache(CACHE_KEY, mapKey, parsed);
      registerLastEvaluation("map", {
        recommendedId: parsed.rankings?.[0]?.nodeType ?? null,
        reasoning: parsed.rankings?.[0]?.reasoning ?? parsed.overallAdvice ?? "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setIsLoading(false);
    }
  }, [state, deckCards, player, options, mapKey]);

  const retry = () => {
    evaluatedKey.current = "";
    setError(null);
    setEvaluation(null);
  };

  if (mapKey !== evaluatedKey.current && !isLoading) {
    evaluate();
  }

  return { evaluation, isLoading, error, retry };
}
