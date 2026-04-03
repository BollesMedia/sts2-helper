import { createClient } from "@sts2/shared/supabase/client";

const cache = new Map<string, string>();
let allLoaded = false;
let loading = false;

/**
 * Load all relic descriptions from Supabase into an in-memory cache.
 * Call once at startup — subsequent lookups are instant.
 */
export function initRelicLookup(): void {
  if (allLoaded || loading) return;
  loading = true;

  const supabase = createClient();
  supabase
    .from("relics")
    .select("name, description")
    .then(({ data }) => {
      if (data) {
        for (const r of data) {
          cache.set(r.name.toLowerCase(), r.description);
        }
      }
      allLoaded = true;
      loading = false;
    })
    .then(undefined, () => {
      loading = false;
    });
}

/**
 * Look up a relic description by name. Returns null if not cached yet.
 */
export function getRelicDescription(name: string): string | null {
  return cache.get(name.toLowerCase()) ?? null;
}
