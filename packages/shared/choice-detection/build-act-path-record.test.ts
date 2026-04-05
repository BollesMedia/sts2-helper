import { describe, it, expect } from "vitest";
import { buildActPathRecord } from "./build-act-path-record";
import type { ActPathNode } from "./types";

const recommended: ActPathNode[] = [
  { col: 0, row: 0, nodeType: "monster" },
  { col: 1, row: 1, nodeType: "elite" },
  { col: 2, row: 2, nodeType: "rest" },
  { col: 1, row: 3, nodeType: "monster" },
];

describe("buildActPathRecord", () => {
  it("returns zero deviations when paths match exactly", () => {
    const actual = [...recommended];
    const result = buildActPathRecord(1, recommended, actual);
    expect(result.deviationCount).toBe(0);
    expect(result.deviationNodes).toEqual([]);
  });

  it("detects deviations where nodes differ at same index", () => {
    const actual: ActPathNode[] = [
      { col: 0, row: 0, nodeType: "monster" },
      { col: 2, row: 1, nodeType: "shop" },
      { col: 2, row: 2, nodeType: "rest" },
      { col: 1, row: 3, nodeType: "monster" },
    ];
    const result = buildActPathRecord(1, recommended, actual);
    expect(result.deviationCount).toBe(1);
    expect(result.deviationNodes).toEqual([
      { col: 2, row: 1, recommended: "elite", actual: "shop" },
    ]);
  });

  it("handles partial act (actual shorter than recommended)", () => {
    const actual: ActPathNode[] = [
      { col: 0, row: 0, nodeType: "monster" },
      { col: 1, row: 1, nodeType: "elite" },
    ];
    const result = buildActPathRecord(2, recommended, actual);
    expect(result.act).toBe(2);
    expect(result.actualPath).toHaveLength(2);
    expect(result.recommendedPath).toHaveLength(4);
    expect(result.deviationCount).toBe(0);
  });

  it("handles actual longer than recommended", () => {
    const actual: ActPathNode[] = [
      ...recommended,
      { col: 0, row: 4, nodeType: "treasure" },
    ];
    const result = buildActPathRecord(1, recommended, actual);
    expect(result.deviationCount).toBe(0);
  });

  it("handles empty recommended path", () => {
    const actual: ActPathNode[] = [
      { col: 0, row: 0, nodeType: "monster" },
    ];
    const result = buildActPathRecord(1, [], actual);
    expect(result.deviationCount).toBe(0);
    expect(result.recommendedPath).toEqual([]);
    expect(result.actualPath).toHaveLength(1);
  });

  it("sets act number in the record", () => {
    const result = buildActPathRecord(3, recommended, recommended);
    expect(result.act).toBe(3);
  });
});
