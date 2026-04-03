import { describe, it, expect } from "vitest";
import { matchRecommendation } from "../match-recommendation";

const eligible = ["Strike", "Defend", "Body Slam", "Bash", "True Grit"];

describe("matchRecommendation", () => {
  it("returns exact match", () => {
    expect(matchRecommendation("Body Slam", eligible)).toBe("Body Slam");
  });

  it("matches case-insensitively", () => {
    expect(matchRecommendation("body slam", eligible)).toBe("Body Slam");
  });

  it("strips + suffix when LLM recommends already-upgraded card", () => {
    // BUG: LLM recommended "Body Slam+" but only "Body Slam" is eligible
    expect(matchRecommendation("Body Slam+", eligible)).toBe("Body Slam");
  });

  it("returns null when no match at all", () => {
    expect(matchRecommendation("Nonexistent Card", eligible)).toBeNull();
  });

  it("handles upgraded-only eligible list", () => {
    const upgradedList = ["Strike+", "Defend+"];
    expect(matchRecommendation("Strike", upgradedList)).toBe("Strike+");
  });
});
