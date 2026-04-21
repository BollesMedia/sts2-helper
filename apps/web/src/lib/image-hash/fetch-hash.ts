import { computeDhash } from "./dhash";
import { safeFetchImage, SafeFetchError, type SafeFetchOptions } from "./safe-fetch";

export interface FetchHashResult {
  imageUrl: string;
  hash: string | null;
  error?: string;
}

/**
 * Fetch an image URL and compute its dHash. Returns `hash: null` with an
 * error message when the fetch or decode fails, so callers can surface
 * per-card failures without aborting the whole batch.
 *
 * Uses safeFetchImage to block SSRF-style targets (private IPs, non-http
 * schemes, lying Content-Length, non-image responses).
 */
export async function fetchAndHash(
  imageUrl: string,
  opts: SafeFetchOptions = {},
): Promise<FetchHashResult> {
  try {
    const bytes = await safeFetchImage(imageUrl, opts);
    const hash = await computeDhash(bytes);
    return { imageUrl, hash };
  } catch (err) {
    const reason =
      err instanceof SafeFetchError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    return { imageUrl, hash: null, error: reason };
  }
}

/** Batched parallel hashing with a concurrency cap. */
export async function fetchAndHashAll(
  urls: readonly string[],
  concurrency: number = 8,
  opts: SafeFetchOptions = {},
): Promise<FetchHashResult[]> {
  const out: FetchHashResult[] = new Array(urls.length);
  let cursor = 0;
  // cursor++ is safe across workers because JS is single-threaded: the
  // post-increment completes before any other microtask runs.
  async function worker() {
    while (cursor < urls.length) {
      const i = cursor++;
      out[i] = await fetchAndHash(urls[i], opts);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, worker);
  await Promise.all(workers);
  return out;
}
