import { describe, it, expect } from "vitest";
import { buildComplianceReport } from "./compliance-report";
import type { MapCoachOutputRaw } from "../map-coach-schema";

const stubOutput: MapCoachOutputRaw = {
  reasoning: { risk_capacity: "moderate", act_goal: "heal" },
  headline: "take elite",
  confidence: 0.75,
  macro_path: { floors: [], summary: "path" },
  key_branches: [],
  teaching_callouts: [],
};

describe("buildComplianceReport", () => {
  it("reflects both fired", () => {
    const report = buildComplianceReport(
      {
        output: stubOutput,
        repaired: true,
        repair_reasons: [{ kind: "empty_macro_path" }],
      },
      { output: stubOutput, reranked: true, rerank_reason: "dominated_by_path_B" },
    );
    expect(report).toEqual({
      repaired: true,
      reranked: true,
      rerank_reason: "dominated_by_path_B",
      repair_reasons: [{ kind: "empty_macro_path" }],
    });
  });

  it("reflects neither fired", () => {
    const report = buildComplianceReport(
      { output: stubOutput, repaired: false, repair_reasons: [] },
      { output: stubOutput, reranked: false, rerank_reason: null },
    );
    expect(report).toEqual({
      repaired: false,
      reranked: false,
      rerank_reason: null,
      repair_reasons: [],
    });
  });

  it("reflects only repair fired", () => {
    const report = buildComplianceReport(
      {
        output: stubOutput,
        repaired: true,
        repair_reasons: [{ kind: "missing_boss" }, { kind: "contiguity_gap", detail: "f8" }],
      },
      { output: stubOutput, reranked: false, rerank_reason: null },
    );
    expect(report.repaired).toBe(true);
    expect(report.reranked).toBe(false);
    expect(report.repair_reasons).toHaveLength(2);
  });
});
