/**
 * @vitest-environment node
 *
 * Schema-level test for `/api/choice`. The full route handler depends on
 * auth + Supabase which are out of scope here — this test covers the
 * zod contract for the new `runStateSnapshot` passthrough (map coach phase 1).
 */
import { describe, it, expect } from "vitest";
import { choiceSchema } from "./route";

const base = {
  runId: "run-1",
  choiceType: "map_node",
  floor: 7,
  act: 1,
  sequence: 0,
  offeredItemIds: ["0,1", "2,1"],
  chosenItemId: "0,1",
};

describe("choiceSchema", () => {
  it("accepts a map_node choice with a runStateSnapshot object", () => {
    const snapshot = {
      hp_buffer: 12,
      risk_capacity: "comfortable",
      elites_remaining: 1,
    };
    const parsed = choiceSchema.parse({ ...base, runStateSnapshot: snapshot });
    expect(parsed.runStateSnapshot).toEqual(snapshot);
  });

  it("accepts null runStateSnapshot (non-map choices)", () => {
    const parsed = choiceSchema.parse({ ...base, runStateSnapshot: null });
    expect(parsed.runStateSnapshot).toBeNull();
  });

  it("accepts omitted runStateSnapshot (backwards-compat)", () => {
    const parsed = choiceSchema.parse(base);
    expect(parsed.runStateSnapshot).toBeUndefined();
  });

  it("rejects an invalid base payload (missing offeredItemIds) regardless of snapshot", () => {
    const { offeredItemIds: _omit, ...rest } = base;
    void _omit;
    const result = choiceSchema.safeParse({
      ...rest,
      runStateSnapshot: { anything: true },
    });
    expect(result.success).toBe(false);
  });
});
