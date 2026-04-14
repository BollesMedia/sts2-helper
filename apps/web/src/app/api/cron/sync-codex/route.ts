/**
 * Cron job: sync Spire Codex game data into Supabase.
 *
 * Schedule: daily at 06:00 UTC (configured in vercel.json)
 *
 * Required env var: CRON_SECRET
 *   Vercel auto-injects this header when invoking cron routes. Set the value
 *   in your Vercel project settings under Environment Variables.
 *
 * Manual trigger:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://sts2.bollesmedia.com/api/cron/sync-codex
 *
 * Pass ?version=0.3.5 to sync under a specific version label; omit to use
 * the rolling "latest" row (default).
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runCodexSync } from "@/game-data/sync-codex";

export const maxDuration = 300; // 5 min — codex sync takes ~15s but leave headroom

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const version = new URL(request.url).searchParams.get("version") ?? "latest";

  try {
    await runCodexSync(supabase, version);
    return NextResponse.json({ success: true, version });
  } catch (err) {
    console.error("[Cron sync-codex] Failed:", err);
    return NextResponse.json(
      {
        error: "Sync failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
