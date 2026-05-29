import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-admin-auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Feeds the latest ~10 refresh-audit rows across all sources (or filtered by
 * ?sourceId=), newest first. Used by the admin dashboard's "Recent refresh
 * activity" panel to show when sources last refreshed and their outcomes.
 */
export const GET = withAdmin(async (request) => {
  const supabase = createServiceClient();
  const sourceId = new URL(request.url).searchParams.get("sourceId");

  let query = supabase
    .from("tier_list_refresh_logs")
    .select(
      `id,
       source_id,
       started_at,
       finished_at,
       status,
       trigger,
       sections_attempted,
       sections_applied,
       sections_queued,
       error_detail,
       source:tier_list_sources!inner(
         id,
         author
       )`,
    )
    .order("started_at", { ascending: false })
    .limit(10);

  if (sourceId) {
    query = query.eq("source_id", sourceId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[Refresh Logs Feed] Failed:", error);
    return NextResponse.json(
      { error: "Failed to load refresh logs", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ logs: data ?? [] });
});
