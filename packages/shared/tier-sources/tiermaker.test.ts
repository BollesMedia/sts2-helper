import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tiermakerAdapter } from "./tiermaker";
import { resolveAdapter } from "./registry";

const FIXTURE_URL =
  "https://tiermaker.com/categories/card-games/slay-the-spire-v0982-19235240";
const FIXTURE_HTML = readFileSync(
  join(__dirname, "__fixtures__/tiermaker-silent-19235240.html"),
  "utf8",
);

describe("tiermakerAdapter.canHandle", () => {
  it("accepts tiermaker.com URLs", () => {
    expect(tiermakerAdapter.canHandle(FIXTURE_URL)).toBe(true);
    expect(tiermakerAdapter.canHandle("https://www.tiermaker.com/foo")).toBe(true);
  });

  it("rejects other hosts", () => {
    expect(tiermakerAdapter.canHandle("https://reddit.com/r/slaythespire")).toBe(false);
    expect(tiermakerAdapter.canHandle("not a url")).toBe(false);
  });
});

describe("resolveAdapter", () => {
  it("returns tiermaker adapter for tiermaker URLs", () => {
    expect(resolveAdapter(FIXTURE_URL)?.id).toBe("tiermaker");
  });

  it("returns null when no adapter matches", () => {
    expect(resolveAdapter("https://example.com")).toBeNull();
  });
});

describe("tiermakerAdapter.parse", () => {
  const result = tiermakerAdapter.parse(FIXTURE_HTML, FIXTURE_URL);

  it("extracts tier rows in top-to-bottom order", () => {
    const tierOrder = [...new Set(result.cards.map((c) => c.tier))];
    expect(tierOrder).toEqual(["S", "A", "B", "C"]);
  });

  it("extracts every card's imageUrl and externalId", () => {
    const sCards = result.cards.filter((c) => c.tier === "S");
    expect(sCards).toHaveLength(6);
    expect(sCards[0]).toEqual({
      tier: "S",
      externalId: "5",
      imageUrl:
        "https://tiermaker.com/images/media/template_images/2024/19235240/slay-the-spire-v0982-19235240/adrenalineadrenaline.png",
    });
  });

  it("decodes HTML entities in src attributes", () => {
    for (const card of result.cards) {
      expect(card.imageUrl).not.toContain("&quot;");
      expect(card.imageUrl).toMatch(/^https:\/\//);
    }
  });

  it("returns letter_6 scale with no 7-letter override for this fixture", () => {
    expect(result.scaleType).toBe("letter_6");
    expect(result.scaleConfig).toBeUndefined();
  });

  it("applies 7-letter override when E and F are both present", () => {
    const sevenLetter = tiermakerAdapter.parse(
      `<div class="tier-row"><div class="label-holder"><span class="label">S</span></div><div class="tier sort"><div class="character" id="1"><img src="/a.png"></div></div></div>
       <div class="tier-row"><div class="label-holder"><span class="label">E</span></div><div class="tier sort"><div class="character" id="2"><img src="/b.png"></div></div></div>
       <div class="tier-row"><div class="label-holder"><span class="label">F</span></div><div class="tier sort"><div class="character" id="3"><img src="/c.png"></div></div></div>`,
      FIXTURE_URL,
    );
    expect(sevenLetter.scaleConfig?.map.S).toBe(6);
    expect(sevenLetter.scaleConfig?.map.E).toBeGreaterThan(1);
    expect(sevenLetter.scaleConfig?.map.F).toBe(1);
  });

  it("warns when no tier rows are found", () => {
    const empty = tiermakerAdapter.parse("<p>not a tier list</p>", FIXTURE_URL);
    expect(empty.cards).toHaveLength(0);
    expect(empty.warnings.length).toBeGreaterThan(0);
  });

  it("always returns null detectedCharacter (admin sets via form)", () => {
    expect(result.detectedCharacter).toBeNull();
  });
});
