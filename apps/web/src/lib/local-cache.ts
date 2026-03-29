/**
 * Typed localStorage cache with key-based invalidation.
 * Stores a single cached value per key — new value replaces old.
 */

interface CacheEntry<T> {
  key: string;
  data: T;
}

export function getCached<T>(storageKey: string, cacheKey: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return null;
    const entry: CacheEntry<T> = JSON.parse(stored);
    return entry.key === cacheKey ? entry.data : null;
  } catch {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[Cache] Failed to read ${storageKey}`);
    }
    return null;
  }
}

export function setCache<T>(
  storageKey: string,
  cacheKey: string,
  data: T
): void {
  if (typeof window === "undefined") return;
  try {
    const entry: CacheEntry<T> = { key: cacheKey, data };
    localStorage.setItem(storageKey, JSON.stringify(entry));
  } catch {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[Cache] Failed to write ${storageKey}`);
    }
  }
}
