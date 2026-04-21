import { computeDhash } from "./dhash";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface FetchHashResult {
  imageUrl: string;
  hash: string | null;
  error?: string;
}

/**
 * Fetch an image URL and compute its dHash. Returns `hash: null` with an
 * error message when the fetch or decode fails, so callers can surface
 * per-card failures without aborting the whole batch.
 */
export async function fetchAndHash(
  imageUrl: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<FetchHashResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(imageUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { imageUrl, hash: null, error: `HTTP ${res.status}` };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const hash = await computeDhash(bytes);
    return { imageUrl, hash };
  } catch (err) {
    return {
      imageUrl,
      hash: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Batched parallel hashing with a concurrency cap. */
export async function fetchAndHashAll(
  urls: readonly string[],
  concurrency: number = 8,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<FetchHashResult[]> {
  const out: FetchHashResult[] = new Array(urls.length);
  let cursor = 0;
  async function worker() {
    while (cursor < urls.length) {
      const i = cursor++;
      out[i] = await fetchAndHash(urls[i], timeoutMs);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, worker);
  await Promise.all(workers);
  return out;
}
