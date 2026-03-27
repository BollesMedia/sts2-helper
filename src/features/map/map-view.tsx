"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import type { MapState, MapNode } from "@/lib/types/game-state";
import type { TrackedPlayer } from "@/features/connection/use-player-tracker";
import type { CombatCard } from "@/lib/types/game-state";
import { scoreNextOptions, NODE_TYPE_ICONS } from "./map-scoring";

interface MapViewProps {
  state: MapState;
  player: TrackedPlayer | null;
  deckCards: CombatCard[];
}

// SVG layout constants
const NODE_RADIUS = 14;
const COL_SPACING = 80;
const ROW_SPACING = 48;
const PADDING_X = 50;
const PADDING_Y = 40;

function nodeX(col: number): number {
  return PADDING_X + col * COL_SPACING;
}

function nodeY(row: number, maxRow: number): number {
  // Invert so row 0 is at bottom, boss at top
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

export function MapView({ state, player, deckCards }: MapViewProps) {
  const { nodes, current_position, visited, next_options, boss } = state.map;

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

  const pathScores = useMemo(
    () => scoreNextOptions(state.map, player, deckCards.length),
    [state.map, player, deckCards.length]
  );

  const bestOption = useMemo(() => {
    if (pathScores.length === 0) return null;
    return pathScores.reduce((best, curr) =>
      curr.score > best.score ? curr : best
    );
  }, [pathScores]);

  const bestOptionKey = bestOption
    ? `${bestOption.option.col},${bestOption.option.row}`
    : null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <h2 className="text-lg font-semibold text-zinc-100">Map</h2>

      {/* Path recommendations */}
      <div className="grid grid-cols-3 gap-3">
        {pathScores
          .sort((a, b) => b.score - a.score)
          .map((ps) => {
            const isBest = bestOptionKey === `${ps.option.col},${ps.option.row}`;
            return (
              <div
                key={ps.option.index}
                className={cn(
                  "rounded-lg border bg-zinc-900 p-3",
                  isBest
                    ? "border-emerald-500/50"
                    : "border-zinc-800"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">
                    {NODE_TYPE_ICONS[ps.option.type] ?? "•"}
                  </span>
                  <span className="font-medium text-zinc-100 text-sm">
                    {ps.option.type}
                  </span>
                  {isBest && (
                    <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-xs font-medium text-emerald-400">
                      Best
                    </span>
                  )}
                </div>
                {ps.option.leads_to && ps.option.leads_to.length > 0 && (
                  <p className="mt-1 text-xs text-zinc-500">
                    → {ps.option.leads_to.map((l) => `${NODE_TYPE_ICONS[l.type] ?? ""} ${l.type}`).join(", ")}
                  </p>
                )}
                <div className="mt-2 space-y-1">
                  {ps.reasons.map((r, i) => (
                    <p key={i} className="text-xs text-zinc-400">
                      {r}
                    </p>
                  ))}
                </div>
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
            const isVisited = visitedSet.has(key);
            const isCurrent =
              current_position &&
              node.col === current_position.col &&
              node.row === current_position.row;
            const isNext = nextOptionSet.has(key);
            const isBest = bestOptionKey === key;

            const fill = NODE_FILL[node.type] ?? "#71717a";
            const opacity = isVisited && !isCurrent ? 0.3 : 1;

            return (
              <g key={key}>
                {/* Glow for best option */}
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
                {/* Current position ring */}
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
