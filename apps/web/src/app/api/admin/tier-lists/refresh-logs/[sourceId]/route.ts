import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-admin-auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Per-source refresh history: returns the latest ~20 audit rows for a specific
 * source, newest first. Used by the per-source history view to show detailed
 * refresh timeline and outcomes.
 */
export const GET = withAdmin(async (
  _request,
  _auth,
  { params }: { params: Promise<{ sourceId: string }> },
) => {
  const { sourceId } = await params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("tier_list_refresh_logs")
    .select("*")
    .eq("source_id", sourceId)
    .order("started_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[Refresh Logs History]", sourceId, "Failed:", error);
    return NextResponse.json(
      { error: "Failed to load history", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ logs: data ?? [] });
});
