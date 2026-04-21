// Kept only because `map-coach-schema.ts` imports REPAIR_REASON_KINDS for its
// zod enum. Post-phase-4 the compliance field is a telemetry passthrough;
// there's no repair/rerank pipeline to aggregate.
export const REPAIR_REASON_KINDS = [
  "empty_macro_path",
  "unknown_node_id",
  "first_floor_mismatch",
  "contiguity_gap",
  "missing_boss",
  "walk_dead_end",
  "starts_at_current_position",
] as const;

export type RepairReasonKind = (typeof REPAIR_REASON_KINDS)[number];
