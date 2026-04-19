"use client";

import { useMemo, useState } from "react";
import type { MapState, MultiplayerFields } from "@sts2/shared/types/game-state";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { selectRecommendedPath } from "../../features/run/runSelectors";
import { selectEvalResult, selectEvalIsLoading, selectEvalError } from "../../features/evaluation/evaluationSelectors";
import { evalRetryRequested } from "../../features/evaluation/evaluationSlice";
import { computeMapEvalKey, type MapCoachEvaluation } from "../../lib/eval-inputs/map";
import { NODE_TYPE_ICONS, NODE_SVG_LABELS } from "./map-scoring";
import { EvalError } from "../../components/eval-error";
import { BranchCard } from "../../components/branch-card";
import { TeachingCallouts } from "../../components/teaching-callouts";
import { ConfidencePill } from "../../components/confidence-pill";
import { SwapBadge } from "../../components/swap-badge";


interface MapViewProps {
  state: MapState & MultiplayerFields;
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

// --- Component ---

const selectMapResult = selectEvalResult<MapCoachEvaluation>("map");
const selectMapLoading = selectEvalIsLoading("map");
const selectMapError = selectEvalError("map");
// Direct selector — avoids RTK slice selector scoping issues in tests
const selectMapEvalKey = (state: { evaluation: { evals: { map: { evalKey: string } } } }) =>
  state.evaluation.evals.map.evalKey;

export function MapView({ state }: MapViewProps) {
  const dispatch = useAppDispatch();
  const evaluation = useAppSelector(selectMapResult);
  const isLoading = useAppSelector(selectMapLoading);
  const error = useAppSelector(selectMapError);
  const storedEvalKey = useAppSelector(selectMapEvalKey);
  const [keyDecisionsOpen, setKeyDecisionsOpen] = useState(true);
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

  // Check whether the stored evaluation corresponds to the current options.
  // After the player moves, the coach output becomes stale (it references the
  // previous position's options). evalKey comparison catches same-count forks
  // with different coordinates.
  const evalMatchesCurrentOptions = useMemo(() => {
    if (!storedEvalKey || !evaluation) return false;
    return computeMapEvalKey(next_options) === storedEvalKey;
  }, [storedEvalKey, evaluation, next_options]);

  // Recommended path from Redux — computed and persisted by mapListeners
  const recommendedPath = useAppSelector(selectRecommendedPath);

  const recommendedPathEdges = useMemo(() => {
    const edges = new Set<string>();
    for (let i = 0; i < recommendedPath.length - 1; i++) {
      edges.add(`${recommendedPath[i].col},${recommendedPath[i].row}->${recommendedPath[i + 1].col},${recommendedPath[i + 1].row}`);
    }
    return edges;
  }, [recommendedPath]);

  // Only show path nodes from current position forward (not already-passed nodes)
  const currentRow = current_position?.row ?? 0;
  const recommendedPathNodes = useMemo(
    () => new Set(
      recommendedPath
        .filter((p) => p.row >= currentRow)
        .map((p) => `${p.col},${p.row}`)
    ),
    [recommendedPath, currentRow]
  );

  // Best next node: the first entry in macro_path whose nodeId matches a
  // next_option. Falls back to the recommended path when the eval is stale.
  const bestOptionKey = useMemo(() => {
    if (evalMatchesCurrentOptions && evaluation?.macroPath.floors.length) {
      const firstOnPath = evaluation.macroPath.floors[0];
      const match = next_options.find(
        (opt) => `${opt.col},${opt.row}` === firstOnPath.nodeId,
      );
      if (match) return firstOnPath.nodeId;
    }
    // Fallback: find the next_option that lies on the recommended path
    for (const opt of next_options) {
      if (recommendedPathNodes.has(`${opt.col},${opt.row}`)) {
        return `${opt.col},${opt.row}`;
      }
    }
    return null;
  }, [evaluation, evalMatchesCurrentOptions, next_options, recommendedPathNodes]);

  // Multiplayer voting
  const isMultiplayer = state.game_mode === "multiplayer";
  const votes = state.map.votes;
  const allVoted = state.map.all_voted;

  return (
    <div className="flex gap-3 h-full min-h-0">
      {/* Map area — capped width; SVG already preserveAspectRatio, so a cap
          just trims dead horizontal padding around the tall map graph. */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-1.5 max-w-[26rem]">
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[9px] text-zinc-600">
          {Object.keys(NODE_TYPE_ICONS).map((type) => (
            <span key={type} className="flex items-center gap-1">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: NODE_FILL[type] }}
              />
              <span>{type}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Sidebar — Coach output */}
      <div className="flex-1 min-w-[20rem] flex flex-col gap-2 min-h-0 overflow-y-auto overflow-x-hidden">
        {evaluation && evalMatchesCurrentOptions && (
          <>
            {/* Headline + confidence */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold leading-snug text-zinc-100">
                  {evaluation.headline}
                </h3>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {evaluation.compliance?.reranked && (
                    <SwapBadge reason={evaluation.compliance.rerankReason} />
                  )}
                  <ConfidencePill confidence={evaluation.confidence} />
                </div>
              </div>
            </div>

            {/* Why this path — reasoning */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Why this path
              </h4>
              <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed">
                <span className="font-semibold text-zinc-200">Risk capacity: </span>
                {evaluation.reasoning.riskCapacity}
              </p>
              <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed">
                <span className="font-semibold text-zinc-200">Act goal: </span>
                {evaluation.reasoning.actGoal}
              </p>
            </div>

            {/* Path summary */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Path
              </h4>
              <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                {evaluation.macroPath.summary}
              </p>
            </div>

            {/* Key decisions — collapsible */}
            {evaluation.keyBranches.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => setKeyDecisionsOpen((v) => !v)}
                  aria-expanded={keyDecisionsOpen}
                  className="flex w-full items-center justify-between gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
                >
                  <span>Key decisions ({evaluation.keyBranches.length})</span>
                  <span
                    aria-hidden
                    className={`transition-transform ${keyDecisionsOpen ? "rotate-90" : ""}`}
                  >
                    ▸
                  </span>
                </button>
                {keyDecisionsOpen &&
                  evaluation.keyBranches.map((b, i) => (
                    <BranchCard key={i} branch={b} />
                  ))}
              </div>
            )}

            {/* Teaching callouts */}
            <TeachingCallouts callouts={evaluation.teachingCallouts} />
          </>
        )}

        {/* Next-option badges — gives the user a reading of the map at a glance
            (node types + which one the coach picked). Renders with or without
            an eval so the sidebar always shows the candidate options. */}
        <div className="flex flex-wrap gap-1.5 px-0.5">
          {next_options.map((opt) => {
            const key = `${opt.col},${opt.row}`;
            const isBest = bestOptionKey === key;
            return (
              <span
                key={opt.index}
                className={
                  isBest
                    ? "inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300"
                    : "inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400"
                }
              >
                <span>{opt.type}</span>
                {isBest && (
                  <span className="ml-1 text-[8px] font-bold uppercase tracking-wider">Best</span>
                )}
              </span>
            );
          })}
        </div>

        {error && <EvalError error={error} onRetry={() => dispatch(evalRetryRequested("map"))} />}
      </div>
    </div>
  );
}
