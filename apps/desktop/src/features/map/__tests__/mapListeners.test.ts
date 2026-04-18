import { describe, it, expect } from "vitest";
import { parseNodeId } from "../mapListeners";

describe("parseNodeId", () => {
  it("parses well-formed col,row strings", () => {
    expect(parseNodeId("0,0")).toEqual({ col: 0, row: 0 });
    expect(parseNodeId("3,12")).toEqual({ col: 3, row: 12 });
  });

  it.each([
    "1,",
    ",2",
    "abc",
    "1,2,3",
    "1.5,2",
    "-1,2",
    "",
    " 1,2",
    "1, 2",
    "NaN,0",
  ])("returns null for malformed %p", (input) => {
    expect(parseNodeId(input)).toBeNull();
  });

  it("filters malformed entries when mapped over a path", () => {
    const floors = [
      { nodeId: "1,2" },
      { nodeId: "1," },
      { nodeId: "abc" },
      { nodeId: "3,4" },
    ];
    const parsed = floors
      .map((f) => parseNodeId(f.nodeId))
      .filter((p): p is { col: number; row: number } => p !== null);

    // Two malformed entries dropped — no NaN/0 rows leak through.
    expect(parsed).toEqual([
      { col: 1, row: 2 },
      { col: 3, row: 4 },
    ]);
    expect(parsed.some((p) => Number.isNaN(p.col) || Number.isNaN(p.row))).toBe(false);
  });
});
