import { describe, it, expect } from "vitest";
import { shouldEvaluateMap } from "./should-evaluate-map";

function base(overrides: Partial<Parameters<typeof shouldEvaluateMap>[0]> = {}) {
  return {
    optionCount: 1,
    hasPrevContext: true,
    isStartOfAct: false,
    ancientHealResolved: true,
    currentPosition: { col: 0, row: 1 },
    isOnRecommendedPath: true,
    nextOptions: [{ col: 0, row: 2, type: "monster" }],
    nextOptionSubgraphFingerprints: ["x"],
    ...overrides,
  };
}

function twoTypeFork(overrides: Partial<Parameters<typeof shouldEvaluateMap>[0]> = {}) {
  return base({
    optionCount: 2,
    nextOptions: [
      { col: 0, row: 2, type: "monster" },
      { col: 1, row: 2, type: "elite" },
    ],
    nextOptionSubgraphFingerprints: ["a", "b"],
    ...overrides,
  });
}

describe("shouldEvaluateMap — triggers", () => {
  it("returns false when there are no options", () => {
    expect(shouldEvaluateMap(base({ optionCount: 0, nextOptions: [], nextOptionSubgraphFingerprints: [] }))).toBe(false);
  });

  it("triggers on the first eval (no prior context)", () => {
    expect(shouldEvaluateMap(base({ hasPrevContext: false }))).toBe(true);
  });

  it("triggers at start of Act 1 (no ancient to wait for)", () => {
    expect(shouldEvaluateMap(base({ isStartOfAct: true, ancientHealResolved: true }))).toBe(true);
  });

  it("waits one tick at start of Acts 2/3 if the ancient heal is unresolved", () => {
    expect(shouldEvaluateMap(base({ isStartOfAct: true, ancientHealResolved: false }))).toBe(false);
  });

  it("triggers on start of Acts 2/3 once ancient heal is resolved", () => {
    expect(shouldEvaluateMap(base({ isStartOfAct: true, ancientHealResolved: true }))).toBe(true);
  });

  it("does NOT trigger off-path when the next row is forced (single option)", () => {
    // Previously condition fired here and produced a useless re-plan because
    // the next move is determined; issue #115 defers to the next fork.
    expect(shouldEvaluateMap(base({ isOnRecommendedPath: false }))).toBe(false);
  });

  it("triggers off-path when the next row is a meaningful fork", () => {
    expect(shouldEvaluateMap(twoTypeFork({ isOnRecommendedPath: false }))).toBe(true);
  });

  it("triggers on a fork where options differ in type", () => {
    expect(shouldEvaluateMap(twoTypeFork())).toBe(true);
  });

  it("triggers on a same-type fork when downstream subgraphs differ", () => {
    expect(
      shouldEvaluateMap(
        base({
          optionCount: 2,
          nextOptions: [
            { col: 0, row: 2, type: "monster" },
            { col: 1, row: 2, type: "monster" },
          ],
          nextOptionSubgraphFingerprints: ["a", "b"],
        }),
      ),
    ).toBe(true);
  });

  it("does NOT trigger on a same-type fork with identical downstream subgraphs", () => {
    expect(
      shouldEvaluateMap(
        base({
          optionCount: 2,
          nextOptions: [
            { col: 0, row: 2, type: "monster" },
            { col: 1, row: 2, type: "monster" },
          ],
          nextOptionSubgraphFingerprints: ["a", "a"],
        }),
      ),
    ).toBe(false);
  });

  it("no-op when none of the triggers fire (single forced option, on-path)", () => {
    expect(shouldEvaluateMap(base())).toBe(false);
  });
});
