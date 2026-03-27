"use client";

import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import type { Run, Choice } from "@/lib/supabase/helpers";
import { cn } from "@/lib/cn";

const supabase = createClient();

async function fetchRuns(): Promise<(Run & { choices: Choice[] })[]> {
  const { data: runs, error } = await supabase
    .from("runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  if (!runs || runs.length === 0) return [];

  // Fetch choices for all runs
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
  const { data: runs, isLoading, error } = useSWR("runs-history", fetchRuns, {
    revalidateOnFocus: false,
  });

  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a
              href="/"
              className="text-sm font-semibold text-zinc-100 tracking-tight hover:text-zinc-300 transition-colors"
            >
              STS2
            </a>
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
              <span className="text-xs text-zinc-600">
                {runs.length} runs recorded
              </span>
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
              <RunCard key={run.id} run={run} choices={run.choices} />
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
}: {
  run: Run;
  choices: Choice[];
}) {
  const outcome =
    run.victory === true
      ? "Victory"
      : run.victory === false
        ? "Defeat"
        : run.ended_at
          ? "Quit"
          : "In Progress";

  const outcomeColor =
    run.victory === true
      ? "text-emerald-400"
      : run.victory === false
        ? "text-red-400"
        : "text-zinc-500";

  const cardPicks = choices.filter(
    (c) => c.choice_type === "card_reward" && c.chosen_item_id
  );
  const skips = choices.filter((c) => c.choice_type === "skip");
  const shopPurchases = choices.filter(
    (c) => c.choice_type === "shop_purchase"
  );

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
          <span className={cn("text-sm font-medium", outcomeColor)}>
            {outcome}
          </span>
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
        </div>
      </div>

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
