import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-admin-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { runSourceRefresh } from "@/lib/tier-refresh/run-source-refresh";

/**
 * Manual "Refresh now" — runs the refresh pipeline for a SINGLE source on
 * admin demand. Unlike the cron loop this bypasses the due/dormant schedule
 * checks (an explicit click is an override) and refreshes the consensus MV
 * inline (`deferMvRefresh: false`) so the admin sees updated ratings right
 * away rather than waiting for the next cron MV refresh.
 */
export const maxDuration = 300; // a single source refresh fetches + hashes images

export const POST = withAdmin(async (
  _request,
  _auth,
  { params }: { params: Promise<{ sourceId: string }> },
) => {
  const { sourceId } = await params;
  const supabase = createServiceClient();

  const { data: source, error } = await supabase
    .from("tier_list_sources")
    .select("*")
    .eq("id", sourceId)
    .single();

  if (error || !source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  const result = await runSourceRefresh(supabase, source, {
    trigger: "manual",
    deferMvRefresh: false,
  });

  return NextResponse.json(result);
});
