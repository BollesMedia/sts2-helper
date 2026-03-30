"use client";

import { useMemo } from "react";
import { cn } from "../../lib/cn";
import type { MapState } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { CombatCard } from "../../types/game-state";
import { NODE_TYPE_ICONS } from "./map-scoring";
import { useMapEvaluation } from "./use-map-evaluation";
import { TierBadge } from "../../components/tier-badge";
import { EvalError } from "../../components/eval-error";
import type { TierLetter } from "../../evaluation/tier-utils";

interface MapViewProps {
  state: MapState;
  player: TrackedPlayer | null;
  deckCards: CombatCard[];
}

const NODE_RADIUS = 12;
const COL_SPACING = 60;
const ROW_SPACING = 36;
const PADDING_X = 36;
const PADDING_Y = 28;

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
    <div className="flex gap-4 h-full min-h-0">
      {/* Main area — SVG Map */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
        <div className="flex-1 min-h-0 rounded-lg border border-zinc-800 bg-zinc-900 p-2 relative">
          {isLoading && (
            <span className="absolute top-2 right-2 text-xs text-zinc-500 animate-pulse">
              Evaluating...
            </span>
          )}
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-full"
            preserveAspectRatio="xMidYMid meet"
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
                      r={NODE_RADIUS + 4}
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
                    fontSize={10}
                    fill={opacity < 0.5 ? "#71717a" : "#fff"}
                  >
                    {NODE_TYPE_ICONS[node.type]?.[0] ?? "•"}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-2.5 text-[10px] text-zinc-500">
          {Object.entries(NODE_TYPE_ICONS).map(([type, icon]) => (
            <span key={type} className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: NODE_FILL[type] }}
              />
              {icon} {type}
            </span>
          ))}
        </div>
      </div>

      {/* Sidebar — Evaluation */}
      <div className="w-56 shrink-0 flex flex-col gap-2">
        {/* Overall advice */}
        {evaluation?.overallAdvice && (
          <p className="text-xs text-zinc-400 leading-relaxed">
            {evaluation.overallAdvice}
          </p>
        )}

        {error && <EvalError error={error} onRetry={retry} />}

        {/* Path recommendations — stacked cards */}
        {next_options.map((opt, i) => {
          const evalData = evaluation?.rankings.find(
            (r) => r.optionIndex === i + 1
          );
          const isBest = bestOptionIndex === i + 1;

          return (
            <div
              key={opt.index}
              className={cn(
                "rounded-lg border bg-zinc-900/50 p-2.5",
                evalData
                  ? RECOMMENDATION_BORDER[evalData.recommendation] ?? "border-zinc-800"
                  : isBest
                    ? "border-emerald-500/50"
                    : "border-zinc-800"
              )}
            >
              <div className="flex items-center gap-1.5">
                {evalData && (
                  <TierBadge tier={evalData.tier as TierLetter} size="sm" />
                )}
                <span className="text-sm">
                  {NODE_TYPE_ICONS[opt.type] ?? "•"}
                </span>
                <span className="font-medium text-zinc-100 text-xs">
                  {opt.type}
                </span>
                {isBest && (
                  <span className="ml-auto rounded bg-emerald-400/10 px-1 py-0.5 text-[10px] font-medium text-emerald-400">
                    Best
                  </span>
                )}
              </div>

              {opt.leads_to && opt.leads_to.length > 0 && (
                <p className="mt-1 text-[10px] text-zinc-600 truncate">
                  → {opt.leads_to.map((l) => `${NODE_TYPE_ICONS[l.type] ?? ""} ${l.type}`).join(", ")}
                </p>
              )}

              {evalData && (
                <p className="mt-1.5 text-[11px] text-zinc-400 leading-snug">
                  {evalData.reasoning}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
