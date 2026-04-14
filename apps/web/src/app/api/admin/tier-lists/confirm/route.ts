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

  // 2. Mark prior active lists inactive for same source/character scope
  await supabase
    .from("tier_lists")
    .update({ is_active: false })
    .eq("source_id", source.id)
    .eq("is_active", true)
    .filter(
      "character",
      list.character === null ? "is" : "eq",
      list.character,
    );

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
    return NextResponse.json({ error: "List insert failed" }, { status: 500 });
  }

  // 4. Normalize tiers and insert entries
  const normSource = {
    scale_type: source.scale_type as ScaleType,
    scale_config: (source.scale_config ?? null) as {
      map?: Record<string, number>;
    } | null,
  };
  const entryRows = entries.map((e) => {
    const { normalizedTier } = normalizeTier(e.raw_tier, normSource);
    return {
      tier_list_id: newList.id,
      card_id: e.card_id,
      raw_tier: e.raw_tier,
      normalized_tier: normalizedTier,
      note: e.note ?? null,
      extraction_confidence: e.extraction_confidence ?? null,
    };
  });

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

  // 5. Refresh materialized view (best-effort)
  // NOTE: refresh_community_tier_consensus is defined in migration 024 but not
  // yet reflected in the generated types. Cast to any to bypass the type-level
  // restriction until types are regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: refreshError } = await (supabase as any).rpc(
    "refresh_community_tier_consensus",
  );
  if (refreshError) {
    console.warn(
      "[Tier Lists Confirm] MV refresh failed (data saved, admin can retry):",
      refreshError,
    );
  }

  return NextResponse.json({
    success: true,
    tier_list_id: newList.id,
    entry_count: entryRows.length,
  });
}
