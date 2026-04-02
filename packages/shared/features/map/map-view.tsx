"use client";

import { useMemo, useRef } from "react";
import { cn } from "../../lib/cn";
import type { MapState, MultiplayerFields } from "../../types/game-state";
import type { TrackedPlayer } from "../connection/use-player-tracker";
import type { CombatCard } from "../../types/game-state";
import { NODE_TYPE_ICONS, NODE_SVG_LABELS } from "./map-scoring";
import { traceRecommendedPath } from "./map-path-tracer";
import { useMapEvaluation } from "./use-map-evaluation";
import { TierBadge } from "../../components/tier-badge";
import { EvalError } from "../../components/eval-error";
import type { TierLetter } from "../../evaluation/tier-utils";
import { computeDeckMaturity, type DeckMaturityInput } from "../../evaluation/deck-maturity";
import { detectArchetypes, hasScalingSources, getScalingSources } from "../../evaluation/archetype-detector";

interface MapViewProps {
  state: MapState & MultiplayerFields;
  player: TrackedPlayer | null;
  deckCards: CombatCard[];
}

// --- SVG Constants ---

const NODE_RADIUS = 11;
const COL_SPACING = 56;
const ROW_SPACING = 34;
const PADDING_X = 32;
const PADDING_Y = 24;

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
  Treasure: "#a855f7",
  Unknown: "#71717a",
};

// Softer version for visited nodes
const NODE_FILL_DIM: Record<string, string> = {
  Monster: "#7f1d1d",
  Elite: "#78350f",
  Boss: "#7f1d1d",
  RestSite: "#064e3b",
  Shop: "#1e3a5f",
  Treasure: "#581c87",
  Unknown: "#3f3f46",
};

// --- Sidebar option card border colors by recommendation ---

const REC_BORDER: Record<string, string> = {
  strong_pick: "border-emerald-500/50",
  good_pick: "border-blue-500/40",
  situational: "border-amber-500/40",
  skip: "border-zinc-800",
};

// --- Component ---

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
    const tierOrder = ["S", "A", "B", "C", "D", "F"];
    const best = evaluation.rankings.reduce((a, b) => {
      const aTier = tierOrder.indexOf(a.tier);
      const bTier = tierOrder.indexOf(b.tier);
      if (aTier !== bTier) return aTier < bTier ? a : b;
      return (a.confidence ?? 0) >= (b.confidence ?? 0) ? a : b;
    });
    return best.optionIndex;
  }, [evaluation]);

  const bestOptionKey = useMemo(() => {
    if (bestOptionIndex == null) return null;
    const opt = next_options.find((_, i) => i + 1 === bestOptionIndex);
    return opt ? `${opt.col},${opt.row}` : null;
  }, [bestOptionIndex, next_options]);

  // Path tracer context
  const pathCtx = useMemo(() => {
    const act = state.run?.act ?? 1;
    const floor = state.run?.floor ?? 1;
    const relicCount = player?.relics.length ?? 0;
    const mapPlayer = state.player ?? state.map?.player;
    const hpPct = mapPlayer && mapPlayer.max_hp > 0 ? mapPlayer.hp / mapPlayer.max_hp : 1;
    const upgradeCount = deckCards.filter((c) => c.name.includes("+")).length;
    const relics = player?.relics ?? [];
    const archetypes = detectArchetypes(deckCards, relics);
    const maturityCtx: DeckMaturityInput = {
      archetypes,
      deckSize: deckCards.length,
      deckCards: deckCards.map((c) => ({ name: c.name })),
      hasScaling: hasScalingSources(deckCards),
      scalingSources: getScalingSources(deckCards),
      upgradeCount,
    };
    const deckMaturity = computeDeckMaturity(maturityCtx);
    return { hpPct, gold: mapPlayer?.gold ?? 0, act, deckMaturity, relicCount, floor };
  }, [state, player, deckCards]);

  // Recommended path — persisted to localStorage so it survives remounts
  const PATH_STORAGE_KEY = "sts2-map-recommended-path";

  const recommendedPath = useMemo(() => {
    // Best case: rankings exist, trace from best option
    if (bestOptionIndex != null) {
      const bestOpt = next_options.find((_, i) => i + 1 === bestOptionIndex);
      if (bestOpt) {
        const path = traceRecommendedPath(
          bestOpt.col, bestOpt.row, nodes, boss,
          pathCtx.hpPct, pathCtx.gold, pathCtx.act, pathCtx.deckMaturity, pathCtx.relicCount, pathCtx.floor
        );
        try { localStorage.setItem(PATH_STORAGE_KEY, JSON.stringify(path)); } catch {}
        return path;
      }
    }
    // Evaluation has a cached path (from carry-forward or API)
    if (evaluation?.recommendedPath?.length) {
      try { localStorage.setItem(PATH_STORAGE_KEY, JSON.stringify(evaluation.recommendedPath)); } catch {}
      return evaluation.recommendedPath;
    }
    // Last resort: load from localStorage (survives remount)
    try {
      const stored = localStorage.getItem(PATH_STORAGE_KEY);
      if (stored) return JSON.parse(stored) as { col: number; row: number }[];
    } catch {}
    return [];
  }, [bestOptionIndex, next_options, nodes, boss, pathCtx, evaluation]);

  const recommendedPathEdges = useMemo(() => {
    const edges = new Set<string>();
    for (let i = 0; i < recommendedPath.length - 1; i++) {
      edges.add(`${recommendedPath[i].col},${recommendedPath[i].row}->${recommendedPath[i + 1].col},${recommendedPath[i + 1].row}`);
    }
    return edges;
  }, [recommendedPath]);

  const recommendedPathNodes = useMemo(
    () => new Set(recommendedPath.map((p) => `${p.col},${p.row}`)),
    [recommendedPath]
  );

  // Multiplayer voting
  const isMultiplayer = state.game_mode === "multiplayer";
  const mapData = state.map as unknown as Record<string, unknown>;
  const votes = mapData.votes as { player: string; is_local: boolean; voted: boolean }[] | undefined;
  const allVoted = mapData.all_voted as boolean | undefined;

  return (
    <div className="flex gap-3 h-full min-h-0">
      {/* Map area */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-1.5">
        <div className="flex-1 min-h-0 rounded-lg border border-zinc-800 bg-zinc-950/80 p-1.5 relative">
          {/* Status indicators */}
          {isMultiplayer && votes && !allVoted && (
            <span className="absolute top-2 left-2 z-10 text-[10px] font-semibold text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
              Voting {votes.filter((v) => v.voted).length}/{votes.length}
            </span>
          )}
          {isLoading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-spire-base/50 backdrop-blur-[2px] rounded-lg pointer-events-none">
              <div className="flex items-center gap-2 bg-spire-surface border border-spire-border rounded-lg px-4 py-2 shadow-lg pointer-events-auto">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-sm text-spire-text-secondary">Evaluating paths...</span>
              </div>
            </div>
          )}

          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-full"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* SVG defs for glow effects */}
            <defs>
              <filter id="glow-best" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="glow-path" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

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
                const isBestEdge = isNextEdge && bestOptionKey === `${childCol},${childRow}`;
                const isPathEdge = !isBestEdge &&
                  recommendedPathEdges.has(`${node.col},${node.row}->${childCol},${childRow}`);

                const isHighlighted = isBestEdge || isPathEdge;

                return (
                  <line
                    key={`${node.col},${node.row}-${childCol},${childRow}-${ci}`}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={
                      isBestEdge ? "#34d399"
                        : isPathEdge ? "#34d399"
                        : isVisitedEdge ? "#52525b"
                        : isNextEdge ? "#a1a1aa"
                        : "#27272a"
                    }
                    strokeWidth={isBestEdge ? 3 : isPathEdge ? 2 : isNextEdge ? 1.5 : 1}
                    strokeDasharray={isNextEdge && !isBestEdge ? "4 3" : undefined}
                    strokeLinecap="round"
                    opacity={isPathEdge && !isBestEdge ? 0.5 : 1}
                    filter={isHighlighted ? "url(#glow-path)" : undefined}
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
              const isOnPath = recommendedPathNodes.has(key) && !isBest && !isCurrent;

              const fill = isVisited && !isCurrent
                ? (NODE_FILL_DIM[node.type] ?? "#3f3f46")
                : (NODE_FILL[node.type] ?? "#71717a");

              return (
                <g key={key} filter={isBest || isOnPath ? "url(#glow-path)" : undefined}>
                  {/* Current position ring */}
                  {isCurrent && (
                    <circle cx={x} cy={y} r={NODE_RADIUS + 4} fill="none" stroke="#fff" strokeWidth={2} opacity={0.8} />
                  )}
                  {/* Best option + all path nodes: green halo */}
                  {(isBest || isOnPath) && (
                    <circle cx={x} cy={y} r={NODE_RADIUS + 4} fill="none" stroke="#34d399" strokeWidth={2} opacity={0.6} />
                  )}
                  {/* Node circle */}
                  <circle
                    cx={x} cy={y} r={NODE_RADIUS}
                    fill={fill}
                    stroke={isNext && !isBest ? "#a1a1aa" : "none"}
                    strokeWidth={isNext ? 1.5 : 0}
                  />
                  {/* Label */}
                  <text
                    x={x} y={y + 1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={10}
                    fontWeight={700}
                    fontFamily="ui-monospace, monospace"
                    fill={isVisited && !isCurrent && !isOnPath ? "#52525b" : "#fff"}
                    style={{ userSelect: "none" }}
                  >
                    {NODE_SVG_LABELS[node.type] ?? "•"}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Legend — compact inline strip */}
        <div className="flex items-center gap-3 px-1 text-[9px] text-zinc-600">
          {Object.entries(NODE_TYPE_ICONS).map(([type, icon]) => (
            <span key={type} className="flex items-center gap-1">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: NODE_FILL[type] }}
              />
              <span>{icon}</span>
              <span>{type}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Sidebar — Evaluation cards */}
      <div className="w-52 shrink-0 flex flex-col gap-1.5 min-h-0 overflow-y-auto">
        {/* Overall advice */}
        {evaluation?.overallAdvice && (
          <div className="rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
            <p className="text-xs text-spire-text-tertiary leading-relaxed line-clamp-3" title={evaluation.overallAdvice}>
              {evaluation.overallAdvice}
            </p>
          </div>
        )}

        {error && <EvalError error={error} onRetry={retry} />}

        {/* Path option cards */}
        {next_options.map((opt, i) => {
          const evalData = evaluation?.rankings.find((r) => r.optionIndex === i + 1);
          const isBest = bestOptionIndex === i + 1;

          return (
            <div
              key={opt.index}
              className={cn(
                "rounded-lg border p-2.5 transition-all duration-150",
                evalData
                  ? (REC_BORDER[evalData.recommendation] ?? "border-zinc-800")
                  : isBest
                    ? "border-emerald-500/50"
                    : "border-zinc-800",
                isBest
                  ? "bg-emerald-950/20 shadow-[0_0_12px_rgba(52,211,153,0.12)]"
                  : "bg-zinc-900/60"
              )}
              title={evalData?.reasoning}
            >
              {/* Header: tier + type + best badge */}
              <div className="flex items-center gap-1.5">
                {evalData && (
                  <TierBadge tier={evalData.tier as TierLetter} size="sm" glow={isBest} />
                )}
                <span className="text-xs">{NODE_TYPE_ICONS[opt.type] ?? "•"}</span>
                <span className={cn(
                  "text-xs font-semibold tracking-tight truncate",
                  isBest ? "text-emerald-300" : "text-zinc-200"
                )}>
                  {opt.type}
                </span>
                {isBest && (
                  <span className="ml-auto text-[8px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded border border-emerald-500/25">
                    Best
                  </span>
                )}
              </div>

              {/* Reasoning */}
              {evalData?.reasoning && (
                <p className={cn(
                  "mt-1.5 text-xs leading-relaxed line-clamp-2",
                  isBest ? "text-zinc-300" : "text-zinc-500"
                )}>
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
