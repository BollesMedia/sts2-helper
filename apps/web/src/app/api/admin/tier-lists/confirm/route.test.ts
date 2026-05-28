/**
 * @vitest-environment node
 *
 * Schema-level tests for `/api/admin/tier-lists/confirm`.
 * The full route handler depends on auth + Supabase which are out of scope
 * here — these tests cover the zod contract for the sections[] payload shape
 * and backwards-compat with the legacy { list, entries } single-section shape.
 */
import { describe, it, expect } from "vitest";
import { confirmSchema } from "./route";

const baseSource = {
  id: "src-1",
  author: "TestAuthor",
  source_type: "website" as const,
  source_url: "https://example.com",
  trust_weight: 1.0,
  scale_type: "letter_6" as const,
};

const baseList = {
  game_version: "v1.0",
  published_at: "2024-01-01",
  character: null,
};

const baseEntries = [
  { card_id: "strike_r", raw_tier: "A" },
  { card_id: "defend_r", raw_tier: "B" },
];

const baseSection = { list: baseList, entries: baseEntries };

describe("confirmSchema — sections[] payload", () => {
  it("accepts a multi-section payload with 3 sections", () => {
    const sections = [
      { list: { ...baseList, character: "ironclad" }, entries: baseEntries },
      { list: { ...baseList, character: "silent" }, entries: baseEntries },
      { list: { ...baseList, character: "defect" }, entries: baseEntries },
    ];
    const result = confirmSchema.safeParse({
      imageUrl: null,
      ingestionMethod: "scraped",
      source: baseSource,
      sections,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sections).toHaveLength(3);
    }
  });

  it("accepts a single-section sections[] payload", () => {
    const result = confirmSchema.safeParse({
      imageUrl: null,
      ingestionMethod: "scraped",
      source: baseSource,
      sections: [baseSection],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a payload with neither sections[] nor (list + entries)", () => {
    const result = confirmSchema.safeParse({
      imageUrl: null,
      ingestionMethod: "scraped",
      source: baseSource,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload with sections[] where an entry is missing card_id", () => {
    const result = confirmSchema.safeParse({
      imageUrl: null,
      ingestionMethod: "scraped",
      source: baseSource,
      sections: [
        {
          list: baseList,
          entries: [{ raw_tier: "A" }], // missing card_id
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("confirmSchema — legacy { list, entries } payload (backwards-compat)", () => {
  it("accepts the legacy single-shape payload", () => {
    const result = confirmSchema.safeParse({
      imageUrl: null,
      ingestionMethod: "scraped",
      source: baseSource,
      list: baseList,
      entries: baseEntries,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.list).toEqual(baseList);
      expect(result.data.entries).toHaveLength(2);
      // sections is not present in legacy shape
      expect(result.data.sections).toBeUndefined();
    }
  });

  it("accepts a payload with both sections[] and legacy fields (sections takes precedence in handler)", () => {
    const result = confirmSchema.safeParse({
      imageUrl: null,
      ingestionMethod: "scraped",
      source: baseSource,
      sections: [baseSection],
      list: baseList,
      entries: baseEntries,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a payload with list but no entries", () => {
    const result = confirmSchema.safeParse({
      imageUrl: null,
      ingestionMethod: "scraped",
      source: baseSource,
      list: baseList,
      // entries omitted
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload with entries but no list", () => {
    const result = confirmSchema.safeParse({
      imageUrl: null,
      ingestionMethod: "scraped",
      source: baseSource,
      entries: baseEntries,
      // list omitted
    });
    expect(result.success).toBe(false);
  });
});

describe("confirmSchema — imageUrl refinement", () => {
  it("requires imageUrl for vision_llm ingestion", () => {
    const result = confirmSchema.safeParse({
      imageUrl: null,
      ingestionMethod: "vision_llm",
      source: baseSource,
      sections: [baseSection],
    });
    expect(result.success).toBe(false);
  });

  it("allows null imageUrl for scraped ingestion", () => {
    const result = confirmSchema.safeParse({
      imageUrl: null,
      ingestionMethod: "scraped",
      source: baseSource,
      sections: [baseSection],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a non-null imageUrl for vision_llm ingestion", () => {
    const result = confirmSchema.safeParse({
      imageUrl: "https://example.com/img.png",
      ingestionMethod: "vision_llm",
      source: baseSource,
      sections: [baseSection],
    });
    expect(result.success).toBe(true);
  });
});
