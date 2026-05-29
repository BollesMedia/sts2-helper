import { describe, it, expect } from "vitest";
import { evaluateGate } from "./quality-gate";

const base = {
  priorCharacters: ["ironclad", "silent"],
  priorEntryCountByCharacter: new Map<string | null, number>([
    ["ironclad", 100],
    ["silent", 100],
  ]),
};

describe("evaluateGate", () => {
  it("passes when all sections clean and coverage intact", () => {
    const r = evaluateGate(
      [
        {
          detectedCharacter: "ironclad",
          matchedCount: 99,
          totalCount: 100,
          warnings: [],
        },
        {
          detectedCharacter: "silent",
          matchedCount: 100,
          totalCount: 100,
          warnings: [],
        },
      ],
      base,
    );
    expect(r.perSection.every((s) => s.passed)).toBe(true);
    expect(r.sourceLevel.coverage.passed).toBe(true);
  });

  it("queues a section below 95% match rate", () => {
    const r = evaluateGate(
      [
        {
          detectedCharacter: "ironclad",
          matchedCount: 78,
          totalCount: 100,
          warnings: [],
        },
        {
          detectedCharacter: "silent",
          matchedCount: 100,
          totalCount: 100,
          warnings: [],
        },
      ],
      base,
    );
    expect(r.perSection.find((s) => s.detectedCharacter === "ironclad")!.passed).toBe(
      false,
    );
    expect(r.perSection.find((s) => s.detectedCharacter === "silent")!.passed).toBe(true);
  });

  it("entry-count delta floor: 20→18 (10% but only 2 cards) passes", () => {
    const small = {
      priorCharacters: ["defect"],
      priorEntryCountByCharacter: new Map<string | null, number>([["defect", 20]]),
    };
    const r = evaluateGate(
      [
        {
          detectedCharacter: "defect",
          matchedCount: 18,
          totalCount: 18,
          warnings: [],
        },
      ],
      small,
    );
    expect(r.perSection[0].passed).toBe(true);
  });

  it("entry-count delta beyond floor queues: 20→14 (6 cards, 30%)", () => {
    const small = {
      priorCharacters: ["defect"],
      priorEntryCountByCharacter: new Map<string | null, number>([["defect", 20]]),
    };
    const r = evaluateGate(
      [
        {
          detectedCharacter: "defect",
          matchedCount: 14,
          totalCount: 14,
          warnings: [],
        },
      ],
      small,
    );
    expect(r.perSection[0].passed).toBe(false);
  });

  it("warnings present → section fails", () => {
    const r = evaluateGate(
      [
        {
          detectedCharacter: "ironclad",
          matchedCount: 100,
          totalCount: 100,
          warnings: ["bad"],
        },
        {
          detectedCharacter: "silent",
          matchedCount: 100,
          totalCount: 100,
          warnings: [],
        },
      ],
      base,
    );
    expect(r.perSection.find((s) => s.detectedCharacter === "ironclad")!.passed).toBe(
      false,
    );
  });

  it("coverage fails when a prior character is missing from this run", () => {
    const r = evaluateGate(
      [
        {
          detectedCharacter: "ironclad",
          matchedCount: 100,
          totalCount: 100,
          warnings: [],
        },
      ],
      base,
    );
    expect(r.sourceLevel.coverage.passed).toBe(false);
  });

  it("no prior entry count (new character) skips the delta check", () => {
    const r2 = evaluateGate(
      [
        {
          detectedCharacter: "ironclad",
          matchedCount: 100,
          totalCount: 100,
          warnings: [],
        },
        {
          detectedCharacter: "silent",
          matchedCount: 100,
          totalCount: 100,
          warnings: [],
        },
        {
          detectedCharacter: "defect",
          matchedCount: 40,
          totalCount: 40,
          warnings: [],
        },
      ],
      base,
    );
    expect(r2.perSection.find((s) => s.detectedCharacter === "defect")!.passed).toBe(true);
  });
});
