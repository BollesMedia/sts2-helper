import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { slaythetierlistAdapter } from "./slaythetierlist";
import { resolveAdapter } from "./registry";

const FIXTURE_URL = "https://slaythetierlist.com/silent";
const FIXTURE_HTML = readFileSync(
  join(__dirname, "__fixtures__/slaythetierlist-silent.html"),
  "utf8",
);

describe("slaythetierlistAdapter.canHandle", () => {
  it("accepts slaythetierlist.com URLs", () => {
    expect(slaythetierlistAdapter.canHandle(FIXTURE_URL)).toBe(true);
    expect(slaythetierlistAdapter.canHandle("https://www.slaythetierlist.com/")).toBe(true);
  });

  it("rejects other hosts", () => {
    expect(slaythetierlistAdapter.canHandle("https://tiermaker.com/x")).toBe(false);
  });
});

describe("resolveAdapter", () => {
  it("returns slaythetierlist adapter for slaythetierlist URLs", () => {
    expect(resolveAdapter(FIXTURE_URL)?.id).toBe("slaythetierlist");
  });
});

describe("slaythetierlistAdapter.parse", () => {
  const result = slaythetierlistAdapter.parse(FIXTURE_HTML, FIXTURE_URL);

  it("detects the character from the panel id", () => {
    expect(result.detectedCharacter).toBe("silent");
  });

  it("extracts tier rows using data-tier attribute", () => {
    const tierOrder = [...new Set(result.cards.map((c) => c.tier))];
    expect(tierOrder).toEqual(["S", "A", "D"]);
  });

  it("extracts name, slug, and imageUrl per card", () => {
    const adrenaline = result.cards.find((c) => c.name === "Adrenaline");
    expect(adrenaline).toMatchObject({
      tier: "S",
      name: "Adrenaline",
      externalId: "adrenaline",
      imageUrl: "https://sts2json.untapped.gg/art/card_portraits/silent/adrenaline.png",
    });
  });

  it("preserves hyphenated alt text (Well-Laid Plans)", () => {
    const wlp = result.cards.find((c) => c.name === "Well-Laid Plans");
    expect(wlp?.imageUrl).toContain("well_laid_plans.png");
  });

  it("warns when no tier rows are present", () => {
    const empty = slaythetierlistAdapter.parse("<div>nope</div>", FIXTURE_URL);
    expect(empty.cards).toHaveLength(0);
    expect(empty.warnings.length).toBeGreaterThan(0);
  });
});
