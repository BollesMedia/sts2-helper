import { setupCardRewardEvalListener } from "./cardRewardEvalListener";
import { setupShopEvalListener } from "./shopEvalListener";
import { setupEventEvalListener } from "./eventEvalListener";
import { setupRestSiteEvalListener } from "./restSiteEvalListener";
import { setupCardRemovalEvalListener } from "./cardRemovalEvalListener";
import { setupCardUpgradeEvalListener } from "./cardUpgradeEvalListener";
import { setupCardSelectEvalListener } from "./cardSelectEvalListener";
import { setupRelicSelectEvalListener } from "./relicSelectEvalListener";

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
  setupCardSelectEvalListener();
  setupRelicSelectEvalListener();
}
