import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-admin-auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Accept a pending-review tier list draft (created by the auto-refresh quality
 * gate when a scrape couldn't be applied automatically). Accepting promotes the
 * draft to the live, active snapshot for its `(source_id, game_version,
 * character)` scope.
 *
 * The `id` param is a `tier_lists` row id (uuid). Steps:
 *  1. Load the row; 404 if missing, 409 if it isn't actually pending.
 *  2. Deactivate the currently-active row(s) for the same scope (null-aware on
 *     game_version/character, mirroring `applySection`'s active path).
 *  3. Promote the draft: `is_active: true, review_status: 'none'`.
 *  4. Refresh the consensus MV (best-effort — surfaced as `refreshWarning`).
 */
export const POST = withAdmin(async (
  _request,
  _auth,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const supabase = createServiceClient();

  const { data: row, error: lookupError } = await supabase
    .from("tier_lists")
    .select("id, source_id, game_version, character, review_status")
    .eq("id", id)
    .single();

  if (lookupError || !row) {
    return NextResponse.json({ error: "Tier list not found" }, { status: 404 });
  }

  if (row.review_status !== "pending") {
    return NextResponse.json({ error: "Not a pending row" }, { status: 409 });
  }

  // Deactivate the prior active list(s) for the SAME scope. Scoping is
  // null-aware (`.is` vs `.eq`) so we don't touch snapshots for other
  // versions/characters — same pattern as `applySection`.
  let deactivate = supabase
    .from("tier_lists")
    .update({ is_active: false })
    .eq("source_id", row.source_id)
    .eq("is_active", true);
  deactivate =
    row.game_version === null
      ? deactivate.is("game_version", null)
      : deactivate.eq("game_version", row.game_version);
  deactivate =
    row.character === null
      ? deactivate.is("character", null)
      : deactivate.eq("character", row.character);
  const { error: deactivateError } = await deactivate;
  if (deactivateError) {
    console.error("[Accept Pending] Deactivate failed:", deactivateError);
    return NextResponse.json(
      { error: "Deactivate failed", detail: deactivateError.message },
      { status: 500 },
    );
  }

  // Promote the pending draft to the live snapshot.
  const { error: promoteError } = await supabase
    .from("tier_lists")
    .update({ is_active: true, review_status: "none" })
    .eq("id", id);
  if (promoteError) {
    console.error("[Accept Pending] Promote failed:", promoteError);
    return NextResponse.json(
      { error: "Promote failed", detail: promoteError.message },
      { status: 500 },
    );
  }

  // Refresh the consensus MV. Best-effort — surface a warning but don't fail
  // the accept (the active flag is already flipped correctly).
  const { error: refreshError } = await supabase.rpc(
    "refresh_community_tier_consensus",
  );
  let refreshWarning: string | null = null;
  if (refreshError) {
    refreshWarning = refreshError.message ?? "Refresh failed";
    console.warn(
      "[Accept Pending] MV refresh failed (data saved, retry later):",
      refreshError,
    );
  }

  return NextResponse.json({ success: true, refreshWarning });
});
