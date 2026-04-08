import { describe, it, expect } from "vitest";
import { sanitizeRankings } from "./sanitize-rankings";

describe("sanitizeRankings", () => {
  const card = (position: number, reasoning = "ok") => ({
    position,
    tier: "B" as const,
    confidence: 70,
    reasoning,
  });

  describe("happy path", () => {
    it("returns input unchanged when Claude behaves (exact count, in order)", () => {
      const rankings = [card(1), card(2), card(3)];
      expect(
        sanitizeRankings({ rankings, indexKey: "position", expectedCount: 3 }),
      ).toEqual(rankings);
    });

    it("sorts out-of-order entries ascending by index", () => {
      const result = sanitizeRankings({
        rankings: [card(3), card(1), card(2)],
        indexKey: "position",
        expectedCount: 3,
      });
      expect(result.map((r) => r.position)).toEqual([1, 2, 3]);
    });
  });

  describe("#54 observed drift cases", () => {
    it("drops a position-0 pick summary entry (card_reward 3-item case)", () => {
      // The exact shape the user hit: Claude added a `position: 0` ranking
      // with reasoning "PICK Twin Strike — ..." on top of the real 3.
      const rankings = [
        card(1, "2-cost exhaust"),
        card(2, "double damage"),
        card(3, "random top-deck"),
        { ...card(0), tier: "S" as const, reasoning: "PICK Twin Strike — ..." },
      ];
      const result = sanitizeRankings({
        rankings,
        indexKey: "position",
        expectedCount: 3,
      });
      expect(result.map((r) => r.position)).toEqual([1, 2, 3]);
      expect(result.every((r) => !r.reasoning.startsWith("PICK"))).toBe(true);
    });

    it("drops an out-of-range placeholder entry (shop 12-item case)", () => {
      // Claude added `{ position: 13, ..., reasoning: "Placeholder for schema
      // validation; not a real shop item." }` on top of the real 12.
      const rankings = [
        ...Array.from({ length: 12 }, (_, i) => card(i + 1)),
        { ...card(13), tier: "F" as const, reasoning: "Placeholder for schema validation; not a real shop item." },
      ];
      const result = sanitizeRankings({
        rankings,
        indexKey: "position",
        expectedCount: 12,
      });
      expect(result.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(result.find((r) => r.reasoning.includes("Placeholder"))).toBeUndefined();
    });

    it("drops both drift patterns in the same response", () => {
      const rankings = [
        { ...card(0), reasoning: "summary" },
        card(1),
        card(2),
        card(3),
        { ...card(4), reasoning: "placeholder" },
      ];
      const result = sanitizeRankings({
        rankings,
        indexKey: "position",
        expectedCount: 3,
      });
      expect(result.map((r) => r.position)).toEqual([1, 2, 3]);
    });
  });

  describe("invalid indices", () => {
    it("drops negative indices", () => {
      const result = sanitizeRankings({
        rankings: [card(-1), card(1), card(2)],
        indexKey: "position",
        expectedCount: 2,
      });
      expect(result.map((r) => r.position)).toEqual([1, 2]);
    });

    it("drops non-integer (decimal) indices", () => {
      const result = sanitizeRankings({
        rankings: [card(1.5), card(1), card(2)],
        indexKey: "position",
        expectedCount: 2,
      });
      expect(result.map((r) => r.position)).toEqual([1, 2]);
    });

    it("drops NaN and Infinity indices", () => {
      const result = sanitizeRankings({
        rankings: [card(NaN), card(Infinity), card(1), card(2)],
        indexKey: "position",
        expectedCount: 2,
      });
      expect(result.map((r) => r.position)).toEqual([1, 2]);
    });

    it("drops indices above expectedCount", () => {
      const result = sanitizeRankings({
        rankings: [card(1), card(2), card(3), card(4), card(5)],
        indexKey: "position",
        expectedCount: 3,
      });
      expect(result.map((r) => r.position)).toEqual([1, 2, 3]);
    });
  });

  describe("duplicates", () => {
    it("keeps the first occurrence when Claude returns duplicates", () => {
      const rankings = [
        { ...card(1), reasoning: "first version" },
        { ...card(2), reasoning: "correct" },
        { ...card(1), reasoning: "second version" },
      ];
      const result = sanitizeRankings({
        rankings,
        indexKey: "position",
        expectedCount: 2,
      });
      expect(result.map((r) => r.position)).toEqual([1, 2]);
      expect(result[0].reasoning).toBe("first version");
    });
  });

  describe("missing entries", () => {
    it("returns fewer than expectedCount when Claude genuinely skipped entries (caller decides what to do)", () => {
      // This is the case the caller should treat as a 502 — we return the
      // best we can, but the length mismatch is a real failure.
      const result = sanitizeRankings({
        rankings: [card(1), card(3)],
        indexKey: "position",
        expectedCount: 3,
      });
      expect(result.map((r) => r.position)).toEqual([1, 3]);
      expect(result.length).toBe(2); // caller will see 2 !== 3 and return 502
    });

    it("returns empty array for empty input", () => {
      expect(
        sanitizeRankings({ rankings: [], indexKey: "position", expectedCount: 3 }),
      ).toEqual([]);
    });
  });

  describe("indexKey variants", () => {
    it("works with option_index for map eval rankings", () => {
      const mapEntry = (option_index: number) => ({
        option_index,
        node_type: "monster",
        tier: "A" as const,
        confidence: 80,
        reasoning: "ok",
      });
      const result = sanitizeRankings({
        rankings: [mapEntry(2), mapEntry(1), { ...mapEntry(0), reasoning: "summary" }],
        indexKey: "option_index",
        expectedCount: 2,
      });
      expect(result.map((r) => r.option_index)).toEqual([1, 2]);
    });
  });
});
