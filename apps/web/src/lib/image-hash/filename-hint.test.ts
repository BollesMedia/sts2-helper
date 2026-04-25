import { describe, it, expect } from "vitest";
import { filenameHint } from "./filename-hint";

describe("filenameHint", () => {
  it("undoubles tiermaker's exact-double pattern (single word)", () => {
    expect(filenameHint("https://x/adrenalineadrenaline.png")).toBe("Adrenaline");
  });

  it("undoubles tiermaker's hyphen-variant pattern", () => {
    // Uses hyphen from the second half, preserves it in the returned hint
    const hint = filenameHint("https://x/welllaidplanswell-laidplans.png");
    expect(hint.toLowerCase()).toContain("well");
    expect(hint.toLowerCase()).toContain("laid");
  });

  it("prettifies underscored nat1gaming filenames", () => {
    expect(filenameHint("https://x/Wraith_Form-1.png?v=1")).toBe("Wraith Form 1");
    expect(filenameHint("https://x/Fan_of_Knives.png")).toBe("Fan Of Knives");
  });

  it("returns empty string for empty input", () => {
    expect(filenameHint("")).toBe("");
  });

  it("strips .jpg/.png/.webp extensions", () => {
    expect(filenameHint("https://x/something.jpg")).toBe("Something");
    expect(filenameHint("https://x/path/Deep_Name.webp")).toBe("Deep Name");
  });
});
