/**
 * Cron job: auto-refresh due community tier-list sources.
 *
 * Schedule: daily at 04:00 UTC (configured in vercel.json)
 *
 * Required env var: CRON_SECRET
 *   Vercel auto-injects this header when invoking cron routes. Set the value
 *   in your Vercel project settings under Environment Variables.
 *
 * Kill switch: set TIER_LIST_AUTO_REFRESH_DISABLED='true' to no-op the run
 * without un-scheduling the cron.
 *
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://sts2.bollesmedia.com/api/cron/refresh-tier-lists
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runCronCycle } from "@/lib/tier-refresh/run-cron-cycle";

export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.TIER_LIST_AUTO_REFRESH_DISABLED === "true") {
    return NextResponse.json({ disabled: true });
  }

  const supabase = createServiceClient();

  // Concurrency guard: row-level claim with a 15-min stale lease. Avoids pg
  // advisory locks (PgBouncer transaction pooling releases them between calls).
  const invocationId = request.headers.get("x-vercel-id") ?? crypto.randomUUID();
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: claimed } = await supabase
    .from("tier_list_refresh_runs")
    .update({ claimed_at: new Date().toISOString(), claimed_by: invocationId })
    .eq("id", "singleton")
    .or(`claimed_at.is.null,claimed_at.lt.${staleBefore}`)
    .select();

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ skipped: "run_already_in_progress" });
  }

  try {
    return await runCronCycle(supabase);
  } finally {
    await supabase
      .from("tier_list_refresh_runs")
      .update({ claimed_at: null, claimed_by: null })
      .eq("id", "singleton")
      .eq("claimed_by", invocationId);
  }
}
