import { describe, it, expect } from "vitest";
import { matchByFilename } from "./filename-match";

const candidates = [
  { id: "ADRENALINE", name: "Adrenaline" },
  { id: "CALCULATED_GAMBLE", name: "Calculated Gamble" },
  { id: "WELL_LAID_PLANS", name: "Well-Laid Plans" },
  { id: "TOOLS_OF_THE_TRADE", name: "Tools of the Trade" },
  { id: "HAZE", name: "Haze" },
  { id: "AS", name: "As" }, // too short — should never match
];

describe("matchByFilename", () => {
  it("matches tiermaker's doubled-name pattern", () => {
    const m = matchByFilename(
      "https://tiermaker.com/x/adrenalineadrenaline.png",
      candidates,
    );
    expect(m?.candidate.id).toBe("ADRENALINE");
  });

  it("matches multi-word names ignoring punctuation", () => {
    const m = matchByFilename("https://x/welllaidplanswell-laidplans.png", candidates);
    expect(m?.candidate.id).toBe("WELL_LAID_PLANS");
  });

  it("prefers the longest-matching candidate", () => {
    // Filename contains both "haze" and "calculatedgamble" — longer wins.
    const m = matchByFilename(
      "https://x/calculatedgambleandhaze.png",
      candidates,
    );
    expect(m?.candidate.id).toBe("CALCULATED_GAMBLE");
  });

  it("ignores candidates shorter than 3 chars", () => {
    const m = matchByFilename("https://x/asasasas.png", candidates);
    expect(m).toBeNull();
  });

  it("returns null for unrelated filenames", () => {
    const m = matchByFilename(
      "https://x/zzzzz-1234567random.png",
      candidates,
    );
    expect(m).toBeNull();
  });

  it("handles filenames without extensions", () => {
    const m = matchByFilename("https://x/haze", candidates);
    expect(m?.candidate.id).toBe("HAZE");
  });
});
