import { describe, it, expect } from "vitest";
import { computeSubgraphFingerprint } from "./compute-subgraph-fingerprint";

describe("computeSubgraphFingerprint", () => {
  it("returns the same fingerprint for two subgraphs with the same type histogram per row", () => {
    const nodes = [
      { col: 0, row: 0, type: "monster", children: [{ col: 0, row: 1 }] },
      { col: 1, row: 0, type: "monster", children: [{ col: 1, row: 1 }] },
      { col: 0, row: 1, type: "rest", children: [{ col: 0, row: 2 }] },
      { col: 1, row: 1, type: "rest", children: [{ col: 1, row: 2 }] },
      { col: 0, row: 2, type: "elite", children: [] },
      { col: 1, row: 2, type: "elite", children: [] },
    ];
    const fpA = computeSubgraphFingerprint(nodes, { col: 0, row: 0 }, 2);
    const fpB = computeSubgraphFingerprint(nodes, { col: 1, row: 0 }, 2);
    expect(fpA).toBe(fpB);
  });

  it("returns different fingerprints when subgraphs differ in type histogram", () => {
    const nodes = [
      { col: 0, row: 0, type: "monster", children: [{ col: 0, row: 1 }] },
      { col: 1, row: 0, type: "monster", children: [{ col: 1, row: 1 }] },
      { col: 0, row: 1, type: "rest", children: [] },
      { col: 1, row: 1, type: "elite", children: [] },
    ];
    const fpA = computeSubgraphFingerprint(nodes, { col: 0, row: 0 }, 1);
    const fpB = computeSubgraphFingerprint(nodes, { col: 1, row: 0 }, 1);
    expect(fpA).not.toBe(fpB);
  });
});
