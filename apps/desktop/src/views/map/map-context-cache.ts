/**
 * Caches the last known map path context for use by other evaluations
 * (e.g., rest site needs to know if an elite is coming).
 */

const STORAGE_KEY = "sts2-map-context";

interface MapContext {
  floor: number;
  nextNodeTypes: string[];
  floorsToNextBoss: number;
  hasEliteAhead: boolean;
  hasRestAhead: boolean;
  hasShopAhead: boolean;
}

export function saveMapContext(ctx: MapContext) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  } catch {
    // ignore
  }
}

export function loadMapContext(): MapContext | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}
