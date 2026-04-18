#!/usr/bin/env tsx
/**
 * Map coach backtest harness.
 *
 * Pulls historical map-type choice rows, reconstructs inputs, runs the new
 * enrichment + eval, and reports bucket counts:
 *   - v2_agrees_with_user   (new recommendation == user's actual choice)
 *   - v2_agrees_with_old    (new recommendation == old recommendation)
 *   - v2_differs_from_both  (new disagrees with both)
 *
 * Reads:
 *   - Supabase URL + service role key from .env.local
 *
 * Usage:
 *   pnpm tsx apps/web/scripts/map-coach-backtest.ts --character=ironclad --ascension=10
 *
 * Output:
 *   Table written to apps/web/scripts/backtest-report-<iso>.md
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    character: { type: "string", default: "ironclad" },
    ascension: { type: "string", default: "10" },
    limit: { type: "string", default: "500" },
  },
});

const envPath = ".env.local";
const env = Object.fromEntries(
  readFileSync(envPath, "utf-8")
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

async function main() {
  const { data: rows, error } = await supabase
    .from("choices")
    .select("*, runs!inner(character, ascension_level, victory, final_floor)")
    .eq("choice_type", "map")
    .eq("runs.character", values.character!)
    .eq("runs.ascension_level", Number(values.ascension!))
    .limit(Number(values.limit!));
  if (error) throw error;
  if (!rows) {
    console.log("No rows found.");
    return;
  }

  const buckets = {
    v2_agrees_with_user: 0,
    v2_agrees_with_old: 0,
    v2_differs_from_both: 0,
  };
  let wonOfUserAgree = 0;
  let wonOfOldAgree = 0;
  let wonOfDiffers = 0;

  for (const row of rows) {
    // TODO — phase 1 stub: calling the new eval end-to-end requires
    // rebuilding game state from game_context + rankings_snapshot.
    // For a first pass, compare only old vs actual:
    const oldAgreesWithUser = row.recommended_item_id === row.chosen_item_id;
    const won = row.runs.victory;

    // Placeholder classification pending full eval-replay implementation:
    if (oldAgreesWithUser) {
      buckets.v2_agrees_with_old++;
      if (won) wonOfOldAgree++;
    } else {
      buckets.v2_differs_from_both++;
      if (won) wonOfDiffers++;
    }
  }

  const total = rows.length;
  const report = [
    `# Map Coach Backtest — ${new Date().toISOString()}`,
    ``,
    `Character: ${values.character} | Ascension: ${values.ascension} | Rows: ${total}`,
    ``,
    `| Bucket | Count | % | Wins | Win rate |`,
    `|---|---|---|---|---|`,
    ...Object.entries(buckets).map(([k, v]) => {
      const wins =
        k === "v2_agrees_with_user"
          ? wonOfUserAgree
          : k === "v2_agrees_with_old"
            ? wonOfOldAgree
            : wonOfDiffers;
      const pct = ((v / total) * 100).toFixed(1);
      const wr = v ? ((wins / v) * 100).toFixed(1) : "—";
      return `| ${k} | ${v} | ${pct}% | ${wins} | ${wr}% |`;
    }),
    ``,
    `## Notes`,
    ``,
    `Phase 1 stub: this script does NOT yet re-run the new eval against`,
    `historical game state — it only buckets by old-vs-actual. Extending to`,
    `call the new eval requires a full RunStateInputs reconstruction from`,
    `\`game_context\` + \`rankings_snapshot\`, which is a follow-up.`,
  ].join("\n");

  const out = `apps/web/scripts/backtest-report-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
  writeFileSync(out, report);
  console.log(`Report written: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
