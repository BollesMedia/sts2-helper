import sharp from "sharp";

/**
 * 64-bit difference hash (dHash). Robust to resizing, minor compression, and
 * slight color shifts — ideal for matching tiermaker card thumbnails back to
 * our card DB art (same source image, different sizes).
 *
 * Algorithm: resize to 9x8 greyscale, compare adjacent horizontal pixels row
 * by row. 8 comparisons × 8 rows = 64 bits, encoded as 16 hex chars.
 */
export async function computeDhash(buffer: Buffer | Uint8Array): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Build two 32-bit halves and join — avoids BigInt literals (tsconfig target
  // is ES2017) while still producing the same 16-char hex representation.
  let hi = 0;
  let lo = 0;
  for (let bit = 0; bit < 64; bit++) {
    const row = Math.floor(bit / 8);
    const col = bit % 8;
    const left = data[row * 9 + col];
    const right = data[row * 9 + col + 1];
    const one = left > right ? 1 : 0;
    if (bit < 32) {
      hi = ((hi << 1) | one) >>> 0;
    } else {
      lo = ((lo << 1) | one) >>> 0;
    }
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

const HASH_HEX_RE = /^[0-9a-f]{16}$/;

export function hammingDistance(a: string, b: string): number {
  if (!HASH_HEX_RE.test(a) || !HASH_HEX_RE.test(b)) {
    throw new Error(`hash must be 16 lowercase hex chars: got "${a}" and "${b}"`);
  }
  // Split into two 32-bit halves so we can XOR without BigInt. Variable names
  // reflect position in the hex string: `first` = chars 0-7 (high 32 bits of
  // the 64-bit hash), `second` = chars 8-15 (low 32 bits).
  const aFirst = parseInt(a.slice(0, 8), 16);
  const aSecond = parseInt(a.slice(8, 16), 16);
  const bFirst = parseInt(b.slice(0, 8), 16);
  const bSecond = parseInt(b.slice(8, 16), 16);
  return popcount32(aFirst ^ bFirst) + popcount32(aSecond ^ bSecond);
}

function popcount32(n: number): number {
  // eslint-disable-next-line no-param-reassign
  n = n - ((n >>> 1) & 0x55555555);
  // eslint-disable-next-line no-param-reassign
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export interface HashCandidate {
  id: string;
  hash: string;
}

export interface NearestMatch<T> {
  candidate: T;
  distance: number;
}

/**
 * Find the candidate whose hash has the smallest Hamming distance to `target`.
 * Returns null when no candidate is within `maxDistance` bits. On distance
 * ties, the candidate with the lexicographically smaller `id` wins — makes
 * the result stable across Supabase query runs (which have no ORDER BY).
 */
export function findNearest<T extends HashCandidate>(
  target: string,
  candidates: readonly T[],
  maxDistance: number,
): NearestMatch<T> | null {
  let best: NearestMatch<T> | null = null;
  for (const c of candidates) {
    const d = hammingDistance(target, c.hash);
    if (d > maxDistance) continue;
    if (!best) {
      best = { candidate: c, distance: d };
    } else if (d < best.distance) {
      best = { candidate: c, distance: d };
    } else if (d === best.distance && c.id < best.candidate.id) {
      best = { candidate: c, distance: d };
    }
    if (best.distance === 0 && c.id === best.candidate.id) break;
  }
  return best;
}
