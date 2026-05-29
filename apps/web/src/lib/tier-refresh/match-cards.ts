import type { ScrapedSection } from "@sts2/shared/tier-sources";
import {
  fetchAndHashAll,
  filenameHint,
  findNearest,
  matchByFilename,
  type NamedCandidate,
} from "@/lib/image-hash";

// Distance threshold (out of 64 bits) for accepting a dHash match. Tuned
// empirically against wiki vs tiermaker full-card renders: same-card pairs
// land at 11–12 bits, different-card pairs at 19–20. 14 separates them
// cleanly; tighten later if wider-scale backfill data shows collisions.
const MATCH_THRESHOLD = 14;

// Colors that can appear in any character's tier list regardless of scope.
// Kept separate so the character filter still includes neutral cards.
const NEUTRAL_COLORS = ["colorless", "curse"] as const;

export type CharacterParam =
  | "ironclad"
  | "silent"
  | "defect"
  | "regent"
  | "necrobinder"
  | null
  | undefined;

export interface CardWithHash {
  id: string;
  name: string;
  hash: string;
}

export type CardRow = { id: string; name: string; color: string | null; phash: string | null };

export type MatchedCard = {
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

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// When all matchers miss, preserve the strongest name hint we have so the
// admin sees something actionable in the preview rather than an empty
// combobox. Priority: adapter-declared name > filename-derived hint.
const unmatchedName = (card: { name?: string; imageUrl: string }) =>
  card.name && card.name.trim().length > 0 ? card.name : filenameHint(card.imageUrl);

/**
 * Run candidate matching for a single section. The section's detectedCharacter
 * is used as the primary scope hint; fallbackCharacter (the request param) is
 * used only when the section doesn't declare one.
 */
export async function matchSection(
  section: ScrapedSection,
  fallbackCharacter: CharacterParam,
  candidates: CardRow[],
  scrapeHost: string,
): Promise<{ matched: MatchedCard[]; warnings: string[] }> {
  const sectionCharacter = section.detectedCharacter ?? fallbackCharacter ?? null;

  // Character-scoped candidate pool. Filename + hash matchers both draw
  // from this same pool so cross-character collisions (e.g. a Silent card's
  // hash happening to match an Ironclad card) are eliminated up front.
  const allowedColors = sectionCharacter
    ? new Set<string>([sectionCharacter, ...NEUTRAL_COLORS])
    : null;

  const scopedCards = candidates.filter(
    (c) => !allowedColors || (c.color !== null && allowedColors.has(c.color)),
  );

  const nameCandidates: NamedCandidate[] = scopedCards.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  const hashCandidates: CardWithHash[] = scopedCards
    .filter(
      (c): c is { id: string; name: string; color: string | null; phash: string } =>
        typeof c.phash === "string" && c.phash.length > 0,
    )
    .map((c) => ({ id: c.id, name: c.name, hash: c.phash }));

  // Build a normalized name → candidate lookup for fast alt-text matches.
  // Drops apostrophes/punctuation so "Pact's End" → "pactsend" collides
  // with source variants like "Pacts End".
  const normalizedNameLookup = new Map<string, NamedCandidate>();
  for (const c of nameCandidates) normalizedNameLookup.set(normName(c.name), c);

  // Fetch + hash every scraped card image in parallel. The filename matcher
  // catches ~everything for tiermaker's doubled-name convention; hashes are
  // a fallback for adapters whose filenames aren't reliable.
  const hashResults = await fetchAndHashAll(
    section.cards.map((c) => c.imageUrl),
    8,
    {
      allowedHosts: [scrapeHost],
      maxBytes: 5 * 1024 * 1024, // 5 MB per card image — generous but bounded
      timeoutMs: 10_000,
    },
  );

  const matched: MatchedCard[] = section.cards.map((card, i) => {
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
        name: unmatchedName(card),
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
        name: unmatchedName(card),
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

  const warnings = matched
    .filter((m) => m.error)
    .map((m) => `${m.imageUrl}: ${m.error}`);

  return { matched, warnings };
}
