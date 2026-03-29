"use client";

import { useCallback, useRef, useState } from "react";
import type { MapState, CombatCard } from "@sts2/shared/types/game-state";
import type { TrackedPlayer } from "@/features/connection/use-player-tracker";
import type { EvaluationContext } from "@/evaluation/types";
import { buildEvaluationContext } from "@/evaluation/context-builder";
import { buildPromptContext } from "@/evaluation/context-builder";
import { NODE_TYPE_ICONS } from "./map-scoring";
import { getCached, setCache } from "@/lib/local-cache";

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
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "map",
          context: ctx,
          mapPrompt: `${contextStr}

Current HP: ${mapPlayer.hp}/${mapPlayer.max_hp} (${Math.round((mapPlayer.hp / Math.max(1, mapPlayer.max_hp)) * 100)}%)
Gold: ${mapPlayer.gold}g ${mapPlayer.gold < 75 ? "(too low for most shop purchases)" : mapPlayer.gold < 150 ? "(enough for card removal or 1-2 cheap cards)" : "(healthy gold reserve)"}
Card removal cost: ${player?.cardRemovalCost != null ? `${player.cardRemovalCost}g` : "unknown"} ${player?.cardRemovalCost != null && mapPlayer.gold < player.cardRemovalCost ? "(can't afford)" : ""}

Map overview (remaining nodes ahead): ${mapOverview}
Boss at row ${state.map.boss.row}, currently at row ${currentRow}, ${state.map.boss.row - currentRow} floors to boss

Available paths (read carefully — each shows the EXACT sequence of nodes you will encounter, including branching points):
${optionsStr}

IMPORTANT: The tree above is the ground truth. Each line is a node you WILL pass through in order. Branch points (├─) show where the path splits into choices. Evaluate based on:

ELITE DECISIONS (most important):
- Elite fights give relics which are the strongest upgrades. PREFER elites when the deck can handle them.
- Deck strength matters more than HP for elite readiness. A strong deck at 60% HP is elite-ready. A weak deck at 100% HP is not.
- Only recommend resting before an elite if HP is genuinely dangerously low (<40%) AND a RestSite literally precedes the Elite in the path sequence.
- 74/80 HP is NOT low. 50/80 is manageable. 30/80 is concerning.

PATH ANALYSIS:
- Count consecutive fights without rest — 3+ fights in a row is taxing
- Rest sites: valuable for upgrading cards when HP is healthy, not just healing
- Shops: only valuable if gold > card removal cost
- Unknown events: can be positive or negative, treat as neutral

Do NOT over-index on HP preservation. Aggressive pathing through elites wins more runs than cautious pathing that avoids them.

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
