import { setupCardRewardEvalListener } from "./cardRewardEvalListener";

/**
 * Register all evaluation listeners.
 * Each listener watches for its game state type and triggers
 * evaluations via the evaluation slice.
 */
export function setupEvaluationListeners() {
  setupCardRewardEvalListener();
  // Phase 2: setupShopEvalListener();
  // Phase 2: setupEventEvalListener();
  // Phase 2: setupRestSiteEvalListener();
  // Phase 3: setupCardRemovalEvalListener();
  // Phase 3: setupCardUpgradeEvalListener();
  // Phase 3: setupCardSelectEvalListener();
  // Phase 3: setupRelicSelectEvalListener();
}
