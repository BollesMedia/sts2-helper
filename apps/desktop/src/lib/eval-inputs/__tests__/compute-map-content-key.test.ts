import { describe, it, expect } from "vitest";
import { computeMapContentKey } from "../map";

describe("computeMapContentKey", () => {
  it("produces a stable key from state_type, position, and options", () => {
    const key = computeMapContentKey(
      "map",
      { col: 2, row: 5 },
      [
        { col: 1, row: 6 },
        { col: 3, row: 6 },
      ]
    );
    expect(key).toBe("map:2,5:1,6|3,6");
  });

  it("returns same key for identical content regardless of object identity", () => {
    const args = [
      "map" as const,
      { col: 2, row: 5 },
      [
        { col: 1, row: 6 },
        { col: 3, row: 6 },
      ],
    ] as const;

    // Two calls with fresh objects but same values
    const key1 = computeMapContentKey(args[0], { ...args[1] }, [...args[2].map((o) => ({ ...o }))]);
    const key2 = computeMapContentKey(args[0], { ...args[1] }, [...args[2].map((o) => ({ ...o }))]);
    expect(key1).toBe(key2);
  });

  it("handles null position", () => {
    const key = computeMapContentKey(
      "map",
      null,
      [{ col: 1, row: 6 }]
    );
    expect(key).toBe("map:null:1,6");
  });

  it("sorts options for stable ordering", () => {
    const key1 = computeMapContentKey(
      "map",
      { col: 0, row: 0 },
      [
        { col: 3, row: 6 },
        { col: 1, row: 6 },
      ]
    );
    const key2 = computeMapContentKey(
      "map",
      { col: 0, row: 0 },
      [
        { col: 1, row: 6 },
        { col: 3, row: 6 },
      ]
    );
    expect(key1).toBe(key2);
  });

  it("differs when position changes", () => {
    const opts = [{ col: 1, row: 6 }];
    const key1 = computeMapContentKey("map", { col: 2, row: 5 }, opts);
    const key2 = computeMapContentKey("map", { col: 2, row: 7 }, opts);
    expect(key1).not.toBe(key2);
  });

  it("differs when options change", () => {
    const pos = { col: 2, row: 5 };
    const key1 = computeMapContentKey("map", pos, [{ col: 1, row: 6 }]);
    const key2 = computeMapContentKey("map", pos, [{ col: 1, row: 6 }, { col: 3, row: 6 }]);
    expect(key1).not.toBe(key2);
  });
});
