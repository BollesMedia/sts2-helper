import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api-admin-auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  normalizeTier,
  type ScaleType,
} from "@sts2/shared/evaluation/tier-normalize";
import type { Json } from "@sts2/shared/types/database.types";

const confirmSchema = z.object({
  imageUrl: z.string().url(),
  source: z.object({
    id: z.string(),
    author: z.string(),
    source_type: z.enum([
      "image",
      "spreadsheet",
      "website",
      "reddit",
      "youtube",
    ]),
    source_url: z.string().url().nullable().optional(),
    trust_weight: z.number().min(0).max(2).default(1.0),
    scale_type: z.enum([
      "letter_6",
      "letter_5",
      "numeric_10",
      "numeric_5",
      "binary",
    ]),
    scale_config: z.record(z.string(), z.unknown()).nullable().optional(),
    notes: z.string().nullable().optional(),
  }),
  list: z.object({
    game_version: z.string().nullable(),
    published_at: z.string(),
    character: z.string().nullable(),
  }),
  entries: z.array(
    z.object({
      card_id: z.string(),
      raw_tier: z.string(),
      note: z.string().nullable().optional(),
      extraction_confidence: z.number().min(0).max(1).nullable().optional(),
    }),
  ),
});

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", detail: parsed.error.format() },
      { status: 400 },
    );
  }
  const { imageUrl, source, list, entries } = parsed.data;

  const supabase = createServiceClient();

  // 1. Upsert source
  const { error: sourceError } = await supabase
    .from("tier_list_sources")
    .upsert(
      {
        id: source.id,
        author: source.author,
        source_type: source.source_type,
        source_url: source.source_url ?? null,
        trust_weight: source.trust_weight,
        scale_type: source.scale_type,
        scale_config: (source.scale_config ?? null) as Json | null,
        notes: source.notes ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  if (sourceError) {
    console.error("[Tier Lists Confirm] Source upsert failed:", sourceError);
    return NextResponse.json({ error: "Source upsert failed" }, { status: 500 });
  }

  // 2. Mark prior active lists inactive for the SAME (source, game_version, character)
  // scope only. Deactivating across versions would hide legitimate historical
  // snapshots (e.g. a v0.3.5 list when uploading a v0.4.0 list).
  //
  // NOTE: steps 2–5 are NOT wrapped in a transaction. If step 4 fails, step 3
  // leaves an orphan tier_lists row with entry_count > 0 but no entries, and
  // step 2 has already deactivated the prior list. Monitor logs for partial
  // failures and clean up manually. Moving to a single RPC is a follow-up.
  {
    let q = supabase
      .from("tier_lists")
      .update({ is_active: false })
      .eq("source_id", source.id)
      .eq("is_active", true);
    q = list.game_version === null
      ? q.is("game_version", null)
      : q.eq("game_version", list.game_version);
    q = list.character === null
      ? q.is("character", null)
      : q.eq("character", list.character);
    const { error: deactivateError } = await q;
    if (deactivateError) {
      console.error("[Tier Lists Confirm] Deactivation failed:", deactivateError);
      return NextResponse.json(
        { error: "Failed to deactivate prior lists", detail: deactivateError.message },
        { status: 500 },
      );
    }
  }

  // 3. Insert new tier_lists row
  const { data: newList, error: listError } = await supabase
    .from("tier_lists")
    .insert({
      source_id: source.id,
      game_version: list.game_version,
      published_at: list.published_at,
      character: list.character,
      is_active: true,
      source_image_url: imageUrl,
      ingestion_method: "vision_llm",
      entry_count: entries.length,
    })
    .select("id")
    .single();

  if (listError || !newList) {
    console.error("[Tier Lists Confirm] List insert failed:", listError);
    // Postgres unique_violation — same (source_id, game_version, published_at, character)
    // tuple already exists. Tell the admin how to fix it.
    if (listError && (listError as { code?: string }).code === "23505") {
      return NextResponse.json(
        {
          error: "Tier list already exists for this source, version, date, and character. Change the published_at date or use a different source ID to create a new snapshot.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "List insert failed" }, { status: 500 });
  }

  // 4. Normalize tiers, dedupe by card_id (fuzzy client-side matching can
  // collapse variants like "Pacts End" + "Pact's End" to the same card_id),
  // and insert entries. When a card appears multiple times, keep the entry
  // with the highest extraction_confidence — ties go to the first seen.
  const normSource = {
    scale_type: source.scale_type as ScaleType,
    scale_config: (source.scale_config ?? null) as {
      map?: Record<string, number>;
    } | null,
  };

  type EntryRow = {
    tier_list_id: string;
    card_id: string;
    raw_tier: string;
    normalized_tier: number;
    note: string | null;
    extraction_confidence: number | null;
  };
  const byCardId = new Map<string, EntryRow>();
  const duplicates: string[] = [];

  for (const e of entries) {
    const { normalizedTier } = normalizeTier(e.raw_tier, normSource);
    const row: EntryRow = {
      tier_list_id: newList.id,
      card_id: e.card_id,
      raw_tier: e.raw_tier,
      normalized_tier: normalizedTier,
      note: e.note ?? null,
      extraction_confidence: e.extraction_confidence ?? null,
    };
    const existing = byCardId.get(e.card_id);
    if (!existing) {
      byCardId.set(e.card_id, row);
      continue;
    }
    duplicates.push(e.card_id);
    if ((row.extraction_confidence ?? 0) > (existing.extraction_confidence ?? 0)) {
      byCardId.set(e.card_id, row);
    }
  }
  const entryRows = Array.from(byCardId.values());

  if (duplicates.length > 0) {
    console.warn(
      "[Tier Lists Confirm] Collapsed duplicate card_ids (kept highest confidence):",
      duplicates,
    );
  }

  const { error: entriesError } = await supabase
    .from("tier_list_entries")
    .insert(entryRows);
  if (entriesError) {
    console.error("[Tier Lists Confirm] Entries insert failed:", entriesError);
    return NextResponse.json(
      { error: "Entries insert failed" },
      { status: 500 },
    );
  }

  // Update entry_count on the list to reflect post-dedup count
  if (duplicates.length > 0) {
    await supabase
      .from("tier_lists")
      .update({ entry_count: entryRows.length })
      .eq("id", newList.id);
  }

  // 5. Refresh materialized view (best-effort). The RPC uses REFRESH MATERIALIZED
  // VIEW CONCURRENTLY which requires an exclusive lock — concurrent admin
  // submissions can collide. Surface the error to the client so the UI can
  // prompt a retry rather than silently serving stale consensus.
  //
  // NOTE: refresh_community_tier_consensus is defined in migration 024 but not
  // yet reflected in the generated types. Cast to any to bypass the type-level
  // restriction until types are regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: refreshError } = await (supabase as any).rpc(
    "refresh_community_tier_consensus",
  );
  let refreshWarning: string | null = null;
  if (refreshError) {
    refreshWarning = refreshError.message ?? "Refresh failed";
    console.warn(
      "[Tier Lists Confirm] MV refresh failed (data saved, admin can retry):",
      refreshError,
    );
  }

  return NextResponse.json({
    success: true,
    tier_list_id: newList.id,
    entry_count: entryRows.length,
    refreshWarning,
  });
}
