import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAdapter } from "@sts2/shared/tier-sources";
import type { ScaleType } from "@sts2/shared/evaluation/tier-normalize";
import type { Database, Json } from "@sts2/shared/types/database.types";
import { fetchSourceHtml } from "./fetch-source-html";
import { matchSection, type CardRow, type MatchedCard } from "./match-cards";
import {
  evaluateGate,
  type SectionMatchSummary,
} from "./quality-gate";
import { applySection } from "./apply-sections";
import { computeBackoff } from "./backoff";
import type { RefreshResult, RefreshStatus, RefreshTrigger } from "./types";

type TierListSourceRow =
  Database["public"]["Tables"]["tier_list_sources"]["Row"];

/** Postgres unique-violation: a same-day/version active snapshot already exists. */
const UNIQUE_VIOLATION = "23505";

/** Per-section apply outcome, tracked so status derivation stays explicit. */
type SectionOutcome = "applied" | "queued" | "failed";

/**
 * Orchestrate one source refresh: fetch → adapter parse → per-section card
 * matching → quality gate → apply-or-queue → backoff bookkeeping → audit log →
 * (optional) materialized-view refresh.
 *
 * Composes already-tested units; this layer owns the control flow, the status
 * derivation, and the source-row + audit-log writes. It NEVER throws on the
 * happy path — fetch/parse/apply failures are mapped to a `RefreshStatus` and
 * recorded. The cron loop (AR-9) calls it with `deferMvRefresh: true` (one MV
 * refresh per run); the manual route (AR-10) with `deferMvRefresh: false`.
 */
export async function runSourceRefresh(
  supabase: SupabaseClient<Database>,
  source: TierListSourceRow,
  options: { trigger: RefreshTrigger; deferMvRefresh: boolean; now?: Date },
): Promise<RefreshResult> {
  const now = options.now ?? new Date();
  const startedAt = now.toISOString();

  let status: RefreshStatus = "failed";
  let reason: string | undefined;
  let errorDetail: unknown;
  let sectionsAttempted = 0;
  let sectionsApplied = 0;
  let sectionsQueued = 0;

  // The body runs to completion via early `return finish(...)` calls for the
  // failure-class short-circuits (no URL / fetch fail / no adapter / parse
  // throw / no sections). `finish` performs backoff + source update + audit log
  // + (optional) MV refresh and returns the RefreshResult, so every exit path
  // does the same bookkeeping.
  const finish = async (): Promise<RefreshResult> => {
    // --- Backoff + source row update ------------------------------------
    const backoff = computeBackoff(
      status,
      {
        failures: source.consecutive_failures,
        queueOnly: source.consecutive_queue_only,
      },
      now,
    );
    const succeeded = status === "applied" || status === "partial";
    const isFailureClass = status === "failed" || status === "no_data";
    try {
      await supabase
        .from("tier_list_sources")
        .update({
          ...backoff,
          last_refresh_attempted_at: startedAt,
          last_refresh_succeeded_at: succeeded
            ? startedAt
            : source.last_refresh_succeeded_at,
          last_failure_reason: isFailureClass ? (reason ?? null) : null,
        })
        .eq("id", source.id);
    } catch (err) {
      console.error("[runSourceRefresh] source update failed:", err);
    }

    // --- Audit log (never throws out of the function) -------------------
    try {
      const auditError: Json | null =
        errorDetail !== undefined
          ? ((typeof errorDetail === "string"
              ? errorDetail
              : JSON.stringify(errorDetail)) as Json)
          : reason
            ? (reason as Json)
            : null;
      await supabase.from("tier_list_refresh_logs").insert({
        source_id: source.id,
        started_at: startedAt,
        finished_at: (options.now ?? new Date()).toISOString(),
        status,
        trigger: options.trigger,
        sections_attempted: sectionsAttempted,
        sections_applied: sectionsApplied,
        sections_queued: sectionsQueued,
        error_detail: auditError,
      });
    } catch (err) {
      console.error("[runSourceRefresh] audit-log insert failed:", err);
    }

    // --- MV refresh (best-effort) ---------------------------------------
    if (!options.deferMvRefresh && succeeded) {
      try {
        await supabase.rpc("refresh_community_tier_consensus");
      } catch (err) {
        console.warn("[runSourceRefresh] MV refresh failed:", err);
      }
    }

    return {
      status,
      sectionsAttempted,
      sectionsApplied,
      sectionsQueued,
      ...(reason !== undefined ? { reason } : {}),
      ...(errorDetail !== undefined ? { errorDetail } : {}),
    };
  };

  // 1. Source URL must exist.
  if (!source.source_url) {
    status = "failed";
    reason = "no_source_url";
    return finish();
  }
  const sourceUrl = source.source_url;

  // 2. Fetch.
  const fetched = await fetchSourceHtml(sourceUrl);
  if (!fetched.ok) {
    status = "failed";
    reason = fetched.reason;
    return finish();
  }

  // 3. Resolve adapter + parse.
  const adapter = resolveAdapter(sourceUrl);
  if (!adapter) {
    status = "failed";
    reason = "no_adapter";
    return finish();
  }

  let sections;
  try {
    const parsed = adapter.parse(fetched.html, sourceUrl);
    sections = parsed.sections;
  } catch (err) {
    status = "failed";
    reason = "adapter_error";
    errorDetail = err instanceof Error ? (err.stack ?? err.message) : err;
    return finish();
  }

  if (sections.length === 0) {
    status = "no_data";
    reason = "no_data";
    return finish();
  }
  sectionsAttempted = sections.length;

  // 4. Candidate cards + scrape host (mirrors the scrape route's prep).
  const { data: cardsData } = await supabase
    .from("cards")
    .select("id, name, color, phash");
  const candidates = (cardsData ?? []) as CardRow[];
  const scrapeHost = new URL(sourceUrl).hostname;

  // 5. Match each section; build a gate summary + keep the matched arrays.
  const matchedBySection: MatchedCard[][] = [];
  const summaries: SectionMatchSummary[] = [];
  for (const section of sections) {
    // No request-level character param on the cron path; matchSection uses the
    // section's own detectedCharacter as the primary scope and only falls back
    // to this arg when the section declares none — so null is the correct
    // fallback here (and the only one assignable to its narrow CharacterParam).
    const { matched, warnings: matchWarnings } = await matchSection(
      section,
      null,
      candidates,
      scrapeHost,
    );
    matchedBySection.push(matched);
    summaries.push({
      detectedCharacter: section.detectedCharacter,
      matchedCount: matched.filter((m) => m.cardId).length,
      totalCount: section.cards.length,
      warnings: [...section.warnings, ...matchWarnings],
    });
  }

  // 6. Prior active snapshots for this source → coverage + entry-count context
  //    and the prior game_version (fallback for version tagging).
  const { data: priorRows } = await supabase
    .from("tier_lists")
    .select("character, entry_count, game_version")
    .eq("source_id", source.id)
    .eq("is_active", true);
  const priorLists = priorRows ?? [];
  const priorCharacters = Array.from(
    new Set(
      priorLists
        .map((r) => r.character)
        .filter((c): c is string => c != null),
    ),
  );
  const priorEntryCountByCharacter = new Map<string | null, number>();
  for (const r of priorLists) {
    priorEntryCountByCharacter.set(r.character, r.entry_count);
  }
  const priorGameVersion =
    priorLists.find((r) => r.game_version != null)?.game_version ?? null;

  // 7. Quality gate.
  const gate = evaluateGate(summaries, {
    priorCharacters,
    priorEntryCountByCharacter,
  });

  // 8. Game-version tag: latest released version on/before today, else the
  //    prior snapshot's version, else null. published_at = today (capture date).
  const today = now.toISOString().slice(0, 10);
  let gameVersion: string | null = priorGameVersion;
  try {
    const { data: gv } = await supabase
      .from("game_versions")
      .select("version, released_at")
      .not("released_at", "is", null)
      .lte("released_at", today)
      .order("released_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (gv?.version) gameVersion = gv.version;
  } catch (err) {
    console.warn("[runSourceRefresh] game_versions lookup failed:", err);
  }
  const publishedAt = today;

  // 9. Apply or queue each section.
  //    Coverage failure forces EVERY section to queue (even per-section
  //    passers); otherwise a section applies iff its per-section gate passed.
  const coverageFailed = gate.sourceLevel.coverage.passed === false;
  const outcomes: SectionOutcome[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const entries = matchedBySection[i]
      .filter((m) => m.cardId)
      .map((m) => ({
        card_id: m.cardId as string,
        raw_tier: m.tier,
        extraction_confidence: m.confidence,
      }));

    const shouldQueue = coverageFailed || gate.perSection[i].passed === false;

    try {
      await applySection(supabase, {
        sourceId: source.id,
        list: {
          character: section.detectedCharacter ?? null,
          game_version: gameVersion,
          published_at: publishedAt,
        },
        entries,
        imageUrl: null,
        ingestionMethod: "scraped",
        scaleType: source.scale_type as ScaleType,
        scaleConfig: source.scale_config as
          | { map?: Record<string, number> }
          | null,
        queue: shouldQueue,
        ...(shouldQueue
          ? {
              gateFailureReasons: {
                perSection: gate.perSection[i],
                sourceLevel: gate.sourceLevel,
              },
            }
          : {}),
      });
      if (shouldQueue) {
        sectionsQueued++;
        outcomes.push("queued");
      } else {
        sectionsApplied++;
        outcomes.push("applied");
      }
    } catch (err) {
      // 23505 → a same-day same-version active snapshot already exists. Record
      // this section as failed but keep going so sibling sections proceed.
      const code = (err as { code?: string } | null)?.code;
      const sectionReason =
        code === UNIQUE_VIOLATION ? "duplicate_snapshot" : "apply_error";
      console.error(
        `[runSourceRefresh] applySection failed (section ${i}, ${sectionReason}):`,
        err,
      );
      outcomes.push("failed");
    }
  }

  // 10. Status derivation.
  const hadApplyError = outcomes.includes("failed");
  if (sectionsApplied > 0) {
    status = sectionsQueued > 0 || hadApplyError ? "partial" : "applied";
  } else if (sectionsQueued > 0) {
    status = "queued";
  } else {
    // Sections existed but none applied or queued → every apply attempt errored.
    status = "failed";
    reason = "all_sections_failed";
  }

  return finish();
}
