import { describe, it, expect } from "vitest";
import { buildMapEvalInput, type MapEvalInputSources } from "../build-map-eval-input";
import { shouldEvaluateMap } from "../should-evaluate-map";

/** Helper: build input AND evaluate in one step */
function shouldEval(overrides: Partial<MapEvalInputSources>) {
  const base: MapEvalInputSources = {
    optionCount: 3,
    currentPosition: { col: 2, row: 5 },
    act: 1,
    currentHpPercent: 0.8,
    currentDeckSize: 15,
    prevContext: { hpPercent: 0.9, deckSize: 14, act: 1 },
    recommendedNodes: new Set(["2,5", "3,6", "4,7", "2,8", "1,9"]),
  };
  const input = buildMapEvalInput({ ...base, ...overrides });
  return { input, result: shouldEvaluateMap(input) };
}

describe("buildMapEvalInput + shouldEvaluateMap integration", () => {
  it("returns false when on recommended path with minor HP change", () => {
    // Player at 2,5 which IS in recommendedNodes. HP dropped 10% (below 15% threshold).
    const { result } = shouldEval({
      currentPosition: { col: 2, row: 5 },
      currentHpPercent: 0.8, // was 0.9, dropped 10%
    });
    expect(result).toBe(false);
  });

  it("returns false when following recommended path after combat (node 2)", () => {
    // Moved from 2,5 to 3,6 — both in recommended nodes
    const { result } = shouldEval({
      currentPosition: { col: 3, row: 6 },
    });
    expect(result).toBe(false);
  });

  it("returns false when following recommended path after combat (node 3)", () => {
    const { result } = shouldEval({
      currentPosition: { col: 4, row: 7 },
    });
    expect(result).toBe(false);
  });

  it("returns true when position is NOT in recommended nodes (deviated)", () => {
    const { result } = shouldEval({
      currentPosition: { col: 5, row: 5 }, // NOT in recommended set
    });
    expect(result).toBe(true);
  });

  it("returns false when no prev context exists (first eval)", () => {
    // No prev context = should evaluate (need initial path)
    const { result } = shouldEval({ prevContext: null });
    expect(result).toBe(true);
  });

  it("correctly detects on-path with string key matching", () => {
    // Verify the "col,row" string construction matches Set entries
    const { input } = shouldEval({
      currentPosition: { col: 2, row: 8 },
    });
    expect(input.isOnRecommendedPath).toBe(true);
  });

  it("correctly detects off-path", () => {
    const { input } = shouldEval({
      currentPosition: { col: 99, row: 99 },
    });
    expect(input.isOnRecommendedPath).toBe(false);
  });

  it("does not flag significant context change for normal combat HP loss", () => {
    // 10% HP drop = below 15% threshold
    const { input } = shouldEval({
      currentHpPercent: 0.8, // prev was 0.9
    });
    expect(input.hasSignificantContextChange).toBe(false);
  });

  it("deck grew by 1 after card reward does not trigger", () => {
    const { input } = shouldEval({
      currentDeckSize: 15, // prev was 14, grew by 1
    });
    expect(input.hasSignificantContextChange).toBe(false);
  });
});
