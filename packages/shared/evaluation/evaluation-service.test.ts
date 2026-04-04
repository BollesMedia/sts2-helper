import { describe, it, expect } from "vitest";
import { parseToolUseInput, parseClaudeCardRewardResponse } from "./parse-tool-response";

describe("parseToolUseInput", () => {
  it("parses a valid tool use response", () => {
    const input = {
      rankings: [
        {
          item_id: "OFFERING",
          rank: 1,
          tier: "S",
          synergy_score: 95,
          confidence: 90,
          recommendation: "strong_pick",
          reasoning: "Best card in the game",
        },
      ],
      skip_recommended: false,
      skip_reasoning: null,
    };

    const result = parseToolUseInput(input);
    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0].item_id).toBe("OFFERING");
    expect(result.rankings[0].tier).toBe("S");
    expect(result.skip_recommended).toBe(false);
  });

  it("handles missing fields with defaults", () => {
    const input = {
      rankings: [{ item_id: "TEST" }],
    };

    const result = parseToolUseInput(input);
    expect(result.rankings[0].tier).toBe("C");
    expect(result.rankings[0].recommendation).toBe("situational");
    expect(result.rankings[0].synergy_score).toBe(50);
    expect(result.rankings[0].confidence).toBe(50);
    expect(result.skip_recommended).toBe(false);
  });

  it("validates tier enum", () => {
    const input = {
      rankings: [{ item_id: "TEST", tier: "Z" }],
    };

    const result = parseToolUseInput(input);
    expect(result.rankings[0].tier).toBe("C"); // fallback
  });

  it("validates recommendation enum", () => {
    const input = {
      rankings: [{ item_id: "TEST", recommendation: "must_take" }],
    };

    const result = parseToolUseInput(input);
    expect(result.rankings[0].recommendation).toBe("situational"); // fallback
  });

  it("throws for non-object input", () => {
    expect(() => parseToolUseInput(null)).toThrow();
    expect(() => parseToolUseInput("string")).toThrow();
  });

  it("handles empty rankings array", () => {
    const result = parseToolUseInput({ rankings: [] });
    expect(result.rankings).toHaveLength(0);
  });

  it("parses spending_plan for shop evaluations", () => {
    const input = {
      rankings: [],
      skip_recommended: false,
      spending_plan: "Buy Card Removal (75g)",
    };

    const result = parseToolUseInput(input);
    expect(result.spending_plan).toBe("Buy Card Removal (75g)");
  });
});

describe("parseClaudeCardRewardResponse", () => {
  it("transforms Claude response into typed evaluation", () => {
    const raw = {
      rankings: [
        {
          item_id: "OFFERING",
          rank: 1,
          tier: "S" as const,
          synergy_score: 95,
          confidence: 90,
          recommendation: "strong_pick" as const,
          reasoning: "Always take Offering",
        },
      ],
      pick_summary: "Pick Offering — best card in game",
      skip_recommended: false,
      skip_reasoning: null,
    };

    const result = parseClaudeCardRewardResponse(raw);
    expect(result.rankings[0].itemId).toBe("OFFERING");
    expect(result.rankings[0].tierValue).toBe(6);
    expect(result.rankings[0].source).toBe("claude");
    expect(result.skipRecommended).toBe(false);
  });

  it("includes spending plan when present", () => {
    const raw = {
      rankings: [],
      pick_summary: null,
      skip_recommended: false,
      skip_reasoning: null,
      spending_plan: "Buy removal",
    };

    const result = parseClaudeCardRewardResponse(raw);
    expect(result.spendingPlan).toBe("Buy removal");
  });
});
