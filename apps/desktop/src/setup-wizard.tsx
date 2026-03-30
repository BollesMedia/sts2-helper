import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface ModStatus {
  game_found: boolean;
  game_path: string | null;
  mods_dir: string | null;
  game_running: boolean;
  required_mods: {
    id: string;
    name: string;
    required_version: string;
    installed: boolean;
    installed_version: string | null;
    needs_update: boolean;
  }[];
  other_mods: {
    id: string;
    name: string;
    version: string;
    affects_gameplay: boolean;
  }[];
  conflicts: {
    mod_id: string;
    mod_name: string;
    reason: string;
    severity: string;
  }[];
}

type InstallOutcome =
  | "Installed"
  | "AlreadyUpToDate"
  | "Updated"
  | { Failed: string };

interface InstallResult {
  sts2mcp: InstallOutcome;
  unified_save_path: InstallOutcome;
}

function formatOutcome(outcome: InstallOutcome): string {
  if (typeof outcome === "string") return outcome.replace(/([A-Z])/g, " $1").trim();
  return `Failed: ${outcome.Failed}`;
}

interface ProgressEvent {
  modName: string;
  stage: string;
  percent: number;
}

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [status, setStatus] = useState<ModStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [installResult, setInstallResult] = useState<InstallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  if (!initialized) {
    setInitialized(true);
    invoke<ModStatus>("get_mod_status")
      .then((s) => {
        setStatus(s);
        setLoading(false);

        // If all required mods are installed and no updates needed, skip wizard
        if (s.game_found && s.required_mods.every((m) => m.installed && !m.needs_update)) {
          onComplete();
        }
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    setError(null);
    setInstallResult(null);

    // Listen for progress events
    const unlisten = await listen<ProgressEvent>("mod-install-progress", (event) => {
      setProgress(event.payload);
    });

    try {
      const result = await invoke<InstallResult>("install_required_mods");
      setInstallResult(result);

      // Refresh status after install
      const newStatus = await invoke<ModStatus>("get_mod_status");
      setStatus(newStatus);

      // If all mods now installed, allow continuing
      if (newStatus.required_mods.every((m) => m.installed)) {
        setTimeout(() => onComplete(), 1500);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      unlisten();
      setInstalling(false);
      setProgress(null);
    }
  }, [onComplete]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen">
        <div className="text-center space-y-3">
          <p className="text-sm text-zinc-400">Detecting game installation...</p>
          <div className="h-1 w-48 mx-auto rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-zinc-600 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center min-h-screen">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            STS2 Replay Setup
          </h1>
          <p className="text-sm text-zinc-500">
            Setting up the companion mods for Slay the Spire 2
          </p>
        </div>

        {/* Game detection */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Game Detection
          </h3>
          {status?.game_found ? (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-sm text-zinc-200">Slay the Spire 2 found</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              <span className="text-sm text-zinc-200">Game not found</span>
              <p className="text-xs text-zinc-500">
                Install Slay the Spire 2 via Steam, then restart this app.
              </p>
            </div>
          )}
          {status?.game_path && (
            <p className="text-xs text-zinc-600 font-mono truncate">{status.game_path}</p>
          )}
          {status?.game_running && (
            <div className="rounded bg-amber-500/10 border border-amber-500/30 px-3 py-2">
              <p className="text-xs text-amber-400">
                Game is running — close it before installing mods
              </p>
            </div>
          )}
        </div>

        {/* Required mods */}
        {status?.game_found && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Required Mods
            </h3>
            {status.required_mods.map((mod) => (
              <div key={mod.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      mod.installed && !mod.needs_update
                        ? "bg-emerald-400"
                        : mod.needs_update
                          ? "bg-amber-400"
                          : "bg-zinc-600"
                    }`}
                  />
                  <span className="text-sm text-zinc-200">{mod.name}</span>
                </div>
                <span className="text-xs text-zinc-500">
                  {mod.installed
                    ? mod.needs_update
                      ? `${mod.installed_version} → ${mod.required_version}`
                      : `v${mod.installed_version}`
                    : "Not installed"}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Other mods */}
        {status && status.other_mods.length > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Other Mods Detected
            </h3>
            {status.other_mods.map((mod) => (
              <div key={mod.id} className="flex items-center justify-between">
                <span className="text-sm text-zinc-300">{mod.name}</span>
                <span className="text-xs text-zinc-500">v{mod.version}</span>
              </div>
            ))}
          </div>
        )}

        {/* Conflicts */}
        {status && status.conflicts.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-amber-400">
              Warnings
            </h3>
            {status.conflicts.map((c) => (
              <p key={c.mod_id} className="text-xs text-zinc-400">
                <span className="text-amber-400">{c.mod_name}</span>: {c.reason}
              </p>
            ))}
          </div>
        )}

        {/* Progress */}
        {installing && progress && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-300">{progress.modName}</span>
              <span className="text-zinc-500">{progress.stage}</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        )}

        {/* Install result */}
        {installResult && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-1">
            <p className="text-sm text-emerald-400">Installation complete</p>
            <p className="text-xs text-zinc-500">
              STS2 MCP: {formatOutcome(installResult.sts2mcp)} · Save Path: {formatOutcome(installResult.unified_save_path)}
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={onComplete}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Skip setup
          </button>

          {status?.game_found && !status.game_running && (
            <button
              onClick={handleInstall}
              disabled={installing || status.required_mods.every((m) => m.installed && !m.needs_update)}
              className="rounded-lg bg-zinc-100 px-6 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {installing
                ? "Installing..."
                : status.required_mods.every((m) => m.installed && !m.needs_update)
                  ? "All installed ✓"
                  : "Install Required Mods"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
