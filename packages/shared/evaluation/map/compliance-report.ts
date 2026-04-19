import type { MapCoachOutputRaw } from "../map-coach-schema";

/**
 * Types for phase-2 compliance pipeline: structural repair + judgment rerank.
 * These are pure types — no runtime logic. Consumers: repair-macro-path,
 * rerank-if-dominated, and the evaluate route handler.
 */

export type RepairReasonKind =
  | "empty_macro_path"
  | "unknown_node_id"
  | "first_floor_mismatch"
  | "contiguity_gap"
  | "missing_boss"
  | "walk_dead_end"
  | "starts_at_current_position";

export interface RepairReason {
  kind: RepairReasonKind;
  detail?: string;
}

export interface RepairResult {
  output: MapCoachOutputRaw;
  repaired: boolean;
  repair_reasons: RepairReason[];
}

export interface RerankResult {
  output: MapCoachOutputRaw;
  reranked: boolean;
  rerank_reason: string | null;
}

export interface ComplianceReport {
  repaired: boolean;
  reranked: boolean;
  rerank_reason: string | null;
  repair_reasons: RepairReason[];
}

/**
 * Combine a RepairResult + RerankResult into a ComplianceReport suitable
 * for attaching to the response payload.
 */
export function buildComplianceReport(
  repair: RepairResult,
  rerank: RerankResult,
): ComplianceReport {
  return {
    repaired: repair.repaired,
    reranked: rerank.reranked,
    rerank_reason: rerank.rerank_reason,
    repair_reasons: repair.repair_reasons,
  };
}
