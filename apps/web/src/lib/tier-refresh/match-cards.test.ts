/**
 * @vitest-environment node
 *
 * Unit tests for the extracted `matchSection` module (AR-6). `matchSection`
 * was lifted verbatim out of `/api/admin/tier-lists/scrape/route.ts` so the
 * cron auto-refresh path can reuse it; these tests pin its behaviour
 * independent of the route handler.
 *
 * The matcher calls `fetchAndHashAll` (network image fetch + dHash) for its
 * pHash tier, so the whole `@/lib/image-hash` barrel is mocked to keep the
 * test offline. The exercised path is Tier 0 (adapter-declared name): the
 * candidate-name lookup is built inside `match-cards.ts` from the candidate
 * list, so an exact name match resolves a `cardId` without any real hash.
 */
import { describe, it, expect, vi } from "vitest";
import { matchSection, type CardRow } from "./match-cards";
import type { ScrapedSection } from "@sts2/shared/tier-sources";

// Mock the image-hash barrel. `fetchAndHashAll` returns a failed hash so the
// pHash tier never resolves — only the name/filename path can match.
// `matchByFilename`/`findNearest` return null; `filenameHint` echoes a stub so
// the unmatched-name fallback is deterministic.
vi.mock("@/lib/image-hash", () => ({
  fetchAndHashAll: vi.fn(async (urls: readonly string[]) =>
    urls.map((imageUrl) => ({ imageUrl, hash: null, error: "stub: no fetch" })),
  ),
  matchByFilename: vi.fn(() => null),
  findNearest: vi.fn(() => null),
  filenameHint: vi.fn(() => "Hint Name"),
}));

const candidates: CardRow[] = [
  { id: "strike_r", name: "Strike", color: "ironclad", phash: null },
  { id: "defend_r", name: "Defend", color: "ironclad", phash: null },
];

describe("matchSection", () => {
  it("resolves a cardId via the adapter-declared name (Tier 0), no real hash", async () => {
    const section: ScrapedSection = {
      detectedCharacter: "ironclad",
      scaleType: "letter_6",
      cards: [{ tier: "A", imageUrl: "https://host/strike.png", name: "Strike" }],
      warnings: [],
    };

    const { matched, warnings } = await matchSection(
      section,
      "ironclad",
      candidates,
      "host",
    );

    expect(matched).toHaveLength(1);
    expect(matched[0].cardId).toBe("strike_r");
    expect(matched[0].source).toBe("alt");
    expect(matched[0].confidence).toBe(1);
    // Matched via name, so the failed-hash error is never surfaced.
    expect(warnings).toEqual([]);
  });

  it("returns empty matched + warnings for a section with no cards (no network)", async () => {
    const section: ScrapedSection = {
      detectedCharacter: null,
      scaleType: "letter_6",
      cards: [],
      warnings: [],
    };

    const result = await matchSection(section, null, candidates, "host");

    expect(result).toEqual({ matched: [], warnings: [] });
  });
});
