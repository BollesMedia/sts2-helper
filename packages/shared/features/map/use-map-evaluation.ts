"use client";
import { apiFetch } from "../../lib/api-client";

import { useCallback, useRef, useState } from "react";
import type { MapState, CombatCard } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { EvaluationContext } from "../../evaluation/types";
import { buildEvaluationContext } from "../../evaluation/context-builder";
import { buildCompactContext } from "../../evaluation/prompt-builder";
import { getPromptContext, updateFromContext } from "../../evaluation/run-narrative";
import { registerLastEvaluation } from "../../evaluation/last-evaluation-registry";
import { NODE_TYPE_ICONS } from "./map-scoring";
import { saveMapContext } from "./map-context-cache";
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
  recommendedPath: { col: number; row: number }[];
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
  const lastEvalContext = useRef<{ hpPercent: number; deckSize: number; recommendedNodes: Set<string> } | null>(null);

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

    // Skip re-eval if user is following the recommended path and context hasn't changed significantly
    const currentPos = state.map?.current_position;
    const prev = lastEvalContext.current;
    if (prev && currentPos) {
      const onRecommendedPath = prev.recommendedNodes.has(`${currentPos.col},${currentPos.row}`);
      const mapPlayer = state.player ?? state.map?.player;
      const hpPercent = mapPlayer && mapPlayer.max_hp > 0 ? mapPlayer.hp / mapPlayer.max_hp : 1;
      const hpSimilar = Math.abs(hpPercent - prev.hpPercent) < 0.15;
      const deckSimilar = Math.abs(deckCards.length - prev.deckSize) <= 1;

      if (onRecommendedPath && hpSimilar && deckSimilar) {
        evaluatedKey.current = mapKey;
        // Cache path (not rankings — their optionIndex values are stale for the new options)
        if (evaluation) {
          setCache(CACHE_KEY, mapKey, { ...evaluation, rankings: [] });
        }
        return;
      }
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
    const mapPlayer = state.player ?? state.map?.player;
    if (mapPlayer) {
      ctx.gold = mapPlayer.gold;
      ctx.hpPercent = mapPlayer.max_hp > 0 ? mapPlayer.hp / mapPlayer.max_hp : 1;
    }

    const contextStr = buildCompactContext(ctx);

    // Build a node lookup for path tracing
    const allNodes = state.map?.nodes ?? [];
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

    // Cache map context for other evaluations (rest site, etc.)
    const nextNodeTypes = options.map((o) => o.type);
    const allFutureNodeTypes = allNodes.filter((n) => n.row > currentRow).map((n) => n.type);
    saveMapContext({
      floor: state.run.floor,
      nextNodeTypes,
      floorsToNextBoss: Math.min(...[17, 34, 51].filter((bf) => bf > state.run.floor).map((bf) => bf - state.run.floor)),
      hasEliteAhead: allFutureNodeTypes.includes("Elite"),
      hasRestAhead: allFutureNodeTypes.includes("RestSite"),
      hasShopAhead: allFutureNodeTypes.includes("Shop"),
    });

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

HP: ${mapPlayer?.hp ?? 0}/${mapPlayer?.max_hp ?? 0} (${Math.round(((mapPlayer?.hp ?? 0) / Math.max(1, mapPlayer?.max_hp ?? 1)) * 100)}%) | Gold: ${mapPlayer?.gold ?? 0}g | Removal cost: ${player?.cardRemovalCost ?? "?"}g
Map: ${mapOverview} | Boss in ${state.map.boss.row - currentRow} floors

Paths (each line = node in order, ├─ = branch point):
${optionsStr}

Return EXACTLY ${options.length} rankings — ONE per path option (${options.map((o, i) => `${i + 1}=${o.type}`).join(", ")}). Evaluate the WHOLE path, not individual nodes.`,
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
        recommendedPath: Array.isArray(data.recommended_path)
          ? data.recommended_path.map((p: { col: number; row: number }) => ({ col: p.col, row: p.row }))
          : [],
      };

      setEvaluation(parsed);
      setCache(CACHE_KEY, mapKey, parsed);

      // Track context for skip-re-eval logic
      const mp = state.player ?? state.map?.player;
      const recommendedNodes = new Set<string>();
      // Include all next options (the user could pick any recommended one)
      for (const opt of options) {
        recommendedNodes.add(`${opt.col},${opt.row}`);
        // Include nodes reachable from each option
        for (const lead of opt.leads_to) {
          recommendedNodes.add(`${lead.col},${lead.row}`);
        }
      }
      // Include explicit recommended path from evaluation
      for (const p of parsed.recommendedPath) {
        recommendedNodes.add(`${p.col},${p.row}`);
      }
      lastEvalContext.current = {
        hpPercent: mp && mp.max_hp > 0 ? mp.hp / mp.max_hp : 1,
        deckSize: deckCards.length,
        recommendedNodes,
      };

      registerLastEvaluation("map", {
        recommendedId: parsed.rankings?.[0]?.nodeType ?? null,
        recommendedTier: parsed.rankings?.[0]?.tier ?? null,
        reasoning: parsed.rankings?.[0]?.reasoning ?? parsed.overallAdvice ?? "",
        allRankings: (parsed.rankings ?? []).map((r) => ({
          itemId: r.nodeType,
          itemName: r.nodeType,
          tier: r.tier,
          recommendation: r.recommendation,
        })),
        evalType: "map",
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
