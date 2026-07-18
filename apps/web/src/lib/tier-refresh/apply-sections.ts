import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeTier,
  type ScaleType,
} from "@sts2/shared/evaluation/tier-normalize";
import type { Database, Json } from "@sts2/shared/types/database.types";

type TierListInsert = Database["public"]["Tables"]["tier_lists"]["Insert"];
type TierListEntryInsert =
  Database["public"]["Tables"]["tier_list_entries"]["Insert"];

export interface ApplySectionInput {
  sourceId: string;
  list: {
    character: string | null;
    /** Nullable to match the confirm route's payload schema. */
    game_version: string | null;
    published_at: string;
  };
  entries: Array<{
    card_id: string;
    raw_tier: string;
    note?: string | null;
    extraction_confidence?: number | null;
  }>;
  imageUrl: string | null;
  ingestionMethod: "vision_llm" | "scraped" | "manual_confirm";
  /** When true, insert as a pending review draft instead of an active row. */
  queue?: boolean;
  gateFailureReasons?: unknown;
  /**
   * Scale config used to normalize raw tiers. Mirrors the confirm route's
   * `normSource` — the source's scale type plus its optional letter→number map.
   */
  scaleType: ScaleType;
  scaleConfig?: { map?: Record<string, number> } | null;
}

export interface ApplySectionResult {
  listId: string;
  entryCount: number;
}

/**
 * Insert one tier-list section and its (deduped) entries.
 *
 * Lifted verbatim out of `/api/admin/tier-lists/confirm/route.ts` so the cron
 * auto-refresh orchestrator (AR-8) can reuse the exact same apply logic. Two
 * branches:
 *
 * - **active** (`queue !== true`): deactivate the prior active list for the same
 *   `(sourceId, game_version, character)` scope, then insert the new row as
 *   `is_active: true, review_status: 'none'`.
 * - **queue** (`queue === true`): deactivate nothing; insert as
 *   `is_active: false, review_status: 'pending'` carrying the gate failure
 *   reasons for later admin review.
 *
 * Supabase errors are NOT swallowed — they propagate (thrown) so the caller can
 * map them (the confirm route turns a 23505 unique-violation into a 409).
 */
export async function applySection(
  supabase: SupabaseClient<Database>,
  input: ApplySectionInput,
): Promise<ApplySectionResult> {
  const { sourceId, list, entries, imageUrl, ingestionMethod } = input;
  const queue = input.queue === true;

  const normSource = {
    scale_type: input.scaleType,
    scale_config: input.scaleConfig ?? null,
  };

  // Active path only: mark prior active lists inactive for the SAME
  // (source, game_version, character) scope. Deactivating across versions would
  // hide legitimate historical snapshots (e.g. a v0.3.5 list when uploading a
  // v0.4.0 list).
  if (!queue) {
    let q = supabase
      .from("tier_lists")
      .update({ is_active: false })
      .eq("source_id", sourceId)
      .eq("is_active", true);
    q = list.game_version === null
      ? q.is("game_version", null)
      : q.eq("game_version", list.game_version);
    q = list.character === null
      ? q.is("character", null)
      : q.eq("character", list.character);
    const { error: deactivateError } = await q;
    if (deactivateError) throw deactivateError;
  }

  // Insert new tier_lists row. Active rows are live (`review_status: 'none'`);
  // queued rows are pending review and inactive, carrying the gate failures.
  const insertRow: TierListInsert = {
    source_id: sourceId,
    game_version: list.game_version,
    published_at: list.published_at,
    character: list.character,
    source_image_url: imageUrl,
    ingestion_method: ingestionMethod,
    entry_count: entries.length,
    is_active: !queue,
    review_status: queue ? "pending" : "none",
    gate_failure_reasons: queue
      ? ((input.gateFailureReasons ?? null) as Json | null)
      : null,
  };

  const { data: newList, error: listError } = await supabase
    .from("tier_lists")
    .insert(insertRow)
    .select("id")
    .single();

  if (listError || !newList) {
    // Propagate so the caller decides (confirm route maps 23505 → 409).
    throw listError ?? new Error("List insert returned no row");
  }

  // Normalize tiers, dedupe by card_id (scoped to this section — two sections
  // for different characters can both have the same card_id without colliding).
  // When a card appears multiple times within the same section, keep the entry
  // with the highest extraction_confidence — ties go to the first seen.
  const byCardId = new Map<string, TierListEntryInsert>();
  const duplicates: string[] = [];

  for (const e of entries) {
    const { normalizedTier } = normalizeTier(e.raw_tier, normSource);
    const row: TierListEntryInsert = {
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
    if (
      (row.extraction_confidence ?? 0) > (existing.extraction_confidence ?? 0)
    ) {
      byCardId.set(e.card_id, row);
    }
  }
  const entryRows = Array.from(byCardId.values());

  if (duplicates.length > 0) {
    console.warn(
      "[applySection] Collapsed duplicate card_ids (kept highest confidence):",
      duplicates,
    );
  }

  const { error: entriesError } = await supabase
    .from("tier_list_entries")
    .insert(entryRows);
  if (entriesError) throw entriesError;

  // Update entry_count to reflect the post-dedup count.
  if (duplicates.length > 0) {
    await supabase
      .from("tier_lists")
      .update({ entry_count: entryRows.length })
      .eq("id", newList.id);
  }

  return { listId: newList.id, entryCount: entryRows.length };
}
