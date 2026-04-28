#!/usr/bin/env tsx
/**
 * Map coach backtest harness.
 *
 * For each historical map-type choice row, re-runs the deterministic
 * scorer (`scorePaths`) against the persisted compliance bundle and
 * compares the v2 winner against:
 *   - the user's actual pick (`chosen_item_id`)
 *   - the v1 recommendation logged at the time (`recommended_item_id`)
 *
 * Buckets, per-bucket win rates, and a "replayability" rate are emitted
 * to a markdown report under `apps/web/scripts/`.
 *
 * Reads:
 *   - Supabase URL + service role key from `.env.local`
 *
 * Usage:
 *   pnpm tsx apps/web/scripts/map-coach-backtest.ts --character=ironclad --ascension=10
 *
 * ## Replayability
 *
 * Pre-#79 rows persisted only the `RunState` in `run_state_snapshot`; the
 * candidate `enrichedPaths` were not captured, so v2 cannot be re-run on
 * those rows — they bucket as `unreplayable_legacy`. Post-#79 rows
 * persist the full `MapComplianceInputs`, which carries `enrichedPaths`.
 *
 * Detection: row has `run_state_snapshot.enrichedPaths` array → replayable.
 *
 * ## Telemetry note (legacy data shape) — issue #87
 *
 * `choices` rows written before 2026-04-18 have
 * `rankings_snapshot->'compliance'` === NULL. Aggregations over the
 * compliance block must COALESCE or scope by `created_at >= '2026-04-18'`.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { scorePaths, type ScoredPath } from "@sts2/shared/evaluation/map/score-paths";
import type { EnrichedPath } from "@sts2/shared/evaluation/map/enrich-paths";
import type { RunState } from "@sts2/shared/evaluation/map/run-state";

const { values } = parseArgs({
  options: {
    character: { type: "string", default: "ironclad" },
    ascension: { type: "string", default: "10" },
    limit: { type: "string", default: "500" },
  },
});

const env = Object.fromEntries(
  readFileSync(".env.local", "utf-8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("=", 2) as [string, string]),
);

const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

interface BackfillBuckets {
  v2_agrees_with_user: number;
  v2_agrees_with_old: number;
  v2_differs_from_both: number;
}

interface ChoiceRow {
  choice_type: string;
  recommended_item_id: string | null;
  chosen_item_id: string | null;
  rankings_snapshot: unknown;
  run_state_snapshot: unknown;
  runs: { character: string; ascension_level: number; victory: boolean | null };
}

/**
 * The persisted compliance bundle since #79. Older rows persisted just
 * `RunState` (no `enrichedPaths` key) — we use that absence to skip
 * replay for legacy rows.
 */
interface PersistedCompliance {
  enrichedPaths?: EnrichedPath[];
  runState?: RunState;
  cardRemovalCost?: number | null;
}

function isReplayable(
  snapshot: unknown,
): snapshot is { enrichedPaths: EnrichedPath[]; runState: RunState; cardRemovalCost?: number | null } {
  if (!snapshot || typeof snapshot !== "object") return false;
  const s = snapshot as PersistedCompliance;
  return Array.isArray(s.enrichedPaths) && s.enrichedPaths.length > 0 && !!s.runState;
}

/**
 * Convert a ScoredPath winner to its `col,row` node-id for comparison
 * with `recommended_item_id` / `chosen_item_id`. The desktop encodes
 * map node picks as `col,row` (see `apps/desktop/src/features/map/`
 * `mapListeners.ts`, `mapOutcome.recommendedNode` formatting). The
 * first node of the winning path is the immediate next-pick.
 */
function winnerToNodeId(winner: ScoredPath): string | null {
  const first = winner.nodes[0];
  return first?.nodeId ?? null;
}

async function main() {
  const character = values.character!;
  const ascension = Number(values.ascension!);
  const limit = Number(values.limit!);

  const { data: rows, error } = await supabase
    .from("choices")
    .select(
      "choice_type, recommended_item_id, chosen_item_id, rankings_snapshot, run_state_snapshot, runs!inner(character, ascension_level, victory, final_floor)",
    )
    .eq("choice_type", "map")
    .eq("runs.character", character)
    .eq("runs.ascension_level", ascension)
    .limit(limit);
  if (error) throw error;
  const typedRows = (rows ?? []) as unknown as ChoiceRow[];
  if (typedRows.length === 0) {
    console.log("No rows found.");
    return;
  }

  const buckets: BackfillBuckets = {
    v2_agrees_with_user: 0,
    v2_agrees_with_old: 0,
    v2_differs_from_both: 0,
  };
  const wins: BackfillBuckets = {
    v2_agrees_with_user: 0,
    v2_agrees_with_old: 0,
    v2_differs_from_both: 0,
  };

  let replayable = 0;
  let unreplayableLegacy = 0;
  let unreplayableMissingId = 0;
  let scorerError = 0;

  for (const row of typedRows) {
    if (!row.chosen_item_id) {
      unreplayableMissingId++;
      continue;
    }

    if (!isReplayable(row.run_state_snapshot)) {
      unreplayableLegacy++;
      continue;
    }

    const snap = row.run_state_snapshot;
    let v2Recommendation: string | null = null;
    try {
      const scored = scorePaths(snap.enrichedPaths, snap.runState, {
        cardRemovalCost: snap.cardRemovalCost ?? 75,
      });
      const winner = scored[0];
      v2Recommendation = winner ? winnerToNodeId(winner) : null;
    } catch (err) {
      scorerError++;
      console.warn(
        `Scorer threw on row (chosen=${row.chosen_item_id}, old=${row.recommended_item_id}):`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    if (!v2Recommendation) {
      scorerError++;
      continue;
    }

    replayable++;
    const won = row.runs.victory === true;
    const v2EqUser = v2Recommendation === row.chosen_item_id;
    const v2EqOld = v2Recommendation === row.recommended_item_id;

    if (v2EqUser) {
      buckets.v2_agrees_with_user++;
      if (won) wins.v2_agrees_with_user++;
    } else if (v2EqOld) {
      buckets.v2_agrees_with_old++;
      if (won) wins.v2_agrees_with_old++;
    } else {
      buckets.v2_differs_from_both++;
      if (won) wins.v2_differs_from_both++;
    }
  }

  const totalRows = typedRows.length;
  const replayPct = ((replayable / totalRows) * 100).toFixed(1);

  const report = [
    `# Map Coach Backtest — ${new Date().toISOString()}`,
    ``,
    `Character: ${character} | Ascension: ${ascension} | Rows pulled: ${totalRows}`,
    ``,
    `## Replayability`,
    ``,
    `| Status | Count | % |`,
    `|---|---|---|`,
    `| Replayed (v2 score ran) | ${replayable} | ${replayPct}% |`,
    `| Unreplayable — legacy persistence (no \`enrichedPaths\`) | ${unreplayableLegacy} | ${((unreplayableLegacy / totalRows) * 100).toFixed(1)}% |`,
    `| Unreplayable — missing \`chosen_item_id\` | ${unreplayableMissingId} | ${((unreplayableMissingId / totalRows) * 100).toFixed(1)}% |`,
    `| Scorer error / null winner | ${scorerError} | ${((scorerError / totalRows) * 100).toFixed(1)}% |`,
    ``,
    `## v2 buckets (over replayed rows)`,
    ``,
    `| Bucket | Count | % | Wins | Win rate |`,
    `|---|---|---|---|---|`,
    ...(Object.entries(buckets) as [keyof BackfillBuckets, number][]).map(([k, v]) => {
      const w = wins[k];
      const pct = replayable ? ((v / replayable) * 100).toFixed(1) : "—";
      const wr = v ? ((w / v) * 100).toFixed(1) : "—";
      return `| ${k} | ${v} | ${pct}% | ${w} | ${wr}% |`;
    }),
    ``,
    `## Notes`,
    ``,
    `- Replay calls \`scorePaths\` deterministically — no LLM round-trip.`,
    `  The narrator step (LLM-driven in production) does not affect which`,
    `  path is the winner.`,
    `- "Wins" counts use \`runs.victory === true\`; rows from active runs`,
    `  (\`victory: null\`) count as not-won.`,
    `- Pre-#79 rows persisted only \`RunState\`, not the full compliance`,
    `  bundle. Those bucket as \`unreplayable_legacy\` until enough new`,
    `  data accumulates.`,
  ].join("\n");

  const out = `apps/web/scripts/backtest-report-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
  writeFileSync(out, report);
  console.log(`Report written: ${out}`);
  console.log(
    `Summary: ${replayable}/${totalRows} replayed (${replayPct}%); user=${buckets.v2_agrees_with_user} old=${buckets.v2_agrees_with_old} differs=${buckets.v2_differs_from_both}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
