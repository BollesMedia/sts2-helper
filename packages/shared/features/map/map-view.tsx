"use client";

import { useMemo, useState } from "react";
import { cn } from "@sts2/shared/lib/cn";
import type { MapState } from "@sts2/shared/types/game-state";
import type { TrackedPlayer } from "@sts2/shared/features/connection/use-player-tracker";
import type { CombatCard } from "@sts2/shared/types/game-state";
import { NODE_TYPE_ICONS } from "./map-scoring";
import { useMapEvaluation } from "./use-map-evaluation";
import { TierBadge } from "@sts2/shared/components/tier-badge";
import { ConfidenceIndicator } from "@sts2/shared/components/confidence-indicator";
import { RefineInput } from "@sts2/shared/components/refine-input";
import { EvalError } from "@sts2/shared/components/eval-error";
import type { TierLetter } from "@sts2/shared/evaluation/tier-utils";

interface MapViewProps {
  state: MapState;
  player: TrackedPlayer | null;
  deckCards: CombatCard[];
}

const NODE_RADIUS = 14;
const COL_SPACING = 80;
const ROW_SPACING = 48;
const PADDING_X = 50;
const PADDING_Y = 40;

function nodeX(col: number): number {
  return PADDING_X + col * COL_SPACING;
}

function nodeY(row: number, maxRow: number): number {
  return PADDING_Y + (maxRow - row) * ROW_SPACING;
}

const NODE_FILL: Record<string, string> = {
  Monster: "#ef4444",
  Elite: "#f59e0b",
  Boss: "#dc2626",
  RestSite: "#34d399",
  Shop: "#60a5fa",
  Treasure: "#fbbf24",
  Unknown: "#a1a1aa",
};

const RECOMMENDATION_BORDER: Record<string, string> = {
  strong_pick: "border-emerald-500/50",
  good_pick: "border-blue-500/50",
  situational: "border-amber-500/50",
  skip: "border-zinc-700",
};

export function MapView({ state, player, deckCards }: MapViewProps) {
  const { nodes, current_position, visited, next_options, boss } = state.map;
  const { evaluation, isLoading, error, retry } = useMapEvaluation(state, deckCards, player);

  const maxRow = useMemo(
    () => Math.max(...nodes.map((n) => n.row), boss.row),
    [nodes, boss]
  );
  const maxCol = useMemo(
    () => Math.max(...nodes.map((n) => n.col)),
    [nodes]
  );

  const svgWidth = PADDING_X * 2 + maxCol * COL_SPACING;
  const svgHeight = PADDING_Y * 2 + maxRow * ROW_SPACING;

  const visitedSet = useMemo(
    () => new Set(visited.map((v) => `${v.col},${v.row}`)),
    [visited]
  );

  const nextOptionSet = useMemo(
    () => new Set(next_options.map((o) => `${o.col},${o.row}`)),
    [next_options]
  );

  // Find best option from Claude evaluation
  const bestOptionIndex = useMemo(() => {
    if (!evaluation?.rankings.length) return null;
    const best = evaluation.rankings.reduce((a, b) => {
      const tierOrder = ["S", "A", "B", "C", "D", "F"];
      return tierOrder.indexOf(a.tier) <= tierOrder.indexOf(b.tier) ? a : b;
    });
    return best.optionIndex;
  }, [evaluation]);

  const bestOptionKey = useMemo(() => {
    if (bestOptionIndex == null) return null;
    const opt = next_options.find((_, i) => i + 1 === bestOptionIndex);
    return opt ? `${opt.col},${opt.row}` : null;
  }, [bestOptionIndex, next_options]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold text-zinc-100">Map</h2>
        {isLoading && (
          <span className="text-xs text-zinc-500 animate-pulse">
            Evaluating paths...
          </span>
        )}
      </div>

      {/* Overall advice */}
      {evaluation?.overallAdvice && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 px-4 py-3">
          <p className="text-sm text-zinc-300 leading-relaxed">{evaluation.overallAdvice}</p>
        </div>
      )}

      {error && <EvalError error={error} onRetry={retry} />}

      {/* Path recommendations */}
      <div className="grid grid-cols-3 gap-3">
        {next_options.map((opt, i) => {
          const evalData = evaluation?.rankings.find(
            (r) => r.optionIndex === i + 1
          );
          const isBest = bestOptionIndex === i + 1;

          return (
            <div
              key={opt.index}
              className={cn(
                "rounded-lg border bg-zinc-900/50 p-3",
                evalData
                  ? RECOMMENDATION_BORDER[evalData.recommendation] ?? "border-zinc-800"
                  : isBest
                    ? "border-emerald-500/50"
                    : "border-zinc-800"
              )}
            >
              <div className="flex items-center gap-2">
                {evalData && (
                  <TierBadge tier={evalData.tier as TierLetter} size="sm" />
                )}
                <span className="text-lg">
                  {NODE_TYPE_ICONS[opt.type] ?? "•"}
                </span>
                <span className="font-medium text-zinc-100 text-sm">
                  {opt.type}
                </span>
                {isBest && (
                  <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-xs font-medium text-emerald-400">
                    Best
                  </span>
                )}
              </div>

              {opt.leads_to && opt.leads_to.length > 0 && (
                <p className="mt-1 text-xs text-zinc-500">
                  → {opt.leads_to.map((l) => `${NODE_TYPE_ICONS[l.type] ?? ""} ${l.type}`).join(", ")}
                </p>
              )}

              {evalData && (
                <div className="mt-2 space-y-1.5">
                  <p className="text-xs text-zinc-300">{evalData.reasoning}</p>
                  <ConfidenceIndicator confidence={evalData.confidence} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* SVG Map */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 overflow-auto">
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="mx-auto"
        >
          {/* Edges */}
          {nodes.map((node) =>
            node.children.map(([childCol, childRow], ci) => {
              const x1 = nodeX(node.col);
              const y1 = nodeY(node.row, maxRow);
              const x2 = nodeX(childCol);
              const y2 = nodeY(childRow, maxRow);

              const isVisitedEdge =
                visitedSet.has(`${node.col},${node.row}`) &&
                visitedSet.has(`${childCol},${childRow}`);

              const isNextEdge =
                current_position &&
                node.col === current_position.col &&
                node.row === current_position.row &&
                nextOptionSet.has(`${childCol},${childRow}`);

              const isBestEdge =
                isNextEdge &&
                bestOptionKey === `${childCol},${childRow}`;

              return (
                <line
                  key={`${node.col},${node.row}-${childCol},${childRow}-${ci}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={
                    isBestEdge
                      ? "#34d399"
                      : isVisitedEdge
                        ? "#71717a"
                        : isNextEdge
                          ? "#a1a1aa"
                          : "#27272a"
                  }
                  strokeWidth={isBestEdge ? 2.5 : isNextEdge ? 2 : 1}
                  strokeDasharray={isNextEdge && !isBestEdge ? "4 4" : undefined}
                />
              );
            })
          )}

          {/* Nodes */}
          {nodes.map((node) => {
            const x = nodeX(node.col);
            const y = nodeY(node.row, maxRow);
            const key = `${node.col},${node.row}`;
            const isCurrent =
              current_position &&
              node.col === current_position.col &&
              node.row === current_position.row;
            const isVisited = visitedSet.has(key);
            const isNext = nextOptionSet.has(key);
            const isBest = bestOptionKey === key;

            const fill = NODE_FILL[node.type] ?? "#71717a";
            const opacity = isVisited && !isCurrent ? 0.3 : 1;

            return (
              <g key={key}>
                {isBest && (
                  <circle
                    cx={x}
                    cy={y}
                    r={NODE_RADIUS + 5}
                    fill="none"
                    stroke="#34d399"
                    strokeWidth={2}
                    opacity={0.5}
                  />
                )}
                {isCurrent && (
                  <circle
                    cx={x}
                    cy={y}
                    r={NODE_RADIUS + 3}
                    fill="none"
                    stroke="#fff"
                    strokeWidth={2}
                  />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={NODE_RADIUS}
                  fill={fill}
                  opacity={opacity}
                  stroke={isNext ? "#fff" : "none"}
                  strokeWidth={isNext ? 1.5 : 0}
                />
                <text
                  x={x}
                  y={y + 1}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={12}
                  fill={opacity < 0.5 ? "#71717a" : "#fff"}
                >
                  {NODE_TYPE_ICONS[node.type]?.[0] ?? "•"}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Refine */}
      {evaluation && (
        <RefineInput
          originalContext={`Map evaluation for ${player?.character ?? "unknown"} at Act ${state.run.act}, Floor ${state.run.floor}. HP: ${state.map.player.hp}/${state.map.player.max_hp}. Gold: ${state.map.player.gold}g. Path options: ${next_options.map((o) => o.type).join(", ")}.`}
          originalResponse={[
            evaluation.overallAdvice,
            ...evaluation.rankings.map((r) => `#${r.optionIndex} ${r.nodeType}: ${r.reasoning}`),
          ].filter(Boolean).join(" ")}
        />
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
        {Object.entries(NODE_TYPE_ICONS).map(([type, icon]) => (
          <span key={type} className="flex items-center gap-1">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: NODE_FILL[type] }}
            />
            {icon} {type}
          </span>
        ))}
      </div>
    </div>
  );
}
