import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types";
import { valueToTier, type TierLetter } from "./tier-utils";

/**
 * Per-card community tier signal derived from aggregated tier lists.
 * Used to inject a prior into LLM evaluations.
 */
export interface CommunityTierSignal {
  consensusTier: number; // 1-6 weighted avg
  consensusTierLetter: TierLetter;
  sourceCount: number;
  stddev: number;
  agreement: "strong" | "mixed" | "split";
  staleness: "fresh" | "aging" | "stale";
  mostRecentPublished: string | null;
}

export interface GameVersionMeta {
  version: string;
  released_at: string | null; // ISO date
  is_major_balance_patch: boolean;
}

const DAY_MS = 1000 * 60 * 60 * 24;
const AGING_DAYS = 180;
const STALE_DAYS = 365;

/**
 * Load community tier signals for the given card IDs and character.
 * Applies staleness rules based on game version + publish date.
 *
 * Returns a Map<cardId, CommunityTierSignal>. Cards without data are absent.
 */
export async function getCommunityTierSignals(
  supabase: SupabaseClient<Database>,
  cardIds: string[],
  character: string | null,
  currentGameVersion: string | null,
): Promise<Map<string, CommunityTierSignal>> {
  const result = new Map<string, CommunityTierSignal>();
  if (cardIds.length === 0) return result;

  // Fetch character-specific entries + 'any' fallback entries in one query.
  // The game client sends "The Ironclad" style names (lowercased to "the
  // ironclad"); tier list admins enter "ironclad". Normalize both to the
  // short form so the scope matches.
  const normalized = normalizeCharacter(character);
  const scopes = normalized ? [normalized, "any"] : ["any"];

  const { data: rows, error } = await supabase
    .from("community_tier_consensus")
    .select(
      "card_id, character_scope, source_count, weighted_tier, tier_stddev, most_recent_published, game_versions",
    )
    .in("card_id", cardIds)
    .in("character_scope", scopes);

  if (error || !rows) return result;

  // Load game_versions metadata needed for staleness detection
  const versions = new Set<string>();
  for (const r of rows) {
    for (const v of r.game_versions ?? []) versions.add(v);
  }
  if (currentGameVersion) versions.add(currentGameVersion);

  const versionMeta = await loadGameVersionMeta(supabase, Array.from(versions));

  // Group rows by card_id, merging character-specific + any-scope entries
  // Character-specific takes precedence when both exist
  const byCard = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.card_id) continue;
    const existing = byCard.get(r.card_id);
    if (!existing) {
      byCard.set(r.card_id, [r]);
    } else {
      existing.push(r);
    }
  }

  for (const [cardId, cardRows] of byCard.entries()) {
    const signal = buildSignal(cardRows, character, currentGameVersion, versionMeta);
    if (signal) result.set(cardId, signal);
  }

  return result;
}

export async function loadGameVersionMeta(
  supabase: SupabaseClient<Database>,
  versions: string[],
): Promise<Map<string, GameVersionMeta>> {
  const result = new Map<string, GameVersionMeta>();
  if (versions.length === 0) return result;

  const { data: rows } = await supabase
    .from("game_versions")
    .select("version, released_at, is_major_balance_patch")
    .in("version", versions);

  for (const r of rows ?? []) {
    result.set(r.version, {
      version: r.version,
      released_at: r.released_at,
      is_major_balance_patch: r.is_major_balance_patch,
    });
  }
  return result;
}

export type ConsensusRow = {
  card_id: string | null;
  character_scope: string | null;
  source_count: number | null;
  weighted_tier: number | null;
  tier_stddev: number | null;
  most_recent_published: string | null;
  game_versions: string[] | null;
};

/**
 * Normalize a character name to the short canonical form used by tier list
 * `character_scope` ("ironclad", "silent", etc.). The game client sends
 * "The Ironclad" while admins enter "ironclad" — strip the "the " prefix
 * and lowercase so the scope matches either way.
 * Returns null when the input is null/unknown.
 */
export function normalizeCharacter(character: string | null): string | null {
  if (!character) return null;
  const trimmed = character.trim().toLowerCase();
  if (!trimmed || trimmed === "unknown") return null;
  return trimmed.replace(/^the\s+/, "");
}

export function buildSignal(
  rows: ConsensusRow[],
  character: string | null,
  currentGameVersion: string | null,
  versionMeta: Map<string, GameVersionMeta>,
): CommunityTierSignal | null {
  // Prefer character-specific row when available; fall back to 'any'
  const characterRow = character
    ? rows.find((r) => r.character_scope === normalizeCharacter(character))
    : null;
  const anyRow = rows.find((r) => r.character_scope === "any");
  const chosen = characterRow ?? anyRow;
  if (!chosen) return null;

  const consensusTier = chosen.weighted_tier ?? 3;
  const sourceCount = chosen.source_count ?? 0;
  const stddev = chosen.tier_stddev ?? 0;
  if (sourceCount === 0) return null;

  const agreement: CommunityTierSignal["agreement"] =
    stddev < 0.5 ? "strong" : stddev > 1.2 ? "split" : "mixed";

  const staleness = computeStaleness(chosen, currentGameVersion, versionMeta);
  if (staleness === "excluded") return null;

  const roundedTier = Math.round(consensusTier);
  const clampedTier = Math.max(1, Math.min(6, roundedTier));

  return {
    consensusTier,
    consensusTierLetter: valueToTier(clampedTier),
    sourceCount,
    stddev,
    agreement,
    staleness,
    mostRecentPublished: chosen.most_recent_published,
  };
}

export function computeStaleness(
  row: ConsensusRow,
  currentGameVersion: string | null,
  versionMeta: Map<string, GameVersionMeta>,
): "fresh" | "aging" | "stale" | "excluded" {
  const timeBucket = classifyByTime(row.most_recent_published);
  if (timeBucket === "excluded") return "excluded";

  const versionBucket = classifyByVersion(
    row.game_versions,
    currentGameVersion,
    versionMeta,
  );
  if (versionBucket === "excluded") return "excluded";

  // Combine: take the worse of the two
  if (timeBucket === "stale" || versionBucket === "stale") return "stale";
  if (timeBucket === "aging" || versionBucket === "aging") return "aging";
  return "fresh";
}

export function classifyByTime(
  publishedAt: string | null,
): "fresh" | "aging" | "stale" | "excluded" {
  if (!publishedAt) return "fresh"; // no date info, don't penalize
  const now = Date.now();
  const published = new Date(publishedAt).getTime();
  if (Number.isNaN(published)) return "fresh";
  const ageDays = (now - published) / DAY_MS;
  if (ageDays < AGING_DAYS) return "fresh";
  if (ageDays < STALE_DAYS) return "aging";
  return "excluded"; // > 365 days: excluded
}

export function classifyByVersion(
  listVersions: string[] | null,
  currentGameVersion: string | null,
  versionMeta: Map<string, GameVersionMeta>,
): "fresh" | "aging" | "stale" | "excluded" {
  if (!currentGameVersion || !listVersions || listVersions.length === 0)
    return "fresh";

  const current = versionMeta.get(currentGameVersion);
  if (!current?.released_at) return "fresh"; // no metadata — can't classify, trust time-based

  const currentDate = new Date(current.released_at).getTime();
  let hasBalancePatchBetween = false;
  let newestListDate = 0;

  for (const v of listVersions) {
    const meta = versionMeta.get(v);
    if (!meta?.released_at) continue;
    const listDate = new Date(meta.released_at).getTime();
    if (listDate > newestListDate) newestListDate = listDate;

    // Any balance patch strictly between this list's version and current?
    for (const other of versionMeta.values()) {
      if (!other.is_major_balance_patch || !other.released_at) continue;
      const otherDate = new Date(other.released_at).getTime();
      if (otherDate > listDate && otherDate <= currentDate) {
        hasBalancePatchBetween = true;
      }
    }
  }

  if (hasBalancePatchBetween) return "stale";
  if (newestListDate === 0) return "fresh";
  // If list version is current, fresh; if not current but no balance patch between, aging
  if (currentDate === newestListDate) return "fresh";
  return "aging";
}
