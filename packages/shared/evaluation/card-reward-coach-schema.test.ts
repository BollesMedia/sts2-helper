import { describe, it, expect } from "vitest";
import {
  cardRewardCoachingSchema,
  sanitizeCardRewardCoachOutput,
} from "./card-reward-coach-schema";

const validCoaching = {
  reasoning: {
    deck_state: "14-card healthy deck, no committed archetype yet.",
    commitment: "Inflame is a Strength keystone and 3 support cards in deck.",
  },
  headline: "Take Inflame — commits to Strength.",
  confidence: 0.82,
  key_tradeoffs: [
    {
      position: 1,
      upside: "Standalone damage.",
      downside: "Doesn't scale with future picks.",
    },
  ],
  teaching_callouts: [
    {
      pattern: "keystone_available",
      explanation: "Deck has 3 Strength support cards; Inflame locks in.",
    },
  ],
};

describe("cardRewardCoachingSchema", () => {
  it("parses a valid coaching object", () => {
    expect(cardRewardCoachingSchema.safeParse(validCoaching).success).toBe(true);
  });

  it("rejects empty reasoning fields", () => {
    const bad = {
      ...validCoaching,
      reasoning: { deck_state: "", commitment: "" },
    };
    expect(cardRewardCoachingSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts confidence out of range at schema level (clamped by sanitize)", () => {
    const lax = { ...validCoaching, confidence: 1.5 };
    expect(cardRewardCoachingSchema.safeParse(lax).success).toBe(true);
  });
});

describe("sanitizeCardRewardCoachOutput", () => {
  it("caps key_tradeoffs at 3", () => {
    const many = {
      ...validCoaching,
      key_tradeoffs: Array.from({ length: 5 }, (_, i) => ({
        ...validCoaching.key_tradeoffs[0],
        position: i + 1,
      })),
    };
    const out = sanitizeCardRewardCoachOutput(many);
    expect(out.key_tradeoffs).toHaveLength(3);
  });

  it("caps teaching_callouts at 3", () => {
    const many = {
      ...validCoaching,
      teaching_callouts: Array(5).fill(validCoaching.teaching_callouts[0]),
    };
    const out = sanitizeCardRewardCoachOutput(many);
    expect(out.teaching_callouts).toHaveLength(3);
  });

  it("clamps confidence to [0, 1]", () => {
    expect(sanitizeCardRewardCoachOutput({ ...validCoaching, confidence: 1.5 }).confidence).toBe(1);
    expect(sanitizeCardRewardCoachOutput({ ...validCoaching, confidence: -0.2 }).confidence).toBe(0);
  });

  it("dedupes key_tradeoffs by position (keeps first)", () => {
    const withDupe = {
      ...validCoaching,
      key_tradeoffs: [
        { position: 1, upside: "first", downside: "first" },
        { position: 1, upside: "dupe", downside: "dupe" },
        { position: 2, upside: "second", downside: "second" },
      ],
    };
    const out = sanitizeCardRewardCoachOutput(withDupe);
    expect(out.key_tradeoffs).toHaveLength(2);
    expect(out.key_tradeoffs[0].upside).toBe("first");
  });
});
