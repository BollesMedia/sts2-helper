import { describe, it, expect, beforeEach } from "vitest";
import { appendNode, getActPath, clearAllActPaths } from "./act-path-tracker";

beforeEach(() => {
  clearAllActPaths();
});

describe("act-path-tracker", () => {
  it("returns empty array for untracked act", () => {
    expect(getActPath(1)).toEqual([]);
  });

  it("accumulates nodes for an act", () => {
    appendNode(1, { col: 0, row: 0, nodeType: "monster" });
    appendNode(1, { col: 1, row: 1, nodeType: "elite" });
    appendNode(1, { col: 2, row: 2, nodeType: "rest" });
    expect(getActPath(1)).toEqual([
      { col: 0, row: 0, nodeType: "monster" },
      { col: 1, row: 1, nodeType: "elite" },
      { col: 2, row: 2, nodeType: "rest" },
    ]);
  });

  it("keeps acts separate", () => {
    appendNode(1, { col: 0, row: 0, nodeType: "monster" });
    appendNode(2, { col: 1, row: 0, nodeType: "shop" });
    expect(getActPath(1)).toHaveLength(1);
    expect(getActPath(2)).toHaveLength(1);
  });

  it("clears all acts", () => {
    appendNode(1, { col: 0, row: 0, nodeType: "monster" });
    appendNode(2, { col: 1, row: 0, nodeType: "shop" });
    clearAllActPaths();
    expect(getActPath(1)).toEqual([]);
    expect(getActPath(2)).toEqual([]);
  });

  it("does not add duplicate consecutive nodes", () => {
    appendNode(1, { col: 0, row: 0, nodeType: "monster" });
    appendNode(1, { col: 0, row: 0, nodeType: "monster" });
    expect(getActPath(1)).toHaveLength(1);
  });
});
