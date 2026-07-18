import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-admin-auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Lists every tier_lists row with its parent source metadata, newest first.
 * Used by the admin table view at /admin/tier-lists so ingestion history is
 * visible alongside the ingestion wizard.
 *
 * NOTE: intentionally returns both active and inactive snapshots. Inactive
 * rows are rendered greyed out so the admin can audit supersession without
 * losing history.
 */
export const GET = withAdmin(async () => {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("tier_lists")
    .select(
      `id,
       character,
       game_version,
       published_at,
       is_active,
       source_image_url,
       ingestion_method,
       ingested_at,
       entry_count,
       review_status,
       gate_failure_reasons,
       source:tier_list_sources!inner(
         id,
         author,
         source_type,
         source_url,
         trust_weight,
         scale_type,
         scale_config,
         auto_refresh_enabled,
         dormant,
         next_refresh_at,
         last_refresh_attempted_at,
         last_refresh_succeeded_at,
         consecutive_failures,
         consecutive_queue_only,
         last_failure_reason
       )`,
    )
    .order("ingested_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[Tier Lists List] Failed:", error);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }

  return NextResponse.json({ lists: data ?? [] });
});
