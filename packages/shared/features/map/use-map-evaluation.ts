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
import { useMapEvalState } from "./map-eval-context";

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

/** Serializable version of eval context for localStorage persistence */
interface SerializedEvalContext {
  hpPercent: number;
  deckSize: number;
  act: number;
  recommendedNodesList: string[];
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

  // Eval context persists across remounts via React context (backed by localStorage)
  const mapEvalState = useMapEvalState();
  const savedCtx = mapEvalState.getEvalContext();
  const lastEvalContext = useRef<{ hpPercent: number; deckSize: number; act: number; recommendedNodes: Set<string> } | null>(
    savedCtx ? {
      hpPercent: savedCtx.hpPercent,
      deckSize: savedCtx.deckSize,
      act: savedCtx.act,
      recommendedNodes: new Set(savedCtx.recommendedNodesList),
    } : null
  );

  cachedRef.current = mapKey;

  // ─── Decision: should we evaluate? ───

  function shouldEvaluate(): boolean {
    // Gate: only 1 option → never evaluate (no decision to make)
    if (options.length <= 1) return false;

    // Rule 1: No evaluation exists → evaluate
    if (!evaluation && !getCached(CACHE_KEY, mapKey)) return true;

    const prev = lastEvalContext.current;

    // No previous context → evaluate (first launch, cache cleared)
    if (!prev) return true;

    // Act changed → always re-evaluate
    if (prev.act !== (state.run?.act ?? 0)) return true;

    // Current position null (act start, reconnection) → re-evaluate
    const currentPos = state.map?.current_position;
    if (!currentPos) return true;

    // Rule 2: User deviated from recommended path → evaluate
    const onPath = prev.recommendedNodes.has(`${currentPos.col},${currentPos.row}`);
    if (!onPath) return true;

    // Rule 3: Significant context change AT A FORK → evaluate
    const mapPlayer = state.player ?? state.map?.player;
    const hpPercent = mapPlayer && mapPlayer.max_hp > 0 ? mapPlayer.hp / mapPlayer.max_hp : 1;
    const hpDrop = prev.hpPercent - hpPercent;
    const deckGrew = deckCards.length - prev.deckSize;
    if (hpDrop > 0.15 || deckGrew > 1) return true;

    // On recommended path, context similar → don't evaluate
    return false;
  }

  // ─── Carry forward: keep existing path without re-evaluating ───

  function carryForward() {
    evaluatedKey.current = mapKey;
    if (evaluation) {
      const carried: MapPathEvaluation = {
        ...evaluation,
        rankings: [], // stale optionIndex values, clear them
      };
      // Always preserve recommendedPath
      if (!carried.recommendedPath?.length && evaluation.recommendedPath?.length) {
        carried.recommendedPath = evaluation.recommendedPath;
      }
      setCache(CACHE_KEY, mapKey, carried);
    }
  }

  // ─── Main evaluation function ───

  const evaluate = useCallback(async () => {
    if (mapKey === evaluatedKey.current) return;

    // Check cache first
    const cached = getCached<MapPathEvaluation>(CACHE_KEY, mapKey);
    if (cached) {
      evaluatedKey.current = mapKey;
      setEvaluation(cached);
      return;
    }

    const targetKey = mapKey;
    evaluatedKey.current = mapKey;
    setIsLoading(true);
    setError(null);

    const ctx: EvaluationContext | null = buildEvaluationContext(state, deckCards, player);
    if (!ctx) {
      setError("Could not build evaluation context");
      setIsLoading(false);
      return;
    }

    updateFromContext(ctx);

    const mapPlayer = state.player ?? state.map?.player;
    if (mapPlayer) {
      ctx.gold = mapPlayer.gold;
      ctx.hpPercent = mapPlayer.max_hp > 0 ? mapPlayer.hp / mapPlayer.max_hp : 1;
    }

    const contextStr = buildCompactContext(ctx);

    const allNodes = state.map?.nodes ?? [];
    const nodeMap = new Map<string, (typeof allNodes)[0]>();
    for (const n of allNodes) {
      nodeMap.set(`${n.col},${n.row}`, n);
    }

    function buildTree(col: number, row: number, depth: number, maxDepth: number, indent: string): string[] {
      const node = nodeMap.get(`${col},${row}`);
      if (!node) return [];
      const icon = NODE_TYPE_ICONS[node.type] ?? "•";
      const lines: string[] = [`${indent}${icon} ${node.type}`];
      if (depth >= maxDepth || node.children.length === 0) return lines;
      const childNodes = node.children.map(([cc, cr]) => nodeMap.get(`${cc},${cr}`)).filter(Boolean);
      if (childNodes.length === 1) {
        lines.push(...buildTree(childNodes[0]!.col, childNodes[0]!.row, depth + 1, maxDepth, indent));
      } else {
        for (const child of childNodes) {
          if (!child) continue;
          lines.push(`${indent}  ├─`);
          lines.push(...buildTree(child.col, child.row, depth + 1, maxDepth, indent + "  │ "));
        }
      }
      return lines;
    }

    const optionsStr = options.map((opt, i) => {
      const tree = buildTree(opt.col, opt.row, 0, 6, "   ");
      return `Option ${i + 1}:\n${tree.join("\n")}`;
    }).join("\n\n");

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
    const mapOverview = Object.entries(typeCounts).map(([t, c]) => `${t}: ${c}`).join(", ");

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

      // Guard against stale responses
      if (evaluatedKey.current !== targetKey) return;

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

      // Build recommendedNodes — ONLY the best option's path (not all options)
      const mp = state.player ?? state.map?.player;
      const recommendedNodes = new Set<string>();
      const tierOrder = ["S", "A", "B", "C", "D", "F"];
      if (parsed.rankings.length > 0) {
        const bestRanking = parsed.rankings.reduce((a, b) => {
          const aT = tierOrder.indexOf(a.tier);
          const bT = tierOrder.indexOf(b.tier);
          return bT < aT ? b : aT < bT ? a : (a.confidence ?? 0) >= (b.confidence ?? 0) ? a : b;
        });
        const bestOpt = options.find((_, i) => i + 1 === bestRanking.optionIndex);
        if (bestOpt) {
          recommendedNodes.add(`${bestOpt.col},${bestOpt.row}`);
          for (const lead of bestOpt.leads_to) {
            recommendedNodes.add(`${lead.col},${lead.row}`);
          }
        }
      }
      for (const p of parsed.recommendedPath) {
        recommendedNodes.add(`${p.col},${p.row}`);
      }

      // Persist context for cross-remount access
      const evalCtx = {
        hpPercent: mp && mp.max_hp > 0 ? mp.hp / mp.max_hp : 1,
        deckSize: deckCards.length,
        act: state.run?.act ?? 1,
        recommendedNodes,
      };
      lastEvalContext.current = evalCtx;

      // Persist via context (survives remounts, backed by localStorage)
      mapEvalState.setEvalContext({
        hpPercent: evalCtx.hpPercent,
        deckSize: evalCtx.deckSize,
        act: evalCtx.act,
        recommendedNodesList: [...recommendedNodes],
      });

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
  };

  // ─── Trigger: evaluate or carry forward ───

  if (mapKey !== evaluatedKey.current && !isLoading) {
    if (shouldEvaluate()) {
      evaluate();
    } else {
      carryForward();
    }
  }

  return { evaluation, isLoading, error, retry };
}
