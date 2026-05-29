import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sts2companionAdapter } from "./sts2companion";
import { resolveAdapter } from "./registry";

const FIXTURE_URL = "https://www.sts2companion.com/tier-lists/defect";
const FIXTURE_HTML = readFileSync(
  join(__dirname, "__fixtures__/sts2companion-defect.html"),
  "utf8",
);

describe("sts2companionAdapter.canHandle", () => {
  it("accepts sts2companion.com URLs", () => {
    expect(sts2companionAdapter.canHandle(FIXTURE_URL)).toBe(true);
    expect(sts2companionAdapter.canHandle("https://sts2companion.com/foo")).toBe(true);
  });

  it("rejects other hosts", () => {
    expect(sts2companionAdapter.canHandle("https://tiermaker.com/x")).toBe(false);
  });
});

describe("resolveAdapter", () => {
  it("returns sts2companion adapter for sts2companion URLs", () => {
    expect(resolveAdapter(FIXTURE_URL)?.id).toBe("sts2companion");
  });
});

describe("sts2companionAdapter.parse", () => {
  const result = sts2companionAdapter.parse(FIXTURE_HTML, FIXTURE_URL);

  it("returns single section", () => {
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].cards.length).toBeGreaterThan(0);
  });

  it("detects character from URL path in section", () => {
    expect(result.sections[0].detectedCharacter).toBe("defect");
  });

  it("extracts every card with canonical id + name", () => {
    expect(result.sections[0].cards).toHaveLength(4);
    const zap = result.sections[0].cards.find((c) => c.externalId === "ZAP");
    expect(zap).toMatchObject({
      tier: "A",
      name: "Zap",
      externalId: "ZAP",
    });
  });

  it("absolutizes relative image URLs against spire-codex.com", () => {
    const zap = result.sections[0].cards.find((c) => c.externalId === "ZAP");
    expect(zap?.imageUrl).toBe("https://spire-codex.com/static/images/cards/zap.webp");
  });

  it("groups cards under their source tier label", () => {
    const tiers = [...new Set(result.sections[0].cards.map((c) => c.tier))];
    expect(tiers).toEqual(["S", "A", "D"]);
  });

  it("warns when no flight-stream chunks are present", () => {
    const empty = sts2companionAdapter.parse("<div>just dom</div>", FIXTURE_URL);
    expect(empty.sections[0].cards).toHaveLength(0);
    expect(empty.sections[0].warnings.length).toBeGreaterThan(0);
  });

  it("returns null character for URLs that don't match /tier-lists/<char>", () => {
    const other = sts2companionAdapter.parse(FIXTURE_HTML, "https://sts2companion.com/");
    expect(other.sections[0].detectedCharacter).toBeNull();
  });
});
