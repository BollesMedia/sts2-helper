import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type BannerState =
  | { type: "mismatch"; installed: string; required: string; gameRunning: boolean }
  | { type: "updating"; modName: string; stage: string; percent: number }
  | { type: "updated" }
  | { type: "error"; message: string };

interface ModVersionBannerProps {
  installed: string;
  required: string;
  gameRunning: boolean;
  onUpdated: () => void;
}

export function ModVersionBanner({ installed, required, gameRunning, onUpdated }: ModVersionBannerProps) {
  const [state, setState] = useState<BannerState>({
    type: "mismatch",
    installed,
    required,
    gameRunning,
  });

  const handleUpdate = useCallback(async () => {
    setState({ type: "updating", modName: "STS2 MCP", stage: "Starting...", percent: 0 });

    const unlisten = await listen<{ modName: string; stage: string; percent: number }>(
      "mod-install-progress",
      (event) => {
        setState({
          type: "updating",
          modName: event.payload.modName,
          stage: event.payload.stage,
          percent: event.payload.percent,
        });
      }
    );

    try {
      await invoke("install_required_mods");
      setState({ type: "updated" });
      onUpdated();
    } catch (e) {
      setState({ type: "error", message: String(e) });
    } finally {
      unlisten();
    }
  }, [onUpdated]);

  if (state.type === "mismatch" && state.gameRunning) {
    return (
      <div className="border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 flex items-center justify-between">
        <p className="text-xs text-amber-400">
          Mod v{state.installed} detected — v{state.required} required. Close the game to auto-update.
        </p>
      </div>
    );
  }

  if (state.type === "mismatch") {
    return (
      <div className="border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 flex items-center justify-between">
        <p className="text-xs text-amber-400">
          Mod v{state.installed} detected — v{state.required} required.
        </p>
        <button
          onClick={handleUpdate}
          className="text-xs font-medium text-amber-400 hover:text-amber-300 transition-colors"
        >
          Update now
        </button>
      </div>
    );
  }

  if (state.type === "updating") {
    return (
      <div className="border-b border-blue-500/30 bg-blue-500/5 px-4 py-2">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-blue-400">
            Updating {state.modName}... {state.stage}
          </p>
          <span className="text-xs font-mono text-blue-400">{state.percent}%</span>
        </div>
        <div className="h-1 rounded-full bg-spire-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${state.percent}%` }}
          />
        </div>
      </div>
    );
  }

  if (state.type === "updated") {
    return (
      <div className="border-b border-emerald-500/30 bg-emerald-500/5 px-4 py-2 flex items-center justify-between">
        <p className="text-xs text-emerald-400">
          Mod updated to v{required}. Restart the game to apply.
        </p>
      </div>
    );
  }

  if (state.type === "error") {
    return (
      <div className="border-b border-red-500/30 bg-red-500/5 px-4 py-2 flex items-center justify-between">
        <p className="text-xs text-red-400">
          Update failed: {state.message}
        </p>
        <button
          onClick={handleUpdate}
          className="text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return null;
}
