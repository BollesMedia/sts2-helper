import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api-admin-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveAdapter } from "@sts2/shared/tier-sources";
import {
  fetchAndHashAll,
  findNearest,
  matchByFilename,
  type NamedCandidate,
} from "@/lib/image-hash";

// Distance threshold (out of 64 bits) for accepting a dHash match. Tuned
// empirically against wiki vs tiermaker full-card renders: same-card pairs
// land at 11–12 bits, different-card pairs at 19–20. 14 separates them
// cleanly; tighten later if wider-scale backfill data shows collisions.
const MATCH_THRESHOLD = 14;
const MAX_HTML_BYTES = 2 * 1024 * 1024;

const scrapeSchema = z.object({
  url: z.string().url(),
  html: z.string().max(MAX_HTML_BYTES),
  // When provided, candidate cards are restricted to this character plus
  // always-neutral colors (colorless, curse). Essential for match accuracy —
  // with ~500 candidates, dHash noise produces many same-distance false
  // positives across the full set; scoping to ~100 candidates eliminates
  // most collisions. Accepts null for explicit cross-character lists.
  character: z
    .enum(["ironclad", "silent", "defect", "regent", "necrobinder"])
    .nullable()
    .optional(),
});

// Colors that can appear in any character's tier list regardless of scope.
// Kept separate so the character filter still includes neutral cards.
const NEUTRAL_COLORS = ["colorless", "curse"] as const;

interface CardWithHash {
  id: string;
  name: string;
  hash: string;
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const parsed = scrapeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", detail: parsed.error.format() },
      { status: 400 },
    );
  }
  const { url, html, character } = parsed.data;

  const adapter = resolveAdapter(url);
  if (!adapter) {
    return NextResponse.json(
      { error: `No tier-list adapter supports ${url}` },
      { status: 400 },
    );
  }

  const scraped = adapter.parse(html, url);
  if (scraped.cards.length === 0) {
    return NextResponse.json(
      {
        error: "No cards found in pasted HTML",
        warnings: scraped.warnings,
      },
      { status: 422 },
    );
  }

  const supabase = createServiceClient();

  // `cards.phash` was added in migration 028 and is not yet reflected in the
  // generated database types. Cast to any until `db:gen-types` is re-run.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cardsData, error: cardsError } = await (supabase as any)
    .from("cards")
    .select("id, name, color, phash");
  if (cardsError) {
    console.error("[Tier Lists Scrape] Card fetch failed:", cardsError);
    return NextResponse.json({ error: "Card fetch failed" }, { status: 500 });
  }

  type CardRow = { id: string; name: string; color: string | null; phash: string | null };
  const cards = (cardsData ?? []) as CardRow[];

  const cardIdMap: Record<string, string> = {};
  for (const c of cards) cardIdMap[c.name] = c.id;

  const allowedColors = character
    ? new Set<string>([character, ...NEUTRAL_COLORS])
    : null;

  // Character-scoped candidate pool. Filename + hash matchers both draw
  // from this same pool so cross-character collisions (e.g. a Silent card's
  // hash happening to match an Ironclad card) are eliminated up front.
  const scopedCards = cards.filter(
    (c) => !allowedColors || (c.color !== null && allowedColors.has(c.color)),
  );

  const nameCandidates: NamedCandidate[] = scopedCards.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const hashCandidates: CardWithHash[] = scopedCards
    .filter((c): c is { id: string; name: string; color: string | null; phash: string } =>
      typeof c.phash === "string" && c.phash.length > 0,
    )
    .map((c) => ({ id: c.id, name: c.name, hash: c.phash }));

  // Fetch + hash every scraped card image in parallel. The filename matcher
  // catches ~everything for tiermaker's doubled-name convention; hashes are
  // a fallback for adapters whose filenames aren't reliable.
  // Adapter owns the host allowlist: only URLs matching the same site that
  // handled the scrape are eligible. Tightening this from the route would
  // couple us to adapter internals; the adapter sets it via canHandle's host.
  // Extract the scrape URL's host as the allowlist entry.
  const { hostname: scrapeHost } = new URL(url);
  const hashResults = await fetchAndHashAll(
    scraped.cards.map((c) => c.imageUrl),
    8,
    {
      allowedHosts: [scrapeHost],
      maxBytes: 5 * 1024 * 1024, // 5 MB per card image — generous but bounded
      timeoutMs: 10_000,
    },
  );

  type MatchedCard = {
    externalId?: string;
    tier: string;
    imageUrl: string;
    name: string;
    cardId: string | null;
    confidence: number;
    source: "alt" | "filename" | "phash" | "none";
    distance: number | null;
    error?: string;
  };

  // Build a normalized name → candidate lookup for fast alt-text matches.
  // Drops apostrophes/punctuation so "Pact's End" → "pactsend" collides
  // with source variants like "Pacts End".
  const normalizedNameLookup = new Map<string, NamedCandidate>();
  const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const c of nameCandidates) normalizedNameLookup.set(normName(c.name), c);

  const matched: MatchedCard[] = scraped.cards.map((card, i) => {
    // Tier 0: adapter-declared alt/name — the strongest signal when present.
    if (card.name) {
      const byAlt = normalizedNameLookup.get(normName(card.name));
      if (byAlt) {
        return {
          externalId: card.externalId,
          tier: card.tier,
          imageUrl: card.imageUrl,
          name: byAlt.name,
          cardId: byAlt.id,
          confidence: 1,
          source: "alt",
          distance: null,
        };
      }
    }

    // Tier 1: filename substring match — deterministic when it hits.
    const byName = matchByFilename(card.imageUrl, nameCandidates);
    if (byName) {
      return {
        externalId: card.externalId,
        tier: card.tier,
        imageUrl: card.imageUrl,
        name: byName.candidate.name,
        cardId: byName.candidate.id,
        confidence: 1,
        source: "filename",
        distance: null,
      };
    }

    // Tier 2: pHash nearest-neighbour over same character pool.
    const hr = hashResults[i];
    if (!hr.hash) {
      return {
        externalId: card.externalId,
        tier: card.tier,
        imageUrl: card.imageUrl,
        name: "",
        cardId: null,
        confidence: 0,
        source: "none",
        distance: null,
        error: hr.error ?? "hash failed",
      };
    }
    const match = findNearest(hr.hash, hashCandidates, MATCH_THRESHOLD);
    if (!match) {
      return {
        externalId: card.externalId,
        tier: card.tier,
        imageUrl: card.imageUrl,
        name: "",
        cardId: null,
        confidence: 0,
        source: "none",
        distance: null,
      };
    }
    return {
      externalId: card.externalId,
      tier: card.tier,
      imageUrl: card.imageUrl,
      name: match.candidate.name,
      cardId: match.candidate.id,
      confidence: 1 - match.distance / MATCH_THRESHOLD,
      source: "phash",
      distance: match.distance,
    };
  });

  // Collapse into the same `tiers[]` shape the existing preview UI consumes.
  const tiersByLabel = new Map<string, MatchedCard[]>();
  for (const m of matched) {
    const bucket = tiersByLabel.get(m.tier) ?? [];
    bucket.push(m);
    tiersByLabel.set(m.tier, bucket);
  }
  const tiers = Array.from(tiersByLabel.entries()).map(([label, cards]) => ({
    label,
    cards: cards.map((c) => ({ name: c.name, confidence: c.confidence })),
  }));

  return NextResponse.json({
    adapterId: scraped.adapterId,
    sourceUrl: url,
    imageUrl: null,
    ingestionMethod: "scraped" as const,
    scaleType: scraped.scaleType,
    scaleConfig: scraped.scaleConfig ?? null,
    detectedCharacter: scraped.detectedCharacter,
    extraction: {
      tiers,
      warnings: [
        ...scraped.warnings,
        ...matched
          .filter((m) => m.error)
          .map((m) => `${m.imageUrl}: ${m.error}`),
      ],
    },
    cardIdMap,
    // Per-card metadata for the preview UI: lets us show the tiermaker image
    // alongside the matched card (or empty combobox) for visual verification.
    scrapedCards: matched,
    stats: {
      total: matched.length,
      matched: matched.filter((m) => m.cardId).length,
      unmatched: matched.filter((m) => !m.cardId).length,
    },
  });
}
