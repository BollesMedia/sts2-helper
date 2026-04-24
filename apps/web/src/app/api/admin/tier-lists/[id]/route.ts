import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api-admin-auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@sts2/shared/types/database.types";

/**
 * PATCH a tier list snapshot's editable metadata. Touches both the snapshot
 * row (`tier_lists`) and its parent source row (`tier_list_sources`) since
 * the admin form mixes them — `trust_weight`, `author`, etc. live on the
 * source while `is_active`, `character`, `game_version`, `published_at`
 * are per-snapshot.
 *
 * After a successful update, refresh `community_tier_consensus` because
 * trust_weight / is_active changes mutate the aggregation.
 */
const patchSchema = z.object({
  source: z
    .object({
      author: z.string().min(1).optional(),
      source_type: z
        .enum(["image", "spreadsheet", "website", "reddit", "youtube"])
        .optional(),
      source_url: z.string().url().nullable().optional(),
      trust_weight: z.number().min(0).max(2).optional(),
      scale_type: z
        .enum(["letter_6", "letter_5", "numeric_10", "numeric_5", "binary"])
        .optional(),
      scale_config: z.record(z.string(), z.unknown()).nullable().optional(),
      notes: z.string().nullable().optional(),
    })
    .optional(),
  list: z
    .object({
      is_active: z.boolean().optional(),
      character: z.string().nullable().optional(),
      game_version: z.string().nullable().optional(),
      published_at: z.string().min(1).optional(),
    })
    .optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", detail: parsed.error.format() },
      { status: 400 },
    );
  }
  const { source: sourceUpdates, list: listUpdates } = parsed.data;

  const supabase = createServiceClient();

  // Resolve which source this snapshot belongs to so we know which row to
  // update on the source side.
  const { data: existing, error: lookupError } = await supabase
    .from("tier_lists")
    .select("id, source_id")
    .eq("id", id)
    .single();

  if (lookupError || !existing) {
    return NextResponse.json(
      { error: "Tier list not found" },
      { status: 404 },
    );
  }

  // Source-level updates apply to ALL snapshots from this source (trust_weight
  // change, scale_type bump, etc.). Done first so the eventual MV refresh
  // picks up the new values.
  if (sourceUpdates && Object.keys(sourceUpdates).length > 0) {
    const payload: Record<string, unknown> = {
      ...sourceUpdates,
      updated_at: new Date().toISOString(),
    };
    if ("scale_config" in sourceUpdates) {
      payload.scale_config = (sourceUpdates.scale_config ?? null) as Json | null;
    }
    const { error: srcError } = await supabase
      .from("tier_list_sources")
      .update(payload)
      .eq("id", existing.source_id);
    if (srcError) {
      console.error("[Tier Lists Patch] Source update failed:", srcError);
      return NextResponse.json(
        { error: "Source update failed", detail: srcError.message },
        { status: 500 },
      );
    }
  }

  if (listUpdates && Object.keys(listUpdates).length > 0) {
    const { error: listError } = await supabase
      .from("tier_lists")
      .update(listUpdates)
      .eq("id", id);
    if (listError) {
      console.error("[Tier Lists Patch] List update failed:", listError);
      return NextResponse.json(
        { error: "List update failed", detail: listError.message },
        { status: 500 },
      );
    }
  }

  // Refresh the consensus MV. Best-effort — surface a warning but don't fail
  // the patch (data is already correct in the source rows).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: refreshError } = await (supabase as any).rpc(
    "refresh_community_tier_consensus",
  );
  let refreshWarning: string | null = null;
  if (refreshError) {
    refreshWarning = refreshError.message ?? "Refresh failed";
    console.warn(
      "[Tier Lists Patch] MV refresh failed (data saved, retry later):",
      refreshError,
    );
  }

  return NextResponse.json({ success: true, refreshWarning });
}
