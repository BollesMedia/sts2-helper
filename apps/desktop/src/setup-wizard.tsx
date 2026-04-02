import { useState, useCallback, useRef } from "react";
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

function hasFailure(result: InstallResult): boolean {
  return typeof result.sts2mcp === "object" || typeof result.unified_save_path === "object";
}

function summarizeOutcome(result: InstallResult): string {
  const parts: string[] = [];
  const outcomes = [
    { name: "STS2 MCP", outcome: result.sts2mcp },
    { name: "Unified Save Path", outcome: result.unified_save_path },
  ];
  const installed = outcomes.filter((o) => o.outcome === "Installed");
  const updated = outcomes.filter((o) => o.outcome === "Updated");

  if (installed.length > 0) parts.push(`${installed.map((o) => o.name).join(" and ")} installed`);
  if (updated.length > 0) parts.push(`${updated.map((o) => o.name).join(" and ")} updated`);

  return parts.length > 0
    ? `${parts.join(", and ")}. You're ready to play.`
    : "All mods are up to date. You're ready to play.";
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
  const initialized = useRef(false);

  const allInstalled = status?.required_mods.every((m) => m.installed && !m.needs_update) ?? false;
  const needsUpdate = status?.required_mods.some((m) => m.installed && m.needs_update) ?? false;

  if (!initialized.current) {
    initialized.current = true;
    invoke<ModStatus>("get_mod_status")
      .then((s) => {
        setStatus(s);
        setLoading(false);
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

    const unlisten = await listen<ProgressEvent>("mod-install-progress", (event) => {
      setProgress(event.payload);
    });

    try {
      const result = await invoke<InstallResult>("install_required_mods");
      setInstallResult(result);
      const newStatus = await invoke<ModStatus>("get_mod_status");
      setStatus(newStatus);
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
          <p className="text-sm text-spire-text-tertiary">Detecting game installation...</p>
          <div className="h-1 w-48 mx-auto rounded-full bg-spire-muted overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-spire-border-emphasis animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  // Success screen
  if (installResult && !hasFailure(installResult)) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen">
        <div className="w-full max-w-lg space-y-6 text-center animate-fade-in-up">
          <div className="flex justify-center">
            <div className="rounded-full bg-emerald-500/10 p-3">
              <svg
                className="h-12 w-12 text-emerald-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-display font-semibold tracking-tight text-spire-text">
              You're all set!
            </h1>
            <p className="text-sm text-spire-text-tertiary">
              {summarizeOutcome(installResult)}
            </p>
          </div>
          <button
            onClick={onComplete}
            className="rounded-lg bg-spire-gold px-6 py-2 text-sm font-medium text-spire-base hover:bg-spire-gold-light transition-colors"
          >
            Launch App
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center min-h-screen">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-display font-semibold tracking-tight text-spire-text">
            STS2 Replay Setup
          </h1>
          <p className="text-sm text-spire-text-tertiary">
            Setting up the companion mods for Slay the Spire 2
          </p>
        </div>

        {/* Game detection */}
        <div className="rounded-lg border border-spire-border bg-spire-surface/50 p-4 space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-spire-text-muted">
            Game Detection
          </h3>
          {status?.game_found ? (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-sm text-spire-text">Slay the Spire 2 found</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              <span className="text-sm text-spire-text">Game not found</span>
              <p className="text-xs text-spire-text-tertiary">
                Install Slay the Spire 2 via Steam, then restart this app.
              </p>
            </div>
          )}
          {status?.game_path && (
            <p className="text-xs text-spire-text-muted font-mono truncate">{status.game_path}</p>
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
          <div className="rounded-lg border border-spire-border bg-spire-surface/50 p-4 space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-spire-text-muted">
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
                          : "bg-spire-text-muted"
                    }`}
                  />
                  <span className="text-sm text-spire-text">{mod.name}</span>
                </div>
                <span className="text-xs text-spire-text-tertiary">
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
          <div className="rounded-lg border border-spire-border bg-spire-surface/50 p-4 space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-spire-text-muted">
              Other Mods Detected
            </h3>
            {status.other_mods.map((mod) => (
              <div key={mod.id} className="flex items-center justify-between">
                <span className="text-sm text-spire-text-secondary">{mod.name}</span>
                <span className="text-xs text-spire-text-tertiary">v{mod.version}</span>
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
              <p key={c.mod_id} className="text-xs text-spire-text-tertiary">
                <span className="text-amber-400">{c.mod_name}</span>: {c.reason}
              </p>
            ))}
          </div>
        )}

        {/* Progress */}
        {installing && progress && (
          <div className="rounded-lg border border-spire-border bg-spire-surface/50 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-spire-text-secondary">{progress.modName}</span>
              <span className="text-spire-text-tertiary">{progress.stage}</span>
            </div>
            <div className="h-1.5 rounded-full bg-spire-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        )}

        {/* Install failure */}
        {installResult && hasFailure(installResult) && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-1">
            <p className="text-sm text-red-400">Installation completed with errors</p>
            <p className="text-xs text-spire-text-tertiary">
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
        <div className="flex items-center justify-end">
          {status?.game_found && !status.game_running && (
            <button
              onClick={allInstalled ? onComplete : handleInstall}
              disabled={installing}
              className="rounded-lg bg-spire-gold px-6 py-2 text-sm font-medium text-spire-base hover:bg-spire-gold-light transition-colors disabled:opacity-50"
            >
              {installing
                ? "Installing..."
                : allInstalled
                  ? "Continue to App"
                  : needsUpdate
                    ? "Update & Continue"
                    : "Install & Continue"}
            </button>
          )}
        </div>

        {!status?.game_found && (
          <p className="text-xs text-spire-text-muted text-center">
            STS2 Replay requires Slay the Spire 2 installed via Steam.
          </p>
        )}
      </div>
    </div>
  );
}
