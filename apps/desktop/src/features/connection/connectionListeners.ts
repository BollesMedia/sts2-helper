import { startAppListening } from "../../store/listenerMiddleware";
import { gameStateApi } from "../../services/gameStateApi";
import { statusChanged, gameModeDetected, modMismatchDetected } from "./connectionSlice";
import { invoke } from "@tauri-apps/api/core";

interface ModStatus {
  game_found: boolean;
  game_running: boolean;
  required_mods: {
    id: string;
    name: string;
    required_version: string;
    installed: boolean;
    installed_version: string | null;
    needs_update: boolean;
  }[];
}

/**
 * Watches RTK Query game state results and syncs connection status
 * + game mode to the connection slice.
 */
export function setupConnectionListeners() {
  let modCheckDone = false;

  // Connected: query fulfilled
  startAppListening({
    matcher: gameStateApi.endpoints.getGameState.matchFulfilled,
    effect: (action, listenerApi) => {
      const data = action.payload;
      listenerApi.dispatch(statusChanged("connected"));
      if (data.game_mode) {
        listenerApi.dispatch(gameModeDetected(data.game_mode));
      }

      // One-shot mod version check on first successful connection
      if (!modCheckDone) {
        modCheckDone = true;
        invoke<ModStatus>("get_mod_status")
          .then((status) => {
            const sts2mcp = status.required_mods.find((m) => m.id === "STS2_MCP");
            if (sts2mcp?.needs_update && sts2mcp.installed_version) {
              listenerApi.dispatch(
                modMismatchDetected({
                  installed: sts2mcp.installed_version,
                  required: sts2mcp.required_version,
                  gameRunning: status.game_running,
                })
              );
            }
          })
          .catch(() => {
            // Silent — mod check is best-effort
          });
      }
    },
  });

  // Disconnected: query rejected (but NOT_READY is just "Rust hasn't fetched yet" → ignore)
  startAppListening({
    matcher: gameStateApi.endpoints.getGameState.matchRejected,
    effect: (action, listenerApi) => {
      const status = (action.payload as { status?: unknown } | undefined)?.status;
      if (status === "NOT_READY") return;
      listenerApi.dispatch(statusChanged("disconnected"));
    },
  });
}
