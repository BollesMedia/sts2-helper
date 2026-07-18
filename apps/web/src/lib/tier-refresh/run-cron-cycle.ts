import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@sts2/shared/types/database.types";
import { NextResponse } from "next/server";
import { resolveAdapter } from "@sts2/shared/tier-sources";
import { runSourceRefresh } from "./run-source-refresh";

/**
 * Wall-clock budget for the whole loop, below the 300s function `maxDuration`.
 * When exceeded we stop dispatching and let the remaining due sources roll to
 * the next run (their `next_refresh_at` is untouched, so they stay due).
 */
const OVERALL_BUDGET_MS = 270_000;

/**
 * One cron cycle: load every due source, run each through `runSourceRefresh`
 * with `deferMvRefresh: true`, then refresh the community-consensus MV exactly
 * once at the end (only if something changed) to avoid a per-source lock storm.
 *
 * "Due" = `auto_refresh_enabled && !dormant && next_refresh_at <= now`, further
 * filtered to sources whose resolved adapter `supportsAutoRefresh`. Each source
 * does its own backoff + audit bookkeeping inside `runSourceRefresh`; this
 * layer owns the loop, the budget break, and the single MV refresh.
 */
export async function runCronCycle(
  supabase: SupabaseClient<Database>,
): Promise<Response> {
  const runStartedAt = new Date().toISOString();
  const startMs = Date.now();

  // Load due sources, ordered by id for a stable, deterministic dispatch order.
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from("tier_list_sources")
    .select("*")
    .eq("auto_refresh_enabled", true)
    .eq("dormant", false)
    .lte("next_refresh_at", nowIso)
    .order("id", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load due sources", detail: error.message },
      { status: 500 },
    );
  }

  // Filter to sources with a resolvable adapter that supports auto-refresh.
  const sources = (due ?? []).filter((source) => {
    if (!source.source_url) return false;
    const adapter = resolveAdapter(source.source_url);
    return adapter?.supportsAutoRefresh === true;
  });

  const perSource: Array<{ sourceId: string; status: string; reason?: string }> =
    [];
  let sourcesApplied = 0;
  let sourcesQueued = 0;
  let sourcesFailed = 0;
  let anyChanged = false;

  for (const source of sources) {
    // Budget exhausted; leave the rest due so they retry on the next run.
    if (Date.now() - startMs > OVERALL_BUDGET_MS) break;

    const result = await runSourceRefresh(supabase, source, {
      trigger: "cron",
      deferMvRefresh: true,
    });
    perSource.push({
      sourceId: source.id,
      status: result.status,
      reason: result.reason,
    });

    if (result.status === "applied" || result.status === "partial") {
      sourcesApplied++;
      anyChanged = true;
    } else if (result.status === "queued") {
      sourcesQueued++;
    } else {
      sourcesFailed++;
    }
  }

  // Single MV refresh at the end, only if a section was actually applied.
  let refreshWarning: string | null = null;
  if (anyChanged) {
    const { error: rpcErr } = await supabase.rpc(
      "refresh_community_tier_consensus",
    );
    if (rpcErr) refreshWarning = rpcErr.message;
  }

  return NextResponse.json({
    runStartedAt,
    runFinishedAt: new Date().toISOString(),
    sourcesAttempted: sources.length,
    sourcesApplied,
    sourcesQueued,
    sourcesFailed,
    refreshWarning,
    perSource,
  });
}
