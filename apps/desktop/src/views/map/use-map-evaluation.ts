"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MapState, CombatCard } from "@sts2/shared/types/game-state";
import type { TrackedPlayer } from "../../features/run/runSlice";
import { mapEvalUpdated, mapContextUpdated } from "../../features/run/runSlice";
import type { EvaluationContext } from "@sts2/shared/evaluation/types";
import type { TierLetter } from "@sts2/shared/evaluation/tier-utils";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { buildCompactContext } from "@sts2/shared/evaluation/prompt-builder";
import { getPromptContext, updateFromContext } from "@sts2/shared/evaluation/run-narrative";
import { registerLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import { NODE_TYPE_ICONS } from "./map-scoring";
import { traceRecommendedPath } from "./map-path-tracer";
import { computeDeckMaturity, type DeckMaturityInput } from "@sts2/shared/evaluation/deck-maturity";
import { detectArchetypes, hasScalingSources, getScalingSources } from "@sts2/shared/evaluation/archetype-detector";
import { getCached, setCache } from "@sts2/shared/lib/local-cache";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { selectMapEvalContext, selectRecommendedNodesSet } from "../../features/run/runSelectors";
import { useEvaluateMapMutation } from "../../services/evaluationApi";
import { shouldEvaluateMap } from "../../lib/should-evaluate-map";
import { hasSignificantContextChange as hasSignificantCtxChange } from "../../lib/has-significant-context-change";

const CACHE_KEY = "sts2-map-eval-cache";

export interface MapPathEvaluation {
  rankings: {
    optionIndex: number;
    nodeType: string;
    tier: TierLetter;
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

  // Eval context from Redux — survives remounts and persists via listener
  const dispatch = useAppDispatch();
  const [triggerMapEval] = useEvaluateMapMutation();
  const reduxEvalCtx = useAppSelector(selectMapEvalContext);
  const reduxRecommendedNodes = useAppSelector(selectRecommendedNodesSet);
  const lastEvalContext = useRef<{ hpPercent: number; deckSize: number; act: number; recommendedNodes: Set<string> } | null>(
    reduxEvalCtx ? {
      ...reduxEvalCtx,
      recommendedNodes: reduxRecommendedNodes,
    } : null
  );

  cachedRef.current = mapKey;

  // Always update map context in Redux — rest site, events, etc. read this.
  // Must run every render, not just when eval fires.
  const currentRow = state.map.current_position?.row ?? 0;
  const bossRow = state.map.boss.row;
  const nextNodeTypes = options.map((o) => o.type);
  const latestMapContext = {
    floorsToNextBoss: bossRow - currentRow,
    nextNodeTypes,
    hasEliteAhead: nextNodeTypes.includes("Elite"),
    hasRestAhead: nextNodeTypes.includes("RestSite"),
    hasShopAhead: nextNodeTypes.includes("Shop"),
  };
  // Dispatch is safe during render — Redux handles it synchronously
  dispatch(mapContextUpdated(latestMapContext));

  // ─── Decision: should we evaluate? ───

  function checkShouldEvaluate(): boolean {
    const prev = lastEvalContext.current;
    const currentPos = state.map?.current_position;
    const mapPlayer = state.player ?? state.map?.player;
    const currentHpPercent = mapPlayer && mapPlayer.max_hp > 0 ? mapPlayer.hp / mapPlayer.max_hp : 1;

    const isOnRecommendedPath = prev && currentPos
      ? prev.recommendedNodes.has(`${currentPos.col},${currentPos.row}`)
      : false;

    return shouldEvaluateMap({
      optionCount: options.length,
      hasPrevContext: !!prev,
      actChanged: prev ? prev.act !== (state.run?.act ?? 0) : false,
      currentPosition: currentPos ?? null,
      isOnRecommendedPath,
      hasSignificantContextChange: prev
        ? hasSignificantCtxChange({
            prevHpPercent: prev.hpPercent,
            currentHpPercent,
            prevDeckSize: prev.deckSize,
            currentDeckSize: deckCards.length,
          })
        : false,
    });
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

    const futureNodes = allNodes.filter((n) => n.row > currentRow);
    const typeCounts: Record<string, number> = {};
    for (const n of futureNodes) {
      typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
    }
    const mapOverview = Object.entries(typeCounts).map(([t, c]) => `${t}: ${c}`).join(", ");

    try {
      const parsed = await triggerMapEval({
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
      }).unwrap();

      // Guard against stale responses
      if (evaluatedKey.current !== targetKey) return;

      setEvaluation(parsed);
      setCache(CACHE_KEY, mapKey, parsed);

      // Build path tracing context
      const mp = state.player ?? state.map?.player;
      const hpPct = mp && mp.max_hp > 0 ? mp.hp / mp.max_hp : 1;
      const allNodes = state.map?.nodes ?? [];
      const bossPos = state.map.boss;
      const act = state.run?.act ?? 1;
      const floor = state.run?.floor ?? 1;

      const relics = player?.relics ?? [];
      const archetypes = detectArchetypes(deckCards, relics);
      const maturityCtx: DeckMaturityInput = {
        archetypes,
        deckSize: deckCards.length,
        deckCards: deckCards.map((c) => ({ name: c.name })),
        hasScaling: hasScalingSources(deckCards),
        scalingSources: getScalingSources(deckCards),
        upgradeCount: deckCards.filter((c) => c.name.includes("+")).length,
      };
      const deckMaturity = computeDeckMaturity(maturityCtx);
      const relicCount = relics.length;

      // Find best option from rankings for primary path trace
      const tierOrder = ["S", "A", "B", "C", "D", "F"];
      const bestRanking = parsed.rankings.length > 0
        ? parsed.rankings.reduce((a, b) => {
            const aTier = tierOrder.indexOf(a.tier);
            const bTier = tierOrder.indexOf(b.tier);
            if (aTier !== bTier) return aTier < bTier ? a : b;
            return (a.confidence ?? 0) >= (b.confidence ?? 0) ? a : b;
          })
        : null;
      const bestOpt = bestRanking
        ? options.find((_, i) => i + 1 === bestRanking.optionIndex)
        : null;

      // Trace recommended path from best option with full context
      const tracedPath = bestOpt
        ? traceRecommendedPath(
            bestOpt.col, bestOpt.row, allNodes, bossPos,
            hpPct, mp?.gold ?? 0, act, deckMaturity, relicCount, floor
          )
        : parsed.recommendedPath;

      // Build recommendedNodes — trace from EVERY evaluated option
      // so picking any option is "on plan" (deviation = unevaluated node)
      const recommendedNodes = new Set<string>();
      for (const opt of options) {
        recommendedNodes.add(`${opt.col},${opt.row}`);
        const fullPath = traceRecommendedPath(
          opt.col, opt.row, allNodes, bossPos,
          hpPct, mp?.gold ?? 0, act, deckMaturity, relicCount, floor
        );
        for (const p of fullPath) {
          recommendedNodes.add(`${p.col},${p.row}`);
        }
      }
      // Also include API's recommended path + traced path
      for (const p of parsed.recommendedPath) {
        recommendedNodes.add(`${p.col},${p.row}`);
      }
      for (const p of tracedPath) {
        recommendedNodes.add(`${p.col},${p.row}`);
      }

      // Persist context for cross-remount access
      const evalCtx = {
        hpPercent: hpPct,
        deckSize: deckCards.length,
        act,
        recommendedNodes,
      };
      lastEvalContext.current = evalCtx;

      // Persist to Redux (survives remounts, persisted via listener middleware)
      dispatch(mapEvalUpdated({
        recommendedPath: tracedPath,
        recommendedNodes: [...recommendedNodes],
        lastEvalContext: {
          hpPercent: evalCtx.hpPercent,
          deckSize: evalCtx.deckSize,
          act: evalCtx.act,
        },
      }));

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
  }, [state, deckCards, player, options, mapKey, triggerMapEval]);

  const retry = () => {
    evaluatedKey.current = "";
    setError(null);
  };

  // ─── Trigger: evaluate or carry forward (in useEffect, not during render) ───

  useEffect(() => {
    if (mapKey !== evaluatedKey.current && !isLoading) {
      if (checkShouldEvaluate()) {
        evaluate();
      } else {
        carryForward();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- shouldEvaluate/carryForward read refs, evaluate is stable via useCallback
  }, [mapKey, isLoading, evaluate]);

  return { evaluation, isLoading, error, retry };
}
