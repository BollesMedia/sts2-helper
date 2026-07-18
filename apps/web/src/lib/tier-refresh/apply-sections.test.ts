/**
 * @vitest-environment node
 *
 * Unit tests for the extracted `applySection` module (AR-7). `applySection`
 * was lifted verbatim out of `/api/admin/tier-lists/confirm/route.ts` so the
 * cron auto-refresh path can reuse it. These tests pin its two branches
 * (active vs. queued) and the per-section card_id dedup independent of the
 * route handler.
 *
 * Supabase is replaced with a hand-rolled chainable stub: `from()` returns a
 * builder whose `update/insert/select/eq/is/single` methods record every call
 * and resolve to `{ data, error }`. Awaiting the builder (deactivate / entries
 * insert) resolves the recorded result; the tier_lists insert chain ends in
 * `.select("id").single()` and yields the inserted row id.
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@sts2/shared/types/database.types";
import { applySection, type ApplySectionInput } from "./apply-sections";

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/**
 * Build a chainable Supabase stub. The builder is a thenable so it can be
 * awaited directly (deactivate update, entries insert) and also chained
 * (`.insert(...).select("id").single()` for the tier_lists row).
 */
function makeSupabaseStub(opts: { newListId?: string } = {}) {
  const calls: RecordedCall[] = [];
  const newListId = opts.newListId ?? "list-123";

  function builder(table: string) {
    const chain = {
      update(payload: unknown) {
        calls.push({ table, method: "update", args: [payload] });
        return chain;
      },
      insert(payload: unknown) {
        calls.push({ table, method: "insert", args: [payload] });
        return chain;
      },
      select(cols: unknown) {
        calls.push({ table, method: "select", args: [cols] });
        return chain;
      },
      eq(col: unknown, val: unknown) {
        calls.push({ table, method: "eq", args: [col, val] });
        return chain;
      },
      is(col: unknown, val: unknown) {
        calls.push({ table, method: "is", args: [col, val] });
        return chain;
      },
      single() {
        calls.push({ table, method: "single", args: [] });
        // The only `.single()` call site is the tier_lists insert.
        return Promise.resolve({ data: { id: newListId }, error: null });
      },
      // Thenable: awaiting the chain (deactivate / entries insert) resolves
      // to a no-data success.
      then(
        resolve: (v: { data: null; error: null }) => unknown,
        reject?: (e: unknown) => unknown,
      ) {
        return Promise.resolve({ data: null, error: null }).then(
          resolve,
          reject,
        );
      },
    };
    return chain;
  }

  const supabase = {
    from(table: string) {
      calls.push({ table, method: "from", args: [] });
      return builder(table);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, calls };
}

const baseInput: ApplySectionInput = {
  sourceId: "src-1",
  list: { character: "ironclad", game_version: "v1.0", published_at: "2024-01-01" },
  entries: [
    { card_id: "strike_r", raw_tier: "A" },
    { card_id: "defend_r", raw_tier: "B" },
  ],
  imageUrl: null,
  ingestionMethod: "scraped",
  scaleType: "letter_6",
};

/** Pull the payload of the first `insert` into `tier_lists`. */
function tierListInsertPayload(calls: RecordedCall[]) {
  const call = calls.find(
    (c) => c.table === "tier_lists" && c.method === "insert",
  );
  return call?.args[0] as Record<string, unknown> | undefined;
}

describe("applySection — active path (queue !== true)", () => {
  it("deactivates prior active rows, then inserts an active/none row", async () => {
    const { supabase, calls } = makeSupabaseStub({ newListId: "list-abc" });

    const result = await applySection(supabase, { ...baseInput, queue: false });

    // A deactivation update({ is_active: false }) is issued before the insert.
    const deactivate = calls.find(
      (c) => c.table === "tier_lists" && c.method === "update",
    );
    expect(deactivate).toBeDefined();
    expect(deactivate?.args[0]).toEqual({ is_active: false });
    // The deactivate happens before the insert in call order.
    const deactivateIdx = calls.indexOf(deactivate!);
    const insertIdx = calls.findIndex(
      (c) => c.table === "tier_lists" && c.method === "insert",
    );
    expect(deactivateIdx).toBeLessThan(insertIdx);

    // The deactivate is scoped to source/version/character via eq.
    const eqCols = calls
      .filter((c) => c.method === "eq")
      .map((c) => c.args[0]);
    expect(eqCols).toContain("source_id");
    expect(eqCols).toContain("is_active");
    expect(eqCols).toContain("game_version");
    expect(eqCols).toContain("character");

    // The inserted row is active with review_status 'none' and no gate failures.
    const payload = tierListInsertPayload(calls);
    expect(payload).toMatchObject({
      source_id: "src-1",
      game_version: "v1.0",
      character: "ironclad",
      is_active: true,
      review_status: "none",
      gate_failure_reasons: null,
      ingestion_method: "scraped",
    });

    expect(result).toEqual({ listId: "list-abc", entryCount: 2 });
  });

  it("uses .is() for a null-character scope on deactivation", async () => {
    const { supabase, calls } = makeSupabaseStub();

    await applySection(supabase, {
      ...baseInput,
      list: { character: null, game_version: null, published_at: "2024-01-01" },
      queue: false,
    });

    const isCols = calls.filter((c) => c.method === "is").map((c) => c.args[0]);
    expect(isCols).toContain("character");
    expect(isCols).toContain("game_version");
  });
});

describe("applySection — queue path (queue === true)", () => {
  it("does NOT deactivate and inserts a pending/inactive row with gate reasons", async () => {
    const { supabase, calls } = makeSupabaseStub();
    const gateFailureReasons = [{ gate: "min_cards", value: 3 }];

    const result = await applySection(supabase, {
      ...baseInput,
      queue: true,
      gateFailureReasons,
    });

    // No deactivation update is issued in the queue path.
    const deactivate = calls.find(
      (c) => c.table === "tier_lists" && c.method === "update",
    );
    expect(deactivate).toBeUndefined();

    // The inserted row is inactive, pending review, carrying the gate failures.
    const payload = tierListInsertPayload(calls);
    expect(payload).toMatchObject({
      is_active: false,
      review_status: "pending",
      gate_failure_reasons: gateFailureReasons,
    });

    expect(result).toEqual({ listId: "list-123", entryCount: 2 });
  });
});

describe("applySection — per-section card_id dedup", () => {
  it("keeps the highest-confidence entry for a duplicated card_id", async () => {
    const { supabase, calls } = makeSupabaseStub();

    const result = await applySection(supabase, {
      ...baseInput,
      entries: [
        { card_id: "strike_r", raw_tier: "C", extraction_confidence: 0.4 },
        { card_id: "strike_r", raw_tier: "A", extraction_confidence: 0.9 },
      ],
    });

    // Only one entry row is inserted for the duplicated card_id.
    const entriesInsert = calls.find(
      (c) => c.table === "tier_list_entries" && c.method === "insert",
    );
    const rows = entriesInsert?.args[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      card_id: "strike_r",
      raw_tier: "A",
      extraction_confidence: 0.9,
    });

    // entry_count is rewritten to the post-dedup count (1, not 2).
    const entryCountUpdate = calls.find(
      (c) =>
        c.table === "tier_lists" &&
        c.method === "update" &&
        (c.args[0] as Record<string, unknown>).entry_count !== undefined,
    );
    expect(entryCountUpdate?.args[0]).toEqual({ entry_count: 1 });

    expect(result.entryCount).toBe(1);
  });
});
