import { setupCardRewardEvalListener } from "./cardRewardEvalListener";
import { setupShopEvalListener } from "./shopEvalListener";
import { setupEventEvalListener } from "./eventEvalListener";
import { setupRestSiteEvalListener } from "./restSiteEvalListener";
import { setupCardRemovalEvalListener } from "./cardRemovalEvalListener";
import { setupCardUpgradeEvalListener } from "./cardUpgradeEvalListener";

/**
 * Register all evaluation listeners.
 * Each listener watches for its game state type and triggers
 * evaluations via the evaluation slice.
 */
export function setupEvaluationListeners() {
  setupCardRewardEvalListener();
  setupShopEvalListener();
  setupEventEvalListener();
  setupRestSiteEvalListener();
  setupCardRemovalEvalListener();
  setupCardUpgradeEvalListener();
  // Phase 3: setupCardSelectEvalListener();
  // Phase 3: setupRelicSelectEvalListener();
}
