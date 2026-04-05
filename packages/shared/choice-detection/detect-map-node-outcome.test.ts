import { describe, it, expect } from "vitest";
import { detectMapNodeOutcome } from "./detect-map-node-outcome";
import type { DetectMapNodeInput, MapNode } from "./types";

const options: MapNode[] = [
  { col: 1, row: 3, nodeType: "elite" },
  { col: 2, row: 3, nodeType: "shop" },
  { col: 3, row: 3, nodeType: "monster" },
];

const baseInput: DetectMapNodeInput = {
  previousPosition: { col: 2, row: 2 },
  currentPosition: { col: 2, row: 3 },
  recommendedNextNode: { col: 1, row: 3, nodeType: "elite" },
  nextOptions: options,
};

function detect(overrides: Partial<DetectMapNodeInput> = {}) {
  return detectMapNodeOutcome({ ...baseInput, ...overrides });
}

describe("detectMapNodeOutcome", () => {
  it("returns null when position has not changed", () => {
    const result = detect({ currentPosition: { col: 2, row: 2 } });
    expect(result).toBeNull();
  });

  it("returns null when previousPosition is null (first poll)", () => {
    const result = detect({ previousPosition: null });
    expect(result).toBeNull();
  });

  it("detects user followed recommendation", () => {
    const result = detect({ currentPosition: { col: 1, row: 3 } });
    expect(result).toEqual({
      chosenNode: { col: 1, row: 3, nodeType: "elite" },
      recommendedNode: { col: 1, row: 3, nodeType: "elite" },
      allOptions: options,
      wasFollowed: true,
    });
  });

  it("detects user deviated from recommendation", () => {
    const result = detect({ currentPosition: { col: 2, row: 3 } });
    expect(result).toEqual({
      chosenNode: { col: 2, row: 3, nodeType: "shop" },
      recommendedNode: { col: 1, row: 3, nodeType: "elite" },
      allOptions: options,
      wasFollowed: false,
    });
  });

  it("handles no recommendation (eval pending)", () => {
    const result = detect({
      currentPosition: { col: 2, row: 3 },
      recommendedNextNode: null,
    });
    expect(result).toEqual({
      chosenNode: { col: 2, row: 3, nodeType: "shop" },
      recommendedNode: null,
      allOptions: options,
      wasFollowed: false,
    });
  });

  it("resolves chosen nodeType from options list", () => {
    const result = detect({ currentPosition: { col: 3, row: 3 } });
    expect(result?.chosenNode.nodeType).toBe("monster");
  });

  it("uses 'unknown' nodeType when chosen position not in options", () => {
    const result = detect({ currentPosition: { col: 4, row: 3 } });
    expect(result?.chosenNode.nodeType).toBe("unknown");
  });
});
