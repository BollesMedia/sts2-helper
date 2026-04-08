import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  bossBriefingSchema,
  buildMapEvalSchema,
  mapEvalResponseSchema,
  genericEvalSchema,
  simpleEvalSchema,
  buildCardRewardSchema,
} from "./eval-schemas";

describe("eval-schemas", () => {
  describe("bossBriefingSchema", () => {
    it("parses a valid strategy", () => {
      expect(bossBriefingSchema.parse({ strategy: "block first turn" })).toEqual({
        strategy: "block first turn",
      });
    });

    it("rejects missing strategy", () => {
      expect(() => bossBriefingSchema.parse({})).toThrow();
    });
  });

  describe("buildMapEvalSchema", () => {
    const validEntry = {
      option_index: 1,
      tier: "S",
      confidence: 90,
      reasoning: "elite gives relic",
    };
    const validPrefs = {
      monster: 0.4,
      elite: 0.5,
      shop: 0.5,
      rest: 0.6,
      treasure: 0.9,
      event: 0.5,
    };

    it("parses a valid 3-option response", () => {
      const schema = buildMapEvalSchema(3);
      const parsed = schema.parse({
        rankings: [validEntry, validEntry, validEntry],
        overall_advice: "go right",
        node_preferences: validPrefs,
      });
      expect(parsed.rankings).toHaveLength(3);
      expect(parsed.node_preferences.elite).toBe(0.5);
    });

    it("rejects when rankings count does not match optionCount (strict-fail)", () => {
      const schema = buildMapEvalSchema(3);
      expect(() =>
        schema.parse({
          rankings: [validEntry, validEntry], // only 2 of 3
          overall_advice: "go right",
          node_preferences: validPrefs,
        }),
      ).toThrow();
    });

    it("rejects missing node_preferences (the b11bef8 silent-drop case)", () => {
      const schema = buildMapEvalSchema(1);
      expect(() =>
        schema.parse({
          rankings: [validEntry],
          overall_advice: "go right",
        }),
      ).toThrow();
    });

    it("rejects invalid tier values", () => {
      const schema = buildMapEvalSchema(1);
      expect(() =>
        schema.parse({
          rankings: [{ ...validEntry, tier: "Z" }],
          overall_advice: "go right",
          node_preferences: validPrefs,
        }),
      ).toThrow();
    });
  });

  describe("mapEvalResponseSchema (client variant)", () => {
    it("parses without enforcing array length", () => {
      const parsed = mapEvalResponseSchema.parse({
        rankings: [
          { option_index: 1, tier: "A", confidence: 80, reasoning: "ok" },
          { option_index: 2, tier: "B", confidence: 70, reasoning: "ok" },
        ],
        overall_advice: "x",
        node_preferences: {
          monster: 0.4,
          elite: 0.5,
          shop: 0.5,
          rest: 0.6,
          treasure: 0.9,
          event: 0.5,
        },
      });
      expect(parsed.rankings).toHaveLength(2);
    });
  });

  describe("genericEvalSchema", () => {
    it("parses a card_select-shaped response (the dev event log sample)", () => {
      const parsed = genericEvalSchema.parse({
        rankings: [
          {
            item_id: "DISMANTLE_PLUS",
            tier: "S",
            confidence: 95,
            rank: 1,
            recommendation: "strong_pick",
            synergy_score: 95,
            reasoning: "Core vulnerable synergy.",
          },
        ],
        pick_summary: "Enchant Dismantle+.",
        overall_advice: "Long advice text.",
      });
      expect(parsed.rankings[0].item_id).toBe("DISMANTLE_PLUS");
      expect(parsed.pick_summary).toBe("Enchant Dismantle+.");
    });

    it("accepts rankings with only required fields", () => {
      expect(() =>
        genericEvalSchema.parse({
          rankings: [{ item_id: "X", tier: "C", confidence: 50, reasoning: "ok" }],
        }),
      ).not.toThrow();
    });
  });

  describe("simpleEvalSchema", () => {
    it("parses a card_select recommendation", () => {
      expect(
        simpleEvalSchema.parse({ card_name: "Dismantle+", reasoning: "best target" }),
      ).toEqual({ card_name: "Dismantle+", reasoning: "best target" });
    });

    it("rejects missing card_name", () => {
      expect(() => simpleEvalSchema.parse({ reasoning: "x" })).toThrow();
    });
  });

  describe("buildCardRewardSchema", () => {
    const items = [
      { name: "Strike" },
      { name: "Defend" },
      { name: "Bash" },
    ];
    const validRanking = (position: number) => ({
      position,
      tier: "B" as const,
      confidence: 70,
      reasoning: "ok",
    });

    it("parses a valid 3-item response", () => {
      const schema = buildCardRewardSchema(items, false);
      const parsed = schema.parse({
        rankings: [validRanking(1), validRanking(2), validRanking(3)],
        skip_recommended: false,
      });
      expect(parsed.rankings).toHaveLength(3);
    });

    it("rejects when rankings.length !== items.length (strict-fail, replaces fallback fill)", () => {
      const schema = buildCardRewardSchema(items, false);
      expect(() =>
        schema.parse({
          rankings: [validRanking(1), validRanking(2)], // only 2 of 3
          skip_recommended: false,
        }),
      ).toThrow();
    });

    it("includes spending_plan only when includeShopPlan is true", () => {
      const shopSchema = buildCardRewardSchema(items, true);
      const parsed = shopSchema.parse({
        rankings: [validRanking(1), validRanking(2), validRanking(3)],
        skip_recommended: false,
        spending_plan: "Buy Bash",
      });
      expect("spending_plan" in parsed).toBe(true);
    });

    it("requires skip_recommended", () => {
      const schema = buildCardRewardSchema(items, false);
      expect(() =>
        schema.parse({
          rankings: [validRanking(1), validRanking(2), validRanking(3)],
        }),
      ).toThrow();
    });
  });

  // Regression: #48 — `z.number().int()` and `z.int()` both bake
  // `minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER`
  // into the emitted JSON Schema, and Anthropic's structured-output
  // endpoint rejects integer types that carry minimum/maximum
  // ("For 'integer' type, properties maximum, minimum are not supported").
  // The Phase 4.5 smoke test (route.test.ts) used MockLanguageModelV3 and
  // never round-tripped through Anthropic's schema validator, so this
  // class of bug ships silently. Catch it at the schema-definition layer.
  describe("Anthropic JSON Schema compatibility (regression #48)", () => {
    function* walk(node: unknown, path: string[] = []): Generator<{ path: string[]; node: Record<string, unknown> }> {
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      yield { path, node: obj };
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === "object") {
          yield* walk(v, [...path, k]);
        }
      }
    }

    function assertNoIntegerBounds(jsonSchema: unknown, schemaName: string) {
      for (const { path, node } of walk(jsonSchema)) {
        if (node.type === "integer" && ("minimum" in node || "maximum" in node)) {
          throw new Error(
            `[${schemaName}] integer schema at ${path.join(".") || "<root>"} carries minimum/maximum, which Anthropic structured-output rejects. ` +
              `Use plain z.number() instead of z.number().int() or z.int(). Node: ${JSON.stringify(node)}`,
          );
        }
      }
    }

    const cases: Array<[string, unknown]> = [
      ["bossBriefingSchema", bossBriefingSchema],
      ["buildMapEvalSchema(3)", buildMapEvalSchema(3)],
      ["mapEvalResponseSchema", mapEvalResponseSchema],
      ["genericEvalSchema", genericEvalSchema],
      ["simpleEvalSchema", simpleEvalSchema],
      ["buildCardRewardSchema(items=3, shop=false)", buildCardRewardSchema(
        [{ name: "Strike" }, { name: "Defend" }, { name: "Bash" }],
        false,
      )],
      ["buildCardRewardSchema(items=3, shop=true)", buildCardRewardSchema(
        [{ name: "Strike" }, { name: "Defend" }, { name: "Bash" }],
        true,
      )],
    ];

    it.each(cases)("%s emits no integer min/max", (name, schema) => {
      const json = z.toJSONSchema(schema as z.ZodType);
      assertNoIntegerBounds(json, name);
    });

    // Sanity check: the helper actually catches the bad pattern. If this
    // ever stops failing, the regression assertion above is silently broken.
    it("helper detects the bug pattern when present (sanity check)", () => {
      const bad = z.object({ confidence: z.number().int() });
      expect(() =>
        assertNoIntegerBounds(z.toJSONSchema(bad), "bad-fixture"),
      ).toThrow(/integer schema at .* carries minimum\/maximum/);
    });
  });
});
