/**
 * Backfill `cards.phash` by fetching each card's wiki full-card render and
 * computing a 64-bit dHash.
 *
 * Why the wiki, not `cards.image_url`?
 *   `image_url` points to Spire Codex's art-only crops (no frame, no text);
 *   community tier-list images (tiermaker.com, etc.) are full card renders.
 *   Hashing art-only images vs full renders gives ~30-bit Hamming noise and
 *   can't distinguish same-card from different-card matches. The wiki hosts
 *   full renders that track tiermaker's framing closely — same-card pairs
 *   land at 11–12 bits, different-card at 19–20.
 *
 * Idempotent: skips cards that already have a phash unless --force is passed.
 * Rate-limited to stay under slaythespire.wiki.gg's 429 threshold.
 *
 * Usage:
 *   pnpm tsx --env-file=../../.env.local apps/web/scripts/hash-card-images.ts
 *   pnpm tsx --env-file=../../.env.local apps/web/scripts/hash-card-images.ts --force
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAndHash } from "../src/lib/image-hash/fetch-hash";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — run via pnpm tsx --env-file=../../.env.local …",
  );
  process.exit(1);
}

const force = process.argv.includes("--force");

// slaythespire.wiki.gg rate-limits aggressively. Serial with a small delay
// plus one 429-aware retry gets through the full card set reliably.
const REQUEST_DELAY_MS = 500;
const RETRY_DELAY_MS = 3_000;

interface CardRow {
  id: string;
  name: string;
  color: string | null;
  image_url: string | null;
  phash: string | null;
  render_url: string | null;
}

/**
 * Build the wiki image URL for a card. Convention observed on
 * slaythespire.wiki.gg: `StS2_<TitleCaseColor>-<CamelCaseName>.png`.
 * Spaces stripped, hyphens preserved; apostrophes, commas, exclamation
 * marks, and other punctuation dropped (matches wiki's own page-title
 * slugification for cards like "BEGONE!" and "Decisions, Decisions").
 *
 * event/token/status cards are intentionally unsupported here — the wiki
 * uses different page-namespace conventions for those and they need their
 * own lookup. Skipping returns null so the caller can log cleanly.
 */
const UNSUPPORTED_COLORS = new Set(["event", "token", "status"]);

function wikiImageUrl(name: string, color: string | null): string | null {
  if (!color || UNSUPPORTED_COLORS.has(color)) return null;
  const wikiColor = color.charAt(0).toUpperCase() + color.slice(1).toLowerCase();
  const wikiName = name
    .replace(/[^A-Za-z0-9\- ]/g, "") // drop apostrophes, commas, !, ?, etc. — keep hyphens + spaces
    .replace(/\s+/g, "");
  return `https://slaythespire.wiki.gg/images/StS2_${wikiColor}-${wikiName}.png`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

  const { data: cards, error } = await supabase
    .from("cards")
    .select("id, name, color, image_url, phash, render_url");

  if (error) {
    console.error("Failed to fetch cards:", error);
    process.exit(1);
  }

  const rows = (cards ?? []) as CardRow[];
  const todo = rows.filter((c) => force || !c.phash);

  console.log(
    `Cards: ${rows.length} total, ${todo.length} to hash (${rows.length - todo.length} already hashed).`,
  );

  let ok = 0;
  let fail = 0;
  const failures: Array<{ id: string; reason: string }> = [];

  for (let i = 0; i < todo.length; i++) {
    const card = todo[i];
    const url = wikiImageUrl(card.name, card.color);

    if (!url) {
      fail++;
      failures.push({ id: card.id, reason: "no color for wiki URL" });
      continue;
    }

    let result = await fetchAndHash(url);
    // One retry on 429 — the wiki's rate-limit window is short; a 3s
    // back-off clears it. Other errors (404, decode failures) don't retry.
    if (!result.hash && result.error?.includes("429")) {
      await sleep(RETRY_DELAY_MS);
      result = await fetchAndHash(url);
    }
    if (!result.hash) {
      fail++;
      failures.push({ id: card.id, reason: `${result.error} (${url})` });
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    const { error: updateErr } = await supabase
      .from("cards")
      .update({ phash: result.hash, render_url: url })
      .eq("id", card.id);

    if (updateErr) {
      fail++;
      failures.push({ id: card.id, reason: `update failed: ${updateErr.message}` });
      continue;
    }

    ok++;
    if (ok % 10 === 0 || ok === todo.length) {
      console.log(`  [${i + 1}/${todo.length}] ${ok} hashed, ${fail} failed`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`\nDone. Hashed: ${ok}. Failed: ${fail}.`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  ${f.id}: ${f.reason}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
