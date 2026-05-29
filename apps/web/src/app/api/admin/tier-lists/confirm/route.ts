import { NextResponse } from "next/server";
import { z } from "zod";
import { withAdmin } from "@/lib/api-admin-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { applySection } from "@/lib/tier-refresh/apply-sections";
import type { ScaleType } from "@sts2/shared/evaluation/tier-normalize";
import type { Json } from "@sts2/shared/types/database.types";

const sectionListSchema = z.object({
  game_version: z.string().nullable(),
  published_at: z.string(),
  character: z.string().nullable(),
});

const sectionEntriesSchema = z.array(
  z.object({
    card_id: z.string(),
    raw_tier: z.string(),
    note: z.string().nullable().optional(),
    extraction_confidence: z.number().min(0).max(1).nullable().optional(),
  }),
);

const sectionSchema = z.object({
  list: sectionListSchema,
  entries: sectionEntriesSchema,
});

export const confirmSchema = z
  .object({
    imageUrl: z.string().url().nullable(),
    ingestionMethod: z
      .enum(["vision_llm", "manual_confirm", "scraped"])
      .default("vision_llm"),
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
    // New multi-section payload: sections: [{ list, entries }]
    sections: z.array(sectionSchema).optional(),
    // Legacy single-section payload (backwards-compat)
    list: sectionListSchema.optional(),
    entries: sectionEntriesSchema.optional(),
  })
  // vision_llm and manual_confirm always have a Supabase-Storage imageUrl;
  // scraped lists don't (source lives at source.source_url instead). This
  // refinement guards against a draft-tampering case where an admin could
  // edit localStorage to submit mismatched metadata.
  .refine(
    (d) => (d.ingestionMethod === "scraped" ? true : d.imageUrl !== null),
    { message: "imageUrl is required for non-scraped ingestion methods" },
  )
  // Backwards-compat: accept either sections[] or the legacy list+entries pair.
  .refine(
    (b) => Boolean(b.sections) || (Boolean(b.list) && Boolean(b.entries)),
    { message: "Must include sections[] or (list + entries)" },
  );

export const POST = withAdmin(async (request) => {
  const body = await request.json();
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", detail: parsed.error.format() },
      { status: 400 },
    );
  }
  const { imageUrl, ingestionMethod, source } = parsed.data;

  // Normalize legacy { list, entries } into sections[] so the loop is uniform.
  const sections = parsed.data.sections ?? [
    { list: parsed.data.list!, entries: parsed.data.entries! },
  ];

  const supabase = createServiceClient();

  // 1. Upsert source (once, outside the per-section loop)
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

  // 2. Per-section: applySection deactivates the prior active list, inserts the
  // new tier_lists row, dedupes, and inserts entries.
  //
  // NOTE: applySection's steps are NOT wrapped in a transaction. If the entries
  // insert fails, the new tier_lists row is left as an orphan (entry_count > 0,
  // no entries) and the prior list has already been deactivated. Monitor logs
  // for partial failures and clean up manually. Moving to a single RPC is a
  // follow-up.
  const inserted: Array<{
    sectionIndex: number;
    listId: string;
    entryCount: number;
  }> = [];

  const normSource = {
    scale_type: source.scale_type as ScaleType,
    scale_config: (source.scale_config ?? null) as {
      map?: Record<string, number>;
    } | null,
  };

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex];
    const { list, entries } = section;

    // Deactivate prior active list (same source/version/character), insert the
    // new active row, dedupe entries, and insert them — all via the shared
    // applySection helper (reused by the cron auto-refresh path). applySection
    // throws Supabase errors; map them to the existing HTTP responses here.
    try {
      const { listId, entryCount } = await applySection(supabase, {
        sourceId: source.id,
        list,
        entries,
        imageUrl,
        ingestionMethod,
        queue: false,
        scaleType: normSource.scale_type,
        scaleConfig: normSource.scale_config,
      });
      inserted.push({ sectionIndex, listId, entryCount });
    } catch (err) {
      console.error(
        `[Tier Lists Confirm] applySection failed (section ${sectionIndex}):`,
        err,
      );
      // Postgres unique_violation — same (source_id, game_version, published_at,
      // character) tuple already exists. Tell the admin how to fix it.
      if ((err as { code?: string } | null)?.code === "23505") {
        return NextResponse.json(
          {
            error:
              "Tier list already exists for this source, version, date, and character. Change the published_at date or use a different source ID to create a new snapshot.",
            sectionIndex,
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "Failed to apply section", sectionIndex },
        { status: 500 },
      );
    }
  }

  // 5. Refresh materialized view (best-effort, once after all sections are inserted).
  // The RPC uses REFRESH MATERIALIZED VIEW CONCURRENTLY which requires an exclusive
  // lock — concurrent admin submissions can collide. Surface the error to the client
  // so the UI can prompt a retry rather than silently serving stale consensus.
  const { error: refreshError } = await supabase.rpc(
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
    inserted,
    // Legacy single-section convenience fields (backwards-compat for existing callers)
    // Backwards-compat legacy single-section response. These fields reflect
    // inserted[0] only — multi-section callers should read `inserted` instead.
    tier_list_id: inserted[0]?.listId ?? null,
    entry_count: inserted[0]?.entryCount ?? 0,
    refreshWarning,
  });
});
