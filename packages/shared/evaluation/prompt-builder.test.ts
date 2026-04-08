import { describe, it, expect } from "vitest";
import { buildSystemPrompt, type EvalType } from "./prompt-builder";

describe("buildSystemPrompt", () => {
  const ALL_EVAL_TYPES: EvalType[] = [
    "card_reward",
    "shop",
    "map",
    "rest_site",
    "event",
    "card_removal",
    "card_upgrade",
    "card_select",
    "relic_select",
    "boss_briefing",
  ];

  describe("hallucination guards (regression #58)", () => {
    // These tests lock in the BASE_PROMPT rules that stop the LLM from
    // inventing card properties that aren't in the description. Each was
    // added after a real production hallucination — remove only with a
    // stronger replacement in place.

    it.each(ALL_EVAL_TYPES)(
      "%s prompt documents TARGET SCOPE (#58 — Feed hallucinated as AoE)",
      (type) => {
        const prompt = buildSystemPrompt(type);
        expect(prompt).toMatch(/TARGET SCOPE/);
        expect(prompt).toMatch(/single-target/i);
        expect(prompt).toMatch(/to ALL enemies/);
        expect(prompt).toMatch(/Do NOT describe a single-target attack as AoE/);
      },
    );

    it.each(ALL_EVAL_TYPES)(
      "%s prompt forbids inventing properties not in the description",
      (type) => {
        const prompt = buildSystemPrompt(type);
        // Reasoning-must-match-description rule (OUTPUT RULES)
        expect(prompt).toMatch(/Do NOT invent target scope, keywords, AoE-ness/);
      },
    );

    it.each(ALL_EVAL_TYPES)(
      "%s prompt still carries the pre-existing SYNERGY and keyword guards",
      (type) => {
        const prompt = buildSystemPrompt(type);
        expect(prompt).toMatch(/READ DESCRIPTIONS CAREFULLY/);
        expect(prompt).toMatch(/SYNERGY CLAIMS/);
        expect(prompt).toMatch(/UNKNOWN ITEMS/);
      },
    );
  });

  describe("multiplayer addendum", () => {
    it("appends co-op rules when isMultiplayer is true", () => {
      const solo = buildSystemPrompt("card_reward", false);
      const coop = buildSystemPrompt("card_reward", true);
      expect(coop.length).toBeGreaterThan(solo.length);
      expect(coop).toMatch(/CO-OP RULES/);
    });

    it("omits co-op rules for solo evals", () => {
      const solo = buildSystemPrompt("card_reward", false);
      expect(solo).not.toMatch(/CO-OP RULES/);
    });
  });
});
