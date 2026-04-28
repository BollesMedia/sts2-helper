import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  bossBriefingSchema,
  buildMapEvalSchema,
  mapEvalResponseSchema,
  genericEvalSchema,
  simpleEvalSchema,
  cardRewardEvalSchema,
} from "./eval-schemas";
import { tierExtractionSchema } from "./tier-extraction";
import { mapCoachOutputSchema } from "./map-coach-schema";

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

    it("accepts wrong rankings count at schema layer — count enforcement lives in route handler post-#54", () => {
      // Pre-#54 this threw via `.refine()`. Post-#54 the schema intentionally
      // accepts any length so Claude's drift-added summary/placeholder
      // entries don't hard-502 the real rankings. Count enforcement moved to
      // `sanitizeRankings` in the route handler; see its unit tests in
      // `sanitize-rankings.test.ts`.
      const schema = buildMapEvalSchema(3);
      expect(() =>
        schema.parse({
          rankings: [validEntry, validEntry], // only 2 of 3
          overall_advice: "go right",
          node_preferences: validPrefs,
        }),
      ).not.toThrow();
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

  describe("cardRewardEvalSchema", () => {
    const validRanking = (position: number) => ({
      position,
      tier: "B" as const,
      confidence: 70,
      reasoning: "ok",
    });

    it("parses a valid 3-item response", () => {
      const parsed = cardRewardEvalSchema.parse({
        rankings: [validRanking(1), validRanking(2), validRanking(3)],
        skip_recommended: false,
      });
      expect(parsed.rankings).toHaveLength(3);
    });

    it("accepts wrong rankings count at schema layer — count enforcement lives in route handler post-#54", () => {
      // Schema is intentionally lenient on count; downstream sanitizer
      // enforces. See `sanitize-rankings.test.ts` for the coverage.
      expect(() =>
        cardRewardEvalSchema.parse({
          rankings: [validRanking(1), validRanking(2)],
          skip_recommended: false,
        }),
      ).not.toThrow();
    });

    it("accepts spending_plan when present (shop path)", () => {
      const parsed = cardRewardEvalSchema.parse({
        rankings: [validRanking(1), validRanking(2), validRanking(3)],
        skip_recommended: false,
        spending_plan: "Buy Bash",
      });
      expect(parsed.spending_plan).toBe("Buy Bash");
    });

    it("requires skip_recommended", () => {
      expect(() =>
        cardRewardEvalSchema.parse({
          rankings: [validRanking(1), validRanking(2), validRanking(3)],
        }),
      ).toThrow();
    });
  });

  // Regression: Anthropic's structured-output endpoint rejects several JSON
  // Schema constraints that zod v4 bakes in by default. Every time we've hit
  // this it's been a "zod feature I reached for → Anthropic 500 → full
  // debugging cycle" loop. The walk-and-assert below catches every known
  // rejection at the schema-definition layer so future schemas trip CI before
  // touching the real API.
  //
  // Known-rejected constraints (expand as new ones are discovered):
  //   • #48  integer type with `minimum` or `maximum`
  //           zod: `z.number().int()` / `z.int()`
  //           Anthropic: "For 'integer' type, properties maximum, minimum
  //                       are not supported"
  //   • #52  array type with `minItems` > 1 or `maxItems` > 1
  //           zod: `z.array(...).length(N)` / `.min(N)` / `.max(N)` where N ≥ 2
  //           Anthropic: "For 'array' type, 'minItems' values other than 0
  //                       or 1 are not supported"
  //           (minItems of 0 or 1 is fine — same for maxItems.)
  //   • #68  number type with `minimum` or `maximum`
  //           zod: `z.number().min(X)` / `.max(X)` / `.gte(X)` / `.lte(X)`
  //           Anthropic: "For 'number' type, properties maximum, minimum
  //                       are not supported"
  //           Enforce via prompt + post-parse clamping in caller instead.
  //
  // The Phase 4.5 smoke test (route.test.ts) uses MockLanguageModelV3 so it
  // never round-trips through Anthropic's validator. This guard closes that
  // gap without needing a live API call.
  describe("Anthropic JSON Schema compatibility (regression #48, #52)", () => {
    type JsonNode = Record<string, unknown>;
    function* walk(node: unknown, path: string[] = []): Generator<{ path: string[]; node: JsonNode }> {
      if (!node || typeof node !== "object") return;
      const obj = node as JsonNode;
      yield { path, node: obj };
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === "object") {
          yield* walk(v, [...path, k]);
        }
      }
    }

    function assertAnthropicCompatible(jsonSchema: unknown, schemaName: string) {
      for (const { path, node } of walk(jsonSchema)) {
        const where = path.join(".") || "<root>";

        // #48 — integer min/max
        if (node.type === "integer" && ("minimum" in node || "maximum" in node)) {
          throw new Error(
            `[${schemaName}] integer schema at ${where} carries minimum/maximum, which Anthropic structured-output rejects (#48). ` +
              `Use plain z.number() instead of z.number().int() or z.int(). Node: ${JSON.stringify(node)}`,
          );
        }

        // #68 — number min/max
        if (node.type === "number" && ("minimum" in node || "maximum" in node)) {
          throw new Error(
            `[${schemaName}] number schema at ${where} carries minimum/maximum, which Anthropic structured-output rejects (#68). ` +
              `Use plain z.number() and clamp post-parse in the caller. Node: ${JSON.stringify(node)}`,
          );
        }

        // #52 — array minItems/maxItems > 1
        if (node.type === "array") {
          const minItems = typeof node.minItems === "number" ? node.minItems : undefined;
          const maxItems = typeof node.maxItems === "number" ? node.maxItems : undefined;
          if ((minItems !== undefined && minItems > 1) || (maxItems !== undefined && maxItems > 1)) {
            throw new Error(
              `[${schemaName}] array schema at ${where} carries minItems/maxItems > 1, which Anthropic structured-output rejects (#52). ` +
                `Use .refine((arr) => arr.length === N) instead of .length(N)/.min(N)/.max(N). Node: ${JSON.stringify(node)}`,
            );
          }
        }
      }
    }

    const cases: Array<[string, unknown]> = [
      ["bossBriefingSchema", bossBriefingSchema],
      ["buildMapEvalSchema(3)", buildMapEvalSchema(3)],
      ["buildMapEvalSchema(5)", buildMapEvalSchema(5)], // worst case for minItems rejection
      ["mapEvalResponseSchema", mapEvalResponseSchema],
      ["genericEvalSchema", genericEvalSchema],
      ["simpleEvalSchema", simpleEvalSchema],
      ["cardRewardEvalSchema", cardRewardEvalSchema],
      ["tierExtractionSchema", tierExtractionSchema],
      ["mapCoachOutputSchema", mapCoachOutputSchema],
    ];

    it.each(cases)("%s is Anthropic-compatible", (name, schema) => {
      const json = z.toJSONSchema(schema as z.ZodType);
      assertAnthropicCompatible(json, name);
    });

    // Sanity: the helper actually catches each bug class when present. If any
    // of these ever stops failing, the regression assertion has silently
    // drifted out of sync with what Anthropic rejects.
    describe("helper sanity checks", () => {
      it("catches integer min/max (#48)", () => {
        const bad = z.object({ confidence: z.number().int() });
        expect(() =>
          assertAnthropicCompatible(z.toJSONSchema(bad), "bad-int"),
        ).toThrow(/integer schema at .* carries minimum\/maximum/);
      });

      it("catches number .min() (#68)", () => {
        const bad = z.object({ confidence: z.number().min(0) });
        expect(() =>
          assertAnthropicCompatible(z.toJSONSchema(bad), "bad-num-min"),
        ).toThrow(/number schema at .* carries minimum\/maximum/);
      });

      it("catches number .max() (#68)", () => {
        const bad = z.object({ confidence: z.number().max(1) });
        expect(() =>
          assertAnthropicCompatible(z.toJSONSchema(bad), "bad-num-max"),
        ).toThrow(/number schema at .* carries minimum\/maximum/);
      });

      it("catches array .length(N) where N > 1 (#52)", () => {
        const bad = z.object({ rankings: z.array(z.string()).length(3) });
        expect(() =>
          assertAnthropicCompatible(z.toJSONSchema(bad), "bad-length"),
        ).toThrow(/array schema at .* carries minItems\/maxItems > 1/);
      });

      it("catches array .min(N) where N > 1 (#52)", () => {
        const bad = z.object({ rankings: z.array(z.string()).min(2) });
        expect(() =>
          assertAnthropicCompatible(z.toJSONSchema(bad), "bad-min"),
        ).toThrow(/array schema at .* carries minItems\/maxItems > 1/);
      });

      it("catches array .max(N) where N > 1 (#52)", () => {
        const bad = z.object({ rankings: z.array(z.string()).max(5) });
        expect(() =>
          assertAnthropicCompatible(z.toJSONSchema(bad), "bad-max"),
        ).toThrow(/array schema at .* carries minItems\/maxItems > 1/);
      });

      it("allows array .min(1) (minItems=1 is Anthropic-compatible)", () => {
        const ok = z.object({ rankings: z.array(z.string()).min(1) });
        expect(() =>
          assertAnthropicCompatible(z.toJSONSchema(ok), "ok-min-1"),
        ).not.toThrow();
      });
    });
  });
});
