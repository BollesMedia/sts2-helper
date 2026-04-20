import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateReceived, selectCurrentGameState } from "../gameState/gameStateSlice";
import { evaluationApi } from "../../services/evaluationApi";
import { selectActiveRun, mapEvalUpdated, mapPathRetraced, runStarted, runEnded } from "../run/runSlice";
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
import { buildPreEvalPayload } from "../../lib/build-pre-eval-payload";
import { traceConstraintAwarePath } from "../../views/map/constraint-aware-tracer";
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
const lastMapRunState = new Map<string, unknown>();

/**
 * Per-run skip counter for the "entering new act with unhealed HP" window.
 *
 * Flow: Act N boss dies → Ancient event → Ancient pick heals HP → Act N+1
 * map appears. The game sometimes dispatches the map state update BEFORE
 * the heal is reflected in `player.hp`, so the first eval after actChange
 * can run with pre-heal HP and produce a CRITICAL-risk reading on what is
 * actually a freshly-healed run.
 *
 * Defer the eval for up to `ACT_CHANGE_GRACE_SKIPS` state updates when we
 * detect act-change + abnormally low HP. The next update with higher HP
 * fires the eval with the correct context. Failsafe: after the skip cap we
 * proceed regardless — if the player genuinely entered the act at low HP,
 * they need the eval.
 */
const ACT_CHANGE_GRACE_SKIPS = 3;
const actChangeGrace = new Map<string, { act: number; skips: number }>();

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
 * (via shouldEvaluateMap), then owns the full eval pipeline: API call,
 * path tracing, recommended nodes, and Redux persistence.
 *
 * Tier 1 deviation (off-path, no material context change) re-traces
 * locally using stored LLM nodePreferences — no API call needed.
 * Tier 2 deviation (HP/gold/deck changed) triggers a full re-evaluation.
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
      actChangeGrace.clear();
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
      // first move of a run, or when the eval is gated off
      // (allOptionsAreAncient, grace-skip, single-option-on-path). Cost is a
      // synchronous buildMapPrompt call (no network); the resulting prompt
      // is only used by the downstream eval path, which still runs when
      // un-gated. Downstream path re-reads the cache.
      const activeRunIdForEagerCache = state.run.activeRunId;
      if (activeRunIdForEagerCache && options.length > 0) {
        try {
          const eagerDeckCards = selectActiveDeck(state);
          const eagerPlayer = selectActivePlayer(state);
          const eagerCtx = buildEvaluationContext(gameState, eagerDeckCards, eagerPlayer);
          if (eagerCtx) {
            const { runState: eagerRunState } = buildMapPrompt({
              context: eagerCtx,
              state: mapState,
              cardRemovalCost: eagerPlayer?.cardRemovalCost ?? null,
            });
            lastMapRunState.set(activeRunIdForEagerCache, eagerRunState);
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

        // Compute Tier 2 context-change flags
        const currentHp = mapPlayer && mapPlayer.max_hp > 0 ? mapPlayer.hp / mapPlayer.max_hp : 1;
        const currentGold = mapPlayer?.gold ?? 0;
        const currentDeckSize = selectActiveDeck(state).length;

        const hpDropExceedsThreshold = prevContext
          ? (prevContext.hpPercent - currentHp) > 0.20
          : false;
        const goldCrossedThreshold = prevContext
          ? (prevContext.gold >= 150 && currentGold < 150) || (prevContext.gold < 150 && currentGold >= 150)
          : false;
        const deckSizeChangedSignificantly = prevContext
          ? Math.abs(prevContext.deckSize - currentDeckSize) >= 2
          : false;

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

        // STS2 places Ancient nodes alone in their row, so when an act starts
        // on an Ancient the player's only next move is into the event. Skip
        // the eval until after the event resolves and the player gets real
        // options (#56). `.every()` is the defensive form — if the game ever
        // ships a row with multiple ancient options, the gate still matches,
        // and a hypothetical mixed Ancient/non-Ancient row would NOT match
        // (the player would have a real choice worth evaluating).
        const allOptionsAreAncient =
          options.length > 0 && options.every((o) => o.type === "Ancient");

        // Check if the recommended path ahead contains a shop that's now worthless
        const removalCost = selectActivePlayer(state)?.cardRemovalCost ?? 75;
        let shopInPathBecameWorthless = false;
        if (prevContext && isOnPath && currentGold < removalCost && prevContext.gold >= removalCost) {
          // Gold dropped below removal cost — check if path ahead has a shop
          const allNodes = mapState.map?.nodes ?? [];
          const currentRow = currentPos?.row ?? 0;
          const bestNodes = bestPathNodes;
          for (const node of allNodes) {
            if (node.row > currentRow && node.type === "Shop" && bestNodes.has(`${node.col},${node.row}`)) {
              shopInPathBecameWorthless = true;
              break;
            }
          }
        }

        const input = {
          optionCount: options.length,
          hasPrevContext: !!prevContext,
          actChanged: prevContext ? prevContext.act !== run.act : false,
          currentPosition: currentPos,
          isOnRecommendedPath: isOnPath,
          allOptionsAreAncient,
          hpDropExceedsThreshold,
          goldCrossedThreshold,
          deckSizeChangedSignificantly,
          shopInPathBecameWorthless,
        };

        // Defer the first post-act-change eval if HP still looks pre-heal.
        // STS2 applies the ancient's HP heal asynchronously from the map
        // state update, so `currentHp` on the first tick of a new act can
        // be the pre-boss-fight remainder rather than the post-ancient
        // heal. A few-tick grace window lets the heal land.
        const activeRunIdForGrace = state.run.activeRunId;
        if (input.actChanged && activeRunIdForGrace) {
          const graceKey = activeRunIdForGrace;
          const existing = actChangeGrace.get(graceKey);
          const isSameActChange = existing && existing.act === run.act;
          const skips = isSameActChange ? existing.skips : 0;
          if (currentHp < 0.5 && skips < ACT_CHANGE_GRACE_SKIPS) {
            actChangeGrace.set(graceKey, { act: run.act, skips: skips + 1 });
            logDevEvent("eval", "map_act_change_grace_skip", {
              act: run.act,
              hpPct: currentHp,
              skipsSoFar: skips + 1,
            });
            return;
          }
          // HP looks healed (or we've hit the skip cap) — clear and proceed.
          if (existing) actChangeGrace.delete(graceKey);
        }

        const shouldEval = shouldEvaluateMap(input);
        logDevEvent("eval", "map_should_eval", { input, shouldEval });
        if (!shouldEval) return;

        // Tier 1: If deviated but no material context change, just re-trace locally
        if (
          currentPos &&
          !isOnPath &&
          storedPrefs &&
          !hpDropExceedsThreshold &&
          !goldCrossedThreshold &&
          !deckSizeChangedSignificantly &&
          !input.actChanged
        ) {
          const allNodes = mapState.map?.nodes ?? [];
          const bossPos = mapState.map.boss;
          const player = selectActivePlayer(state);

          const tracerInput = {
            nodes: allNodes,
            bossPos,
            nodePreferences: storedPrefs,
            hpPercent: currentHp,
            gold: currentGold,
            act: run.act,
            ascension: run.ascension,
            maxHp: mapPlayer?.max_hp ?? 80,
            currentRemovalCost: player?.cardRemovalCost ?? 75,
          };

          // Re-trace from current position using stored weights
          const retracedPath = traceConstraintAwarePath({
            startCol: currentPos.col,
            startRow: currentPos.row,
            ...tracerInput,
          });

          // Build recommendedNodes from all options' traces
          const recommendedNodes = new Set<string>();
          for (const opt of options) {
            recommendedNodes.add(`${opt.col},${opt.row}`);
            const optPath = traceConstraintAwarePath({
              startCol: opt.col,
              startRow: opt.row,
              ...tracerInput,
            });
            for (const p of optPath) {
              recommendedNodes.add(`${p.col},${p.row}`);
            }
          }
          for (const p of retracedPath) {
            recommendedNodes.add(`${p.col},${p.row}`);
          }

          const bestPathNodes2 = new Set<string>();
          for (const p of retracedPath) {
            bestPathNodes2.add(`${p.col},${p.row}`);
          }

          logDevEvent("eval", "map_tier1_retrace", {
            currentPos,
            storedPrefs,
            retracedPath,
            recommendedNodes: [...recommendedNodes],
          });
          listenerApi.dispatch(mapPathRetraced({
            recommendedPath: retracedPath,
            bestPathNodes: [...bestPathNodes2],
            recommendedNodes: [...recommendedNodes],
          }));
          return;
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

        // Cache the computed run-state for the map_node choice write path.
        const activeRunIdForCache = state.run.activeRunId;
        if (activeRunIdForCache) {
          lastMapRunState.set(activeRunIdForCache, runState);
        }

        logDevEvent("eval", "map_api_request", {
          context: ctx,
          mapPrompt,
          floor: ctx.floor,
          act: ctx.act,
          ascension: ctx.ascension,
          hpPercent: ctx.hpPercent,
          deckSize: ctx.deckSize,
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

        // First entry on the coach path — used for backfill + best-option lookup.
        const bestOpt = coachPath.length > 0
          ? options.find((o) => o.col === coachPath[0].col && o.row === coachPath[0].row) ?? null
          : null;

        // Persist path + context to Redux. `nodePreferences` is left intact
        // from prior evals (the coach doesn't produce them; Tier 1 retrace
        // still uses the last known set if any).
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
              runStateSnapshot: runState,
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
