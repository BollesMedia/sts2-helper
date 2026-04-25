import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { computeDhash, hammingDistance, findNearest } from "./dhash";

function gradientPng(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.floor((x / width) * 255);
      const i = (y * width + x) * 3;
      raw[i] = raw[i + 1] = raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe("computeDhash", () => {
  it("is deterministic", async () => {
    const img = await gradientPng(64, 64);
    const a = await computeDhash(img);
    const b = await computeDhash(img);
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it("is stable across resizes of the same image", async () => {
    const big = await gradientPng(512, 512);
    const small = await sharp(big).resize(128, 128).toBuffer();
    const a = await computeDhash(big);
    const b = await computeDhash(small);
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(4);
  });

  it("distinguishes different images", async () => {
    // Forward vs reversed horizontal gradient: every adjacent-pixel comparison
    // flips, so the two hashes should be exact complements (64-bit Hamming).
    const forward = await gradientPng(64, 64);
    const reversed = await sharp(forward).flop().toBuffer();
    const a = await computeDhash(forward);
    const b = await computeDhash(reversed);
    expect(hammingDistance(a, b)).toBeGreaterThan(10);
  });
});

describe("hammingDistance", () => {
  it("returns 0 for identical hashes", () => {
    expect(hammingDistance("ffff0000ffff0000", "ffff0000ffff0000")).toBe(0);
  });

  it("returns full bit count for complementary hashes", () => {
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
  });

  it("throws on length mismatch", () => {
    expect(() => hammingDistance("abc", "abcd")).toThrow();
  });
});

describe("findNearest", () => {
  const candidates = [
    { id: "A", hash: "0000000000000000" },
    { id: "B", hash: "ffffffff00000000" },
    { id: "C", hash: "00000000ffffffff" },
  ];

  it("returns the closest candidate within threshold", () => {
    const m = findNearest("0000000000000001", candidates, 10);
    expect(m?.candidate.id).toBe("A");
    expect(m?.distance).toBe(1);
  });

  it("returns null when nothing is within threshold", () => {
    const m = findNearest("aaaaaaaaaaaaaaaa", candidates, 5);
    expect(m).toBeNull();
  });

  it("short-circuits on exact match", () => {
    const m = findNearest("ffffffff00000000", candidates, 10);
    expect(m?.candidate.id).toBe("B");
    expect(m?.distance).toBe(0);
  });
});
