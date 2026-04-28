import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateReceived, selectCurrentGameState } from "../gameState/gameStateSlice";
import { evaluationApi } from "../../services/evaluationApi";
import { selectActiveRun, mapEvalUpdated, runStarted, runEnded } from "../run/runSlice";
import { selectMapEvalContext, selectBestPathNodesSet, selectNodePreferences } from "../run/runSelectors";
import {
  evalStarted,
  evalSucceeded,
  evalFailed,
  evalRetryRequested,
} from "../evaluation/evaluationSlice";
import { selectEvalKey } from "../evaluation/evaluationSelectors";
import { selectActiveDeck, selectActivePlayer } from "../run/runSelectors";
import type { MapState } from "@sts2/shared/types/game-state";
import { buildEvaluationContext } from "@sts2/shared/evaluation/context-builder";
import { getPromptContext, updateFromContext, appendDecision } from "@sts2/shared/evaluation/run-narrative";
import { registerLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import { shouldEvaluateMap } from "../../lib/should-evaluate-map";
import { computeMapEvalKey, buildMapPrompt } from "../../lib/eval-inputs/map";
import type { RunState } from "@sts2/shared/evaluation/map/run-state";
import { scorePaths } from "@sts2/shared/evaluation/map/score-paths";
import { buildPreEvalPayload } from "../../lib/build-pre-eval-payload";
import { computeSubgraphFingerprint, type FingerprintNode } from "../../lib/compute-subgraph-fingerprint";
import { computeDeckMaturity, type DeckMaturityInput } from "@sts2/shared/evaluation/deck-maturity";
import { detectArchetypes, hasScalingSources, getScalingSources } from "@sts2/shared/evaluation/archetype-detector";
import { detectMapNodeOutcome } from "@sts2/shared/choice-detection/detect-map-node-outcome";
import { appendNode as appendActNode } from "@sts2/shared/choice-detection/act-path-tracker";
import { registerPendingChoice, getPendingChoice, clearPendingChoice } from "@sts2/shared/choice-detection/pending-choice-registry";
import { buildBackfillPayload } from "@sts2/shared/choice-detection/build-backfill-payload";
import type { MapNode as ChoiceMapNode } from "@sts2/shared/choice-detection/types";
import { getUserId } from "@sts2/shared/lib/get-user-id";
import { waitForRunCreated } from "../run/runAnalyticsListener";
import { getLastEvaluation } from "@sts2/shared/evaluation/last-evaluation-registry";
import { logDevEvent, logReduxSnapshot } from "../../lib/dev-logger";

const EVAL_TYPE = "map" as const;

/**
 * Last computed run-state for the active map eval. Keyed by runId. Cleared on
 * `runStarted` / `runEnded` so long-lived desktop sessions don't accumulate
 * one `RunState` per historical run. The map_node choice write path reads
 * this to populate `runStateSnapshot` on `/api/choice` — it fires the moment
 * the player moves, which may be before the eval response for THAT position
 * arrives, so we use the last known snapshot (the one the player was looking
 * at when they decided). Good enough for phase 1 persistence; a tighter
 * guarantee would require pairing the snapshot with the evalKey.
 */
/**
 * Cache of the per-run compliance bundle (runState + enrichedPaths +
 * candidate-set fingerprints) used to populate `runStateSnapshot` on
 * `/api/choice`. Persisting the full compliance — not just the RunState —
 * is what makes #79's backtest replay possible: with `enrichedPaths`
 * captured at choice time, `scorePaths` can re-run on historical rows.
 *
 * Type is `unknown` to keep the listener decoupled from the eval-inputs
 * type surface; runtime shape is `MapComplianceInputs`.
 */
const lastMapRunState = new Map<string, unknown>();

/**
 * Last narrated winner path (node id set) per runId. Used to skip the
 * narrator LLM call when the scorer re-fires but picks the same strategic
 * plan — either because the player advanced along it (new winner path is
 * a suffix of the old) or because the fork resolved to the same direction.
 * Cleared on `runStarted` / `runEnded`.
 */
const lastNarratedPathByRun = new Map<string, Set<string>>();

/**
 * Parse a coach macro-path entry (`"col,row"`) into coordinates. Returns null
 * if either token is missing / non-numeric / negative / non-integer. The
 * schema layer enforces the same regex, but we keep this defensive so a
 * mis-formatted LLM response degrades gracefully (drop the bad entry) instead
 * of producing `NaN`/`0` rows that silently corrupt the highlighted path.
 */
export function parseNodeId(nodeId: string): { col: number; row: number } | null {
  const parts = nodeId.split(",");
  if (parts.length !== 2) return null;
  const [colStr, rowStr] = parts;
  if (!/^\d+$/.test(colStr) || !/^\d+$/.test(rowStr)) return null;
  const col = Number(colStr);
  const row = Number(rowStr);
  if (!Number.isInteger(col) || !Number.isInteger(row)) return null;
  if (col < 0 || row < 0) return null;
  return { col, row };
}

/**
 * Map evaluation listener.
 *
 * Watches game state changes on the map. Decides whether to evaluate
 * (via shouldEvaluateMap — three structural triggers: new map, moved
 * onto off-path node, or fork with distinct downstream subgraphs), then
 * owns the full eval pipeline: API call, path derivation, recommended
 * nodes, and Redux persistence.
 */
export function setupMapEvalListener() {
  let prevMapPosition: { col: number; row: number } | null = null;

  // Clear the run-state cache when a run starts or ends so the module-level
  // map doesn't accumulate one entry per historical run in long-lived
  // desktop sessions.
  startAppListening({
    predicate: (action) => runStarted.match(action) || runEnded.match(action),
    effect: () => {
      lastMapRunState.clear();
      lastNarratedPathByRun.clear();
    },
  });

  startAppListening({
    predicate: (action, currentState) => {
      if (evalRetryRequested.match(action) && action.payload === EVAL_TYPE) return true;
      if (!gameStateReceived.match(action)) return false;
      return selectCurrentGameState(currentState)?.state_type === "map";
    },

    effect: async (_action, listenerApi) => {
      const state = listenerApi.getState();
      const gameState = selectCurrentGameState(state);
      if (!gameState || gameState.state_type !== "map") return;

      const mapState = gameState as MapState;
      const run = selectActiveRun(state);
      if (!run) return;

      const options = mapState.map.next_options;
      const evalKey = computeMapEvalKey(options);
      const isRetry = evalRetryRequested.match(_action) && _action.payload === EVAL_TYPE;

      // #77: populate the run-state cache eagerly so the map_node choice
      // write path always has a non-null snapshot to persist — even on the
      // first move of a run, or when the eval is gated off by
      // `shouldEvaluateMap` (e.g. single-option row, unhealed act-start).
      // Cost is a synchronous buildMapPrompt call (no network); the
      // resulting prompt is only used by the downstream eval path, which
      // still runs when un-gated. Downstream path re-reads the cache.
      const activeRunIdForEagerCache = state.run.activeRunId;
      let eagerCompliance:
        | { runState: RunState; compliance: ReturnType<typeof buildMapPrompt>["compliance"] }
        | null = null;
      if (activeRunIdForEagerCache && options.length > 0) {
        try {
          const eagerDeckCards = selectActiveDeck(state);
          const eagerPlayer = selectActivePlayer(state);
          const eagerCtx = buildEvaluationContext(gameState, eagerDeckCards, eagerPlayer);
          if (eagerCtx) {
            const { runState: eagerRunState, compliance: eagerComplianceData } = buildMapPrompt({
              context: eagerCtx,
              state: mapState,
              cardRemovalCost: eagerPlayer?.cardRemovalCost ?? null,
            });
            // #79: persist the full compliance bundle (not just runState)
            // so `enrichedPaths` survive into `choices.run_state_snapshot`
            // for backtest replay.
            lastMapRunState.set(activeRunIdForEagerCache, eagerComplianceData);
            eagerCompliance = { runState: eagerRunState, compliance: eagerComplianceData };
          }
        } catch {
          // buildMapPrompt can throw on unusual state shapes; swallow so
          // the cache-miss is the worst case rather than a listener crash.
        }
      }

      // --- Should we evaluate? ---
      // Check BEFORE cancelling — don't cancel an in-flight eval
      // just to decide we don't need a new one.
      const prevContext = selectMapEvalContext(state);
      const storedPrefs = selectNodePreferences(state);
      const mapPlayer = mapState.player ?? mapState.map?.player;

      if (!isRetry) {
        const bestPathNodes = selectBestPathNodesSet(state);
        const currentPos = mapState.map?.current_position ?? null;

        // Use bestPathNodes (recommended option's path only) for deviation detection,
        // NOT recommendedNodes (all options' paths). This ensures re-eval fires when
        // the user picks a different option than recommended.
        const isOnPath = currentPos
          ? bestPathNodes.has(`${currentPos.col},${currentPos.row}`)
          : false;

        const currentHp = mapPlayer && mapPlayer.max_hp > 0 ? mapPlayer.hp / mapPlayer.max_hp : 1;
        const currentGold = mapPlayer?.gold ?? 0;
        const currentDeckSize = selectActiveDeck(state).length;

        // --- Map node choice logging ---
        if (currentPos && prevMapPosition &&
            (currentPos.col !== prevMapPosition.col || currentPos.row !== prevMapPosition.row)) {
          const optionsWithTypes: ChoiceMapNode[] = options.map((o) => ({
            col: o.col,
            row: o.row,
            nodeType: o.type,
          }));

          const recommendedNext = optionsWithTypes.find((o) =>
            bestPathNodes.has(`${o.col},${o.row}`)
          ) ?? null;

          const mapOutcome = detectMapNodeOutcome({
            previousPosition: prevMapPosition,
            currentPosition: currentPos,
            recommendedNextNode: recommendedNext,
            nextOptions: optionsWithTypes,
          });

          if (mapOutcome) {
            appendActNode(run.act, mapOutcome.chosenNode);

            const lastEval = getLastEvaluation("map");
            const isEvalPending = !lastEval;

            const runId = state.run.activeRunId;
            const runStateSnapshot = runId ? lastMapRunState.get(runId) ?? null : null;

            waitForRunCreated()
              .then(() => {
                listenerApi.dispatch(
                  evaluationApi.endpoints.logChoice.initiate({
                    runId,
                    choiceType: "map_node",
                    floor: run.floor,
                    act: run.act,
                    sequence: 0,
                    offeredItemIds: optionsWithTypes.map((o) => `${o.col},${o.row}`),
                    chosenItemId: `${mapOutcome.chosenNode.col},${mapOutcome.chosenNode.row}`,
                    recommendedItemId: mapOutcome.recommendedNode
                      ? `${mapOutcome.recommendedNode.col},${mapOutcome.recommendedNode.row}`
                      : null,
                    recommendedTier: lastEval?.recommendedTier ?? null,
                    wasFollowed: mapOutcome.wasFollowed,
                    rankingsSnapshot: lastEval?.allRankings ?? null,
                    gameContext: {
                      hpPercent: currentHp,
                      gold: currentGold,
                      deckSize: currentDeckSize,
                      ascension: run.ascension,
                      act: run.act,
                      character: run.character,
                    },
                    evalPending: isEvalPending,
                    userId: getUserId(),
                    runStateSnapshot,
                  })
                );
              })
              .catch(console.error);

            if (isEvalPending) {
              registerPendingChoice(
                run.floor,
                "map_node",
                `${mapOutcome.chosenNode.col},${mapOutcome.chosenNode.row}`,
                0
              );
            }

            appendDecision({
              floor: run.floor,
              type: "map",
              chosen: mapOutcome.chosenNode.nodeType,
              advise: mapOutcome.recommendedNode?.nodeType ?? null,
              aligned: mapOutcome.wasFollowed,
            });
          }
        }
        prevMapPosition = currentPos;

        const actChanged = prevContext ? prevContext.act !== run.act : false;
        const ancientHealResolved = !actChanged || currentHp >= 0.5;

        const allNodesForFp: FingerprintNode[] = (mapState.map?.nodes ?? []).map((n) => ({
          col: n.col,
          row: n.row,
          type: n.type.toLowerCase(),
          children: n.children.map(([col, row]) => ({ col, row })),
        }));
        const bossRow = mapState.map.boss.row;
        const fingerprints = options.map((o) =>
          computeSubgraphFingerprint(allNodesForFp, { col: o.col, row: o.row }, bossRow - 1),
        );

        const input = {
          optionCount: options.length,
          hasPrevContext: !!prevContext,
          isStartOfAct: actChanged,
          ancientHealResolved,
          currentPosition: currentPos,
          isOnRecommendedPath: isOnPath,
          nextOptions: options.map((o) => ({ col: o.col, row: o.row, type: o.type.toLowerCase() })),
          nextOptionSubgraphFingerprints: fingerprints,
        };

        const shouldEval = shouldEvaluateMap(input);
        logDevEvent("eval", "map_should_eval", { input, shouldEval });
        if (!shouldEval) return;

        // Narrator gate. The scorer is pure JS and already ran for the
        // eager cache above — reuse it to check whether the player is
        // still following the previously-narrated plan. If the new
        // winner's first node (= the recommended next step) is on the
        // previously-narrated path, treat it as "same plan, advanced
        // one step" and skip the LLM call. Start-of-act always fires
        // so the first eval of an act gets fresh narration.
        //
        // We deliberately don't require every mid-path node to match —
        // the enumerator yields many paths from each next_option and
        // small HP/gold/deck shifts between evals can flip the ranking
        // between two paths with identical strategic shape but different
        // intermediate columns. The narrator text is strategic (elite
        // count, rest-elite density, HP at boss), so mid-path column
        // flips don't invalidate it. The first-node check captures
        // "player is still on track" — which is what the user experience
        // actually depends on.
        if (!actChanged && eagerCompliance && activeRunIdForEagerCache) {
          const scored = scorePaths(
            eagerCompliance.compliance.enrichedPaths,
            eagerCompliance.runState,
            { cardRemovalCost: eagerCompliance.compliance.cardRemovalCost },
          );
          const winner = scored[0];
          const prevNarrated = lastNarratedPathByRun.get(activeRunIdForEagerCache);
          if (winner && prevNarrated) {
            const firstNodeId = winner.nodes[0]?.nodeId;
            const onTrack = typeof firstNodeId === "string" && prevNarrated.has(firstNodeId);
            if (onTrack) {
              logDevEvent("eval", "map_skip_narrator_on_track", {
                firstNodeId,
                storedPathSize: prevNarrated.size,
              });
              return;
            }
          }
        }
      }

      // --- Dedup ---
      const currentKey = selectEvalKey(EVAL_TYPE)(state);
      if (!isRetry && currentKey === evalKey) return;

      // Cancel any in-flight eval NOW — we've decided to start a new one
      listenerApi.cancelActiveListeners();

      // --- Build context ---
      const deckCards = selectActiveDeck(state);
      const player = selectActivePlayer(state);
      const ctx = buildEvaluationContext(gameState, deckCards, player);
      if (!ctx) {
        listenerApi.dispatch(evalFailed({ evalType: EVAL_TYPE, evalKey, error: "Could not build evaluation context" }));
        return;
      }

      if (mapPlayer) {
        ctx.gold = mapPlayer.gold;
        ctx.hpPercent = mapPlayer.max_hp > 0 ? mapPlayer.hp / mapPlayer.max_hp : 1;
      }

      updateFromContext(ctx);
      listenerApi.dispatch(evalStarted({ evalType: EVAL_TYPE, evalKey }));

      // --- Pre-API dispatch ---
      // Set lastEvalContext + recommendedNodes BEFORE the API call so that
      // subsequent polls see hasPrevContext=true and don't re-trigger.
      const hpPct = mapPlayer && mapPlayer.max_hp > 0 ? mapPlayer.hp / mapPlayer.max_hp : 1;
      const allNodes = mapState.map?.nodes ?? [];
      const bossPos = mapState.map.boss;
      const act = mapState.run?.act ?? 1;
      const floor = mapState.run?.floor ?? 1;
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

      const preEval = buildPreEvalPayload({
        options,
        allNodes,
        bossPos,
        hpPercent: hpPct,
        gold: mapPlayer?.gold ?? 0,
        act,
        deckSize: deckCards.length,
        deckMaturity,
        relicCount,
        floor,
        ascension: run.ascension,
        maxHp: mapPlayer?.max_hp ?? 80,
        currentRemovalCost: player?.cardRemovalCost ?? 75,
        nodePreferences: storedPrefs,
      });
      // Preserve the PREVIOUS act in the pre-eval context so that if the
      // API call fails, shouldEvaluateMap still detects the act change and
      // retries. The post-API dispatch sets the correct act on success.
      preEval.lastEvalContext.act = prevContext?.act ?? 0;
      // Pre-eval: set bestPathNodes to all options — can't know best until API completes.
      // This prevents false deviation detection during the API window.
      listenerApi.dispatch(mapEvalUpdated({ ...preEval, bestPathNodes: preEval.recommendedNodes }));

      try {
        const { prompt: mapPrompt, runState, compliance: mapCompliance } = buildMapPrompt({
          context: ctx,
          state: mapState,
          cardRemovalCost: player?.cardRemovalCost ?? null,
        });

        // Cache the full compliance bundle for the map_node choice write
        // path. Using the bundle (not just runState) means enrichedPaths
        // survive into the persisted snapshot — required for #79 replay.
        const activeRunIdForCache = state.run.activeRunId;
        if (activeRunIdForCache) {
          lastMapRunState.set(activeRunIdForCache, mapCompliance);
        }

        logDevEvent("eval", "map_api_request", {
          context: ctx,
          mapPrompt,
          floor: ctx.floor,
          act: ctx.act,
          ascension: ctx.ascension,
          hpPercent: ctx.hpPercent,
          deckSize: ctx.deckSize,
          candidatePaths: mapCompliance.enrichedPaths.length,
          candidateEliteCounts: mapCompliance.enrichedPaths.map((p) => p.aggregates.elitesTaken),
        });
        const parsed = await listenerApi
          .dispatch(
            evaluationApi.endpoints.evaluateMap.initiate({
              context: ctx,
              runNarrative: getPromptContext(),
              mapPrompt,
              runId: null,
              gameVersion: null,
              mapCompliance,
            })
          )
          .unwrap();
        logDevEvent("eval", "map_api_response", parsed);

        // Top-N scored candidates log — when a pick looks wrong, checking this
        // reveals whether the scorer's ranking itself is off vs. the candidate
        // pool not containing the expected best path.
        const scoredPaths = parsed.compliance?.scoredPaths;
        if (scoredPaths && scoredPaths.length > 0) {
          const top = [...scoredPaths]
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map((s) => ({
              id: s.id,
              score: Number(s.score.toFixed(2)),
              elites: s.scoreBreakdown.elitesTaken ?? 0,
              restBeforeElite: s.scoreBreakdown.restBeforeElite ?? 0,
              projectedHpAtBoss: Number((s.scoreBreakdown.projectedHpAtBossFight ?? 0).toFixed(2)),
              hpDip30: s.scoreBreakdown.hpDipBelow30PctPenalty ?? 0,
              hpDip15: s.scoreBreakdown.hpDipBelow15PctPenalty ?? 0,
              dq: s.disqualified,
              dqReasons: s.disqualifyReasons,
            }));
          logDevEvent("eval", "map_scored_top5", {
            totalCandidates: scoredPaths.length,
            top,
          });
        }

        // --- Post-API path derivation ---
        // The map coach returns a pre-computed macro path (one node per
        // future floor). Convert `node_id` ("col,row") back to coordinates
        // for UI highlighting and deviation detection. Malformed entries are
        // dropped so a mis-formatted LLM response degrades gracefully.
        const coachPath: { col: number; row: number }[] = parsed.macroPath.floors
          .map((f) => parseNodeId(f.nodeId))
          .filter((p): p is { col: number; row: number } => p !== null);

        // Prepend current position so the highlighted range covers from where
        // the player is standing.
        const currentPos = mapState.map?.current_position ?? null;
        const fullPath = currentPos &&
          (coachPath.length === 0 ||
            coachPath[0].col !== currentPos.col ||
            coachPath[0].row !== currentPos.row)
          ? [{ col: currentPos.col, row: currentPos.row }, ...coachPath]
          : coachPath;

        logDevEvent("eval", "map_coach_path", { coachPath, fullPath });

        // recommendedNodes = all candidate next options + their downstream
        // projections (we no longer have per-option projections from the
        // model; use the coach path for all highlighting).
        const recommendedNodes = new Set<string>();
        for (const opt of options) {
          recommendedNodes.add(`${opt.col},${opt.row}`);
        }
        for (const p of fullPath) {
          recommendedNodes.add(`${p.col},${p.row}`);
        }

        const bestPathNodes = new Set<string>();
        for (const p of fullPath) {
          bestPathNodes.add(`${p.col},${p.row}`);
        }

        // Stash the narrated path so the scorer gate can skip subsequent
        // evals whose winner is a suffix (player advanced) or identical
        // (fork picked the same branch). Uses the server's returned
        // macro_path, not the local scorer, so the two ends stay in sync.
        const activeRunIdForNarratedStore = state.run.activeRunId;
        if (activeRunIdForNarratedStore) {
          const narratedSet = new Set<string>();
          for (const f of parsed.macroPath.floors) narratedSet.add(f.nodeId);
          lastNarratedPathByRun.set(activeRunIdForNarratedStore, narratedSet);
        }

        // First entry on the coach path — used for backfill + best-option lookup.
        const bestOpt = coachPath.length > 0
          ? options.find((o) => o.col === coachPath[0].col && o.row === coachPath[0].row) ?? null
          : null;

        // Persist path + context to Redux. `nodePreferences` is left intact
        // from prior evals (the coach doesn't produce them; kept so
        // buildPreEvalPayload can forward them to subsequent scorer runs).
        listenerApi.dispatch(mapEvalUpdated({
          recommendedPath: fullPath,
          recommendedNodes: [...recommendedNodes],
          bestPathNodes: [...bestPathNodes],
          lastEvalContext: {
            hpPercent: hpPct,
            deckSize: deckCards.length,
            act,
            gold: mapPlayer?.gold ?? 0,
            ascension: run.ascension,
          },
        }));
        logReduxSnapshot(listenerApi as unknown as { getState: () => unknown }, "after_map_eval");

        // #78: stash the full parsed coach output in `raw` so phase-2
        // calibration can recover reasoning/branches/callouts later.
        // `allRankings` intrinsically doesn't apply to map (no per-item
        // rankings); leaving it as [] is correct for the choice-tracker
        // read path, which doesn't consult it for map evals.
        registerLastEvaluation("map", {
          recommendedId: bestOpt ? `${bestOpt.col},${bestOpt.row}` : null,
          recommendedTier: null,
          reasoning: parsed.headline,
          allRankings: [],
          evalType: "map",
          raw: parsed,
        });

        // Backfill: if user picked a map node before eval completed
        const activeRunId = state.run.activeRunId;
        const pendingMapNode = getPendingChoice(floor, "map_node");
        if (pendingMapNode && activeRunId) {
          const recommendedNodeId = bestOpt ? `${bestOpt.col},${bestOpt.row}` : null;
          const backfill = buildBackfillPayload(
            activeRunId,
            {
              recommendedId: recommendedNodeId,
              recommendedTier: null,
              allRankings: [],
            },
            pendingMapNode
          );

          listenerApi.dispatch(
            evaluationApi.endpoints.logChoice.initiate({
              ...backfill,
              chosenItemId: pendingMapNode.chosenItemId,
              offeredItemIds: [],
              userId: getUserId(),
              // #79: persist full compliance (incl. enrichedPaths) for backtest replay.
              runStateSnapshot: mapCompliance,
            })
          );

          clearPendingChoice(floor, "map_node");
        }

        listenerApi.dispatch(evalSucceeded({ evalType: EVAL_TYPE, evalKey, result: parsed }));
      } catch (err) {
        listenerApi.dispatch(evalFailed({
          evalType: EVAL_TYPE,
          evalKey,
          error: err instanceof Error ? err.message : "Evaluation failed",
        }));
      }
    },
  });
}
