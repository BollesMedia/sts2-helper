"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { createClient } from "@sts2/shared/supabase/client";
import { useAuth } from "@/features/auth/auth-provider";
import { LoginScreen } from "@/features/auth/login-screen";
import type { Run, Choice } from "@sts2/shared/supabase/helpers";
import { cn } from "@sts2/shared/lib/cn";

async function fetchRuns(): Promise<(Run & { choices: Choice[] })[]> {
  const supabase = createClient();
  const { data: runs, error } = await supabase
    .from("runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  if (!runs || runs.length === 0) return [];

  const runIds = runs.map((r) => r.run_id);
  const { data: choices } = await supabase
    .from("choices")
    .select("*")
    .in("run_id", runIds)
    .order("created_at", { ascending: true });

  return runs.map((run) => ({
    ...run,
    choices: (choices ?? []).filter((c) => c.run_id === run.run_id),
  }));
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "In progress";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function RunsPage() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen bg-background text-foreground">
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <LoginScreen />
      </div>
    );
  }

  return <RunsPageContent />;
}

function RunsPageContent() {
  const { data: runs, isLoading, error, mutate } = useSWR("runs-history", fetchRuns, {
    revalidateOnFocus: false,
  });

  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-sm font-semibold text-zinc-100 tracking-tight hover:text-zinc-300 transition-colors"
            >
              STS2
            </Link>
            <div className="h-4 w-px bg-zinc-800" />
            <span className="text-sm font-medium text-zinc-300">
              Run History
            </span>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-4xl mx-auto">
        <div className="flex flex-col gap-6">
          <div className="flex items-baseline justify-between">
            <h1 className="text-xl font-semibold text-zinc-100">Runs</h1>
            {runs && (
              <div className="flex items-center gap-3 text-xs text-zinc-600">
                <span>{runs.length} runs</span>
                <span>·</span>
                <span>{runs.filter((r) => r.victory === true).length}W</span>
                <span>{runs.filter((r) => r.victory === false).length}L</span>
              </div>
            )}
          </div>

          {isLoading && (
            <p className="text-sm text-zinc-500">Loading runs...</p>
          )}

          {error && (
            <p className="text-sm text-red-400">
              Error loading runs: {error.message}
            </p>
          )}

          {runs && runs.length === 0 && (
            <p className="text-sm text-zinc-500">
              No runs recorded yet. Start playing with the companion open.
            </p>
          )}

          <div className="space-y-3">
            {runs?.map((run) => (
              <RunCard key={run.id} run={run} choices={run.choices} onUpdate={mutate} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function RunCard({
  run,
  choices,
  onUpdate,
}: {
  run: Run;
  choices: Choice[];
  onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(run.notes ?? "");
  const [victory, setVictory] = useState(run.victory);
  const [saving, setSaving] = useState(false);

  const outcome =
    victory === true
      ? "Victory"
      : victory === false
        ? "Defeat"
        : run.ended_at
          ? "Quit"
          : "In Progress";

  const outcomeColor =
    victory === true
      ? "text-emerald-400"
      : victory === false
        ? "text-red-400"
        : "text-zinc-500";

  const cardPicks = choices.filter(
    (c) => c.choice_type === "card_reward" && c.chosen_item_id
  );
  const skips = choices.filter((c) => c.choice_type === "skip");
  const shopPurchases = choices.filter(
    (c) => c.choice_type === "shop_purchase"
  );

  const handleSave = async () => {
    setSaving(true);
    await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "end",
        runId: run.run_id,
        victory,
        notes: notes.trim() || null,
      }),
    });
    setSaving(false);
    setEditing(false);
    onUpdate();
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-zinc-200">
            {run.character}
          </span>
          {run.ascension_level != null && run.ascension_level > 0 && (
            <span className="text-xs text-zinc-500">
              A{run.ascension_level}
            </span>
          )}
          {run.game_mode === "multiplayer" && (
            <span className="rounded bg-purple-400/10 px-1.5 py-0.5 text-xs text-purple-400">
              Co-op
            </span>
          )}

          {editing ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setVictory(true)}
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                  victory === true
                    ? "bg-emerald-400/20 text-emerald-400 border border-emerald-400/40"
                    : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                )}
              >
                Victory
              </button>
              <button
                onClick={() => setVictory(false)}
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                  victory === false
                    ? "bg-red-400/20 text-red-400 border border-red-400/40"
                    : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                )}
              >
                Defeat
              </button>
              <button
                onClick={() => setVictory(null)}
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                  victory === null
                    ? "bg-zinc-700 text-zinc-300 border border-zinc-600"
                    : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                )}
              >
                Quit
              </button>
            </div>
          ) : (
            <span className={cn("text-sm font-medium", outcomeColor)}>
              {outcome}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-600">
          {run.final_floor && (
            <span>Floor {run.final_floor}</span>
          )}
          {run.started_at && (
            <span>{formatDate(run.started_at)}</span>
          )}
          {run.started_at && (
            <span>{formatDuration(run.started_at, run.ended_at)}</span>
          )}
          {editing ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400 hover:bg-blue-500/30 transition-colors"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setNotes(run.notes ?? "");
                  setVictory(run.victory);
                }}
                className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Bosses fought */}
      {run.bosses_fought && run.bosses_fought.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Bosses:</span>
          {run.bosses_fought.map((b, i) => (
            <span key={i} className="rounded bg-red-400/10 px-1.5 py-0.5 text-red-400">
              {b}
            </span>
          ))}
        </div>
      )}

      {/* Choices summary */}
      {choices.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          {cardPicks.length > 0 && (
            <span>{cardPicks.length} cards picked</span>
          )}
          {skips.length > 0 && (
            <span>{skips.length} skipped</span>
          )}
          {shopPurchases.length > 0 && (
            <span>{shopPurchases.length} shop buys</span>
          )}
        </div>
      )}

      {/* Notes */}
      {editing ? (
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What went wrong? What would you do differently?"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
          rows={2}
        />
      ) : (
        run.notes && (
          <p className="text-sm text-zinc-400 italic leading-relaxed">
            &ldquo;{run.notes}&rdquo;
          </p>
        )
      )}

      {/* Card picks detail */}
      {cardPicks.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {cardPicks.map((c) => (
            <span
              key={c.id}
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
            >
              {c.chosen_item_id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
