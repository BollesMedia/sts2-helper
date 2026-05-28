import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mobalyticsAdapter } from "./mobalytics";
import { resolveAdapter } from "./registry";

const FIXTURE_URL = "https://mobalytics.gg/sts2/tier-lists";
const FIXTURE_HTML = readFileSync(
  join(__dirname, "__fixtures__/mobalytics-silent.html"),
  "utf8",
);

describe("mobalyticsAdapter.canHandle", () => {
  it("accepts mobalytics.gg URLs", () => {
    expect(mobalyticsAdapter.canHandle(FIXTURE_URL)).toBe(true);
    expect(mobalyticsAdapter.canHandle("https://www.mobalytics.gg/")).toBe(true);
  });

  it("rejects other hosts", () => {
    expect(mobalyticsAdapter.canHandle("https://tiermaker.com/x")).toBe(false);
  });
});

describe("resolveAdapter", () => {
  it("returns mobalytics adapter for mobalytics URLs", () => {
    expect(resolveAdapter(FIXTURE_URL)?.id).toBe("mobalytics");
  });
});

describe("mobalyticsAdapter.parse", () => {
  const result = mobalyticsAdapter.parse(FIXTURE_HTML, FIXTURE_URL);

  it("parses single-character section into sections[0]", () => {
    expect(result.adapterId).toBe("mobalytics");
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].detectedCharacter).toBe(null);
    expect(result.sections[0].scaleType).toBe("letter_6");
    expect(result.sections[0].cards.length).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });

  it("buckets each image under its preceding tier label", () => {
    const sCards = result.sections[0].cards.filter((c) => c.tier === "S");
    const aCards = result.sections[0].cards.filter((c) => c.tier === "A");
    const dCards = result.sections[0].cards.filter((c) => c.tier === "D");
    expect(sCards).toHaveLength(3);
    expect(aCards).toHaveLength(2);
    expect(dCards).toHaveLength(2);
  });

  it("derives a human-readable name hint from the slug", () => {
    const wlp = result.sections[0].cards.find((c) => c.name === "Well Laid Plans");
    expect(wlp?.tier).toBe("S");
    expect(wlp?.imageUrl).toContain("well-laid-plans.webp");
  });

  it("keeps raw CDN URLs (so the preview can render the thumbnail)", () => {
    for (const c of result.sections[0].cards) {
      expect(c.imageUrl).toMatch(/^https:\/\/cdn\.mobalytics\.gg/);
    }
  });

  it("ignores non-mobalytics images", () => {
    const extra = mobalyticsAdapter.parse(
      `<div style="--x-backgroundColor:x">S</div>
       <img src="https://evil.example/x.png">
       <img src="https://cdn.mobalytics.gg/ok.webp">`,
      FIXTURE_URL,
    );
    expect(extra.sections).toHaveLength(1);
    expect(extra.sections[0].cards).toHaveLength(1);
    expect(extra.sections[0].cards[0].imageUrl).toContain("cdn.mobalytics.gg");
  });

  it("warns when no mobalytics images are present", () => {
    const empty = mobalyticsAdapter.parse("<div>nope</div>", FIXTURE_URL);
    expect(empty.sections[0].cards).toHaveLength(0);
    expect(empty.sections[0].warnings.length).toBeGreaterThan(0);
  });
});
