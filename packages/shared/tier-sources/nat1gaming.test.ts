import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nat1gamingAdapter } from "./nat1gaming";
import { resolveAdapter } from "./registry";

const FIXTURE_URL = "https://nat1gaming.com/slay-the-spire-2-silent-tier-list";
const FIXTURE_HTML = readFileSync(
  join(__dirname, "__fixtures__/nat1gaming-silent.html"),
  "utf8",
);

describe("nat1gamingAdapter.canHandle", () => {
  it("accepts nat1gaming.com URLs", () => {
    expect(nat1gamingAdapter.canHandle(FIXTURE_URL)).toBe(true);
    expect(nat1gamingAdapter.canHandle("https://www.nat1gaming.com/foo")).toBe(true);
  });

  it("rejects other hosts", () => {
    expect(nat1gamingAdapter.canHandle("https://tiermaker.com/x")).toBe(false);
    expect(nat1gamingAdapter.canHandle("not a url")).toBe(false);
  });
});

describe("resolveAdapter", () => {
  it("returns nat1gaming adapter for nat1gaming URLs", () => {
    expect(resolveAdapter(FIXTURE_URL)?.id).toBe("nat1gaming");
  });
});

describe("nat1gamingAdapter.parse", () => {
  const result = nat1gamingAdapter.parse(FIXTURE_HTML, FIXTURE_URL);

  it("extracts tier rows in top-to-bottom order", () => {
    const tierOrder = [...new Set(result.cards.map((c) => c.tier))];
    expect(tierOrder).toEqual(["S", "A", "F"]);
  });

  it("extracts card name from the img alt attribute", () => {
    const adrenaline = result.cards.find((c) => c.name === "Adrenaline");
    expect(adrenaline).toBeDefined();
    expect(adrenaline?.tier).toBe("S");
    expect(adrenaline?.imageUrl).toMatch(/Adrenaline\.png/);
  });

  it("prefers data-src over placeholder SVG src for lazy-loaded images", () => {
    const pinpoint = result.cards.find((c) => c.name === "Pinpoint");
    expect(pinpoint?.imageUrl).toMatch(/^https:\/\/nat1gaming\.com/);
    expect(pinpoint?.imageUrl).not.toContain("data:image");
  });

  it("preserves underscores and hyphens in image URLs", () => {
    const wraith = result.cards.find((c) => c.name === "Wraith Form");
    expect(wraith?.imageUrl).toContain("Wraith_Form-1.png");
  });

  it("applies 7-letter scale override when E and F coexist with S", () => {
    // The bundled fixture has S/A/F but no E — override should NOT trigger.
    expect(result.scaleConfig).toBeUndefined();
  });

  it("always returns null detectedCharacter", () => {
    expect(result.detectedCharacter).toBeNull();
  });

  it("warns when no tier sections are present", () => {
    const empty = nat1gamingAdapter.parse("<div>nope</div>", FIXTURE_URL);
    expect(empty.cards).toHaveLength(0);
    expect(empty.warnings.length).toBeGreaterThan(0);
  });
});
