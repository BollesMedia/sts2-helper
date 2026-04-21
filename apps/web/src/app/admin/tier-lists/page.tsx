"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import useSWR from "swr";
import { useAuth } from "@/features/auth/auth-provider";
import { LoginScreen } from "@/features/auth/login-screen";
import type { TierExtractionResult } from "@sts2/shared/evaluation/tier-extraction";

// ── Types ────────────────────────────────────────────────────────────────────

type SourceType = "image" | "spreadsheet" | "website" | "reddit" | "youtube";
type ScaleType = "letter_6" | "letter_5" | "numeric_10" | "numeric_5" | "binary";
type Character = "any" | "ironclad" | "silent" | "defect" | "regent" | "necrobinder";
type IngestMode = "image" | "scrape";
type IngestionMethod = "vision_llm" | "scraped";

interface SourceMeta {
  author: string;
  source_type: SourceType;
  source_url: string;
  trust_weight: number;
  scale_type: ScaleType;
  character: Character;
  game_version: string;
  published_at: string;
}

/**
 * Derive a stable source_id slug from author + source_type.
 * Same author + type always maps to the same row, so re-uploads hit
 * upsert correctly and share trust history.
 */
function deriveSourceId(author: string, sourceType: SourceType): string {
  const slug = author
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "unknown"}-${sourceType}`;
}

interface ExtractedCard {
  name: string;
  tier: string;
  confidence: number;
  matchedName?: string;
  /** Source image URL (scraped adapters only). Rendered in the preview so
   * the admin can visually confirm matches or pick from an unmatched combobox. */
  sourceImageUrl?: string;
}

interface ScrapedCardInfo {
  tier: string;
  imageUrl: string;
  name?: string;
  source?: "alt" | "filename" | "phash" | "none";
}

interface ExtractResult {
  imageUrl: string | null;
  extraction: TierExtractionResult;
  cardIdMap: Record<string, string>;
  ingestionMethod?: IngestionMethod;
  sourceUrl?: string;
  scaleConfig?: { map: Record<string, number> } | null;
  stats?: { total: number; matched: number; unmatched: number };
  /** Per-card metadata from scrape adapters (parallel to extraction.tiers in
   * flattened order). Lets the preview UI show source image thumbnails. */
  scrapedCards?: ScrapedCardInfo[];
}

type Step = "upload" | "preview" | "success";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Numeric values each letter tier maps to (matches LETTER_6_MAP in
// packages/shared/evaluation/tier-normalize.ts). Used to build the
// scale_config.map payload sent to the confirm endpoint.
const LETTER_VALUE: Record<string, number> = {
  S: 6,
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  F: 1,
};

const LETTER_OPTIONS = ["S", "A", "B", "C", "D", "F"] as const;
type LetterOption = (typeof LETTER_OPTIONS)[number];

/** A tier label like "S" or "3" that a letter/numeric scale already understands. */
function isStandardTierLabel(label: string, scale: ScaleType): boolean {
  const cleaned = label.trim();
  if (!cleaned) return true;
  const opts = getTierOptions(scale);
  return opts.some((o) => o.toLowerCase() === cleaned.toLowerCase());
}

/**
 * Auto-map raw tier labels (e.g. "Premium", "Want in most decks", "Bad") to
 * letter tiers by position — the first label encountered becomes S, the
 * second A, and so on. Admin can override in the mapping UI before confirm.
 */
function inferLetterMapping(
  orderedLabels: readonly string[],
): Record<string, LetterOption> {
  const out: Record<string, LetterOption> = {};
  for (let i = 0; i < orderedLabels.length; i++) {
    const target = LETTER_OPTIONS[Math.min(i, LETTER_OPTIONS.length - 1)];
    out[orderedLabels[i]] = target;
  }
  return out;
}

function getTierOptions(scale: ScaleType): string[] {
  switch (scale) {
    case "letter_6":
      return ["S", "A", "B", "C", "D", "F"];
    case "letter_5":
      return ["S", "A", "B", "C", "D"];
    case "numeric_10":
      return ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
    case "numeric_5":
      return ["1", "2", "3", "4", "5"];
    case "binary":
      return ["good", "bad"];
  }
}

function getTierColor(tier: string): string {
  switch (tier.toUpperCase()) {
    case "S":
      return "text-yellow-300";
    case "A":
      return "text-emerald-400";
    case "B":
      return "text-blue-400";
    case "C":
      return "text-zinc-300";
    case "D":
      return "text-orange-400";
    case "F":
      return "text-red-400";
    default:
      return "text-zinc-400";
  }
}

// ── Default form values ───────────────────────────────────────────────────────

const defaultMeta: SourceMeta = {
  author: "",
  source_type: "image",
  source_url: "",
  trust_weight: 1.0,
  scale_type: "letter_6",
  character: "any",
  game_version: "",
  published_at: new Date().toISOString().split("T")[0],
};

// ── Page shell ────────────────────────────────────────────────────────────────

export default function TierListIngestionPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen bg-background text-foreground">
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <LoginScreen />
      </div>
    );
  }

  return <TierListContent />;
}

// ── Main content ──────────────────────────────────────────────────────────────

function TierListContent() {
  // Lazy init from localStorage so a page reload (HMR, accidental close)
  // restores an in-progress extraction without re-running the upload.
  const draft = typeof window !== "undefined" ? loadDraft() : null;
  const [step, setStep] = useState<Step>(draft?.step ?? "upload");
  const [meta, setMeta] = useState<SourceMeta>(draft?.meta ?? defaultMeta);
  const [ingestMode, setIngestMode] = useState<IngestMode>(draft?.ingestMode ?? "image");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [scrapeHtml, setScrapeHtml] = useState("");
  const [extractResult, setExtractResult] = useState<ExtractResult | null>(
    draft?.extractResult ?? null,
  );
  const [cards, setCards] = useState<ExtractedCard[]>(draft?.cards ?? []);
  // Per-source override: maps raw tier labels (e.g. "Premium") to letter
  // tiers when a source doesn't use standard S/A/B/… Auto-inferred from
  // tier order after extraction; admin can adjust in the preview step.
  const [tierMapping, setTierMapping] = useState<Record<string, LetterOption>>(
    draft?.tierMapping ?? {},
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);

  // ── Step 1: Extract ─────────────────────────────────────────────────────────

  const handleExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    let result: ExtractResult;
    if (ingestMode === "scrape") {
      if (!scrapeUrl || !scrapeHtml) {
        setError("Paste the source URL and the tier list HTML before extracting.");
        setSubmitting(false);
        return;
      }
      const res = await fetch("/api/admin/tier-lists/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: scrapeUrl,
          html: scrapeHtml,
          character: meta.character === "any" ? null : meta.character,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Surface schema-validation details so admins see which field is
        // rejected (bare URL, oversized HTML, unknown character, etc.)
        // rather than a generic "Invalid request body".
        const detail =
          typeof data?.detail === "object" && data.detail !== null
            ? Object.entries(data.detail)
                .filter(([k]) => k !== "_errors")
                .map(([k, v]) => {
                  const errs = (v as { _errors?: string[] })?._errors;
                  return errs && errs.length ? `${k}: ${errs.join(", ")}` : null;
                })
                .filter(Boolean)
                .join("; ")
            : null;
        setError(detail || data.error || `Scrape failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      result = data as ExtractResult;
    } else {
      if (!imageFile) {
        setSubmitting(false);
        return;
      }
      // Prepare image for upload — preserves original when under Gemini's
      // 20MB cap, otherwise lossless-resizes to 3000px long-edge (enough
      // pixels for card-name OCR on dense grids). No lossy compression.
      const uploadFile = await downscaleImage(imageFile, 3000);

      const formData = new FormData();
      formData.append("image", uploadFile);

      const res = await fetch("/api/admin/tier-lists/extract", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Extraction failed");
        setSubmitting(false);
        return;
      }
      result = data as ExtractResult;
    }
    setExtractResult(result);

    // Build a normalized lookup so we can auto-match common variants
    // (case differences, trailing "+", whitespace) without bothering the admin.
    const normalizedLookup = new Map<string, string>();
    for (const canonical of Object.keys(result.cardIdMap)) {
      normalizedLookup.set(normalizeCardName(canonical), canonical);
    }

    // Flatten tiers → card rows. Auto-populate matchedName for fuzzy matches
    // so the admin only has to resolve truly unknown cards. For scraped lists,
    // zip in per-card source metadata (sourceImageUrl) so the preview can
    // render a thumbnail next to each row.
    const flat: ExtractedCard[] = [];
    let sourceIdx = 0;
    for (const tier of result.extraction.tiers ?? []) {
      for (const card of tier.cards) {
        const matched = resolveExtractedName(card.name, result.cardIdMap, normalizedLookup);
        const scraped = result.scrapedCards?.[sourceIdx];
        flat.push({
          name: card.name,
          tier: tier.label,
          confidence: card.confidence,
          matchedName: matched && matched !== card.name ? matched : undefined,
          sourceImageUrl: scraped?.imageUrl,
        });
        sourceIdx++;
      }
    }
    setCards(flat);

    // Detect non-standard tier labels and pre-populate a letter mapping so
    // the confirm payload can set source.scale_config.map. Keeps descriptive
    // scales like "Premium / Want in most decks / Bad" first-class.
    const orderedLabels: string[] = [];
    const seen = new Set<string>();
    for (const tier of result.extraction.tiers ?? []) {
      if (!seen.has(tier.label)) {
        seen.add(tier.label);
        orderedLabels.push(tier.label);
      }
    }
    const nonStandard = orderedLabels.filter(
      (l) => !isStandardTierLabel(l, meta.scale_type),
    );
    if (nonStandard.length > 0) {
      setTierMapping((prev) => ({
        ...inferLetterMapping(orderedLabels),
        ...prev, // preserve any admin overrides already in the draft
      }));
    }

    setStep("preview");
    setSubmitting(false);
  };

  // ── Step 2: Confirm ─────────────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (!extractResult) return;

    setSubmitting(true);
    setError(null);

    const { cardIdMap, imageUrl } = extractResult;
    const skipped: string[] = [];

    const entries = cards
      .map((c) => {
        const resolvedName = c.matchedName ?? c.name;
        const card_id = cardIdMap[resolvedName];
        if (!card_id) {
          skipped.push(c.name);
          return null;
        }
        return {
          card_id,
          raw_tier: c.tier,
          extraction_confidence: c.confidence,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    if (skipped.length > 0) {
      console.warn("[TierListIngestion] Skipped unresolved cards:", skipped);
    }

    // Build scale_config.map from the admin's tier mapping. Merges with any
    // adapter-provided scale_config (e.g. tiermaker's 7-letter override) so
    // both descriptive-label and letter-scale cases co-exist.
    const mappingEntries = Object.entries(tierMapping);
    const adapterMap = extractResult.scaleConfig?.map ?? {};
    const mergedMap: Record<string, number> = { ...adapterMap };
    for (const [rawLabel, letter] of mappingEntries) {
      mergedMap[rawLabel] = LETTER_VALUE[letter];
    }
    const scaleConfig =
      Object.keys(mergedMap).length > 0 ? { map: mergedMap } : null;

    const body = {
      imageUrl,
      ingestionMethod: extractResult.ingestionMethod ?? "vision_llm",
      source: {
        id: deriveSourceId(meta.author, meta.source_type),
        author: meta.author,
        source_type: meta.source_type,
        source_url: meta.source_url || extractResult.sourceUrl || null,
        trust_weight: meta.trust_weight,
        scale_type: meta.scale_type,
        scale_config: scaleConfig,
        notes: null,
      },
      list: {
        game_version: meta.game_version || null,
        published_at: meta.published_at,
        character: meta.character === "any" ? null : meta.character,
      },
      entries,
    };

    const res = await fetch("/api/admin/tier-lists/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Save failed");
      setSubmitting(false);
      return;
    }

    setSavedCount(data.entry_count ?? entries.length);
    setRefreshWarning(data.refreshWarning ?? null);
    setStep("success");
    setSubmitting(false);
    clearDraft();
  };

  // ── Step 3: Reset ───────────────────────────────────────────────────────────

  const handleReset = () => {
    setStep("upload");
    setMeta(defaultMeta);
    setIngestMode("image");
    setImageFile(null);
    setScrapeUrl("");
    setScrapeHtml("");
    setExtractResult(null);
    setCards([]);
    setTierMapping({});
    setError(null);
    setSavedCount(0);
    setRefreshWarning(null);
    clearDraft();
  };

  // Persist in-progress extraction draft so page reloads / HMR don't
  // wipe out an extraction the admin is mid-way through reviewing.
  // Only persist when there's actual extraction state to save.
  useEffect(() => {
    if (step === "preview" && extractResult) {
      saveDraft({ step, meta, ingestMode, extractResult, cards, tierMapping });
    }
  }, [step, meta, ingestMode, extractResult, cards, tierMapping]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <div className="flex items-center gap-4">
            <a
              href="/"
              className="text-sm font-semibold text-zinc-100 tracking-tight hover:text-zinc-300 transition-colors"
            >
              STS2 Replay
            </a>
            <div className="h-4 w-px bg-zinc-800" />
            <span className="text-sm font-medium text-zinc-300">Admin</span>
            <div className="h-4 w-px bg-zinc-800" />
            <span className="text-sm text-zinc-500">Tier List Ingestion</span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-6">
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {step === "upload" && (
          <>
            <IngestedListsTable />
            <UploadStep
              meta={meta}
              ingestMode={ingestMode}
              imageFile={imageFile}
              scrapeUrl={scrapeUrl}
              scrapeHtml={scrapeHtml}
              submitting={submitting}
              onMetaChange={setMeta}
              onIngestModeChange={setIngestMode}
              onImageChange={setImageFile}
              onScrapeUrlChange={setScrapeUrl}
              onScrapeHtmlChange={setScrapeHtml}
              onSubmit={handleExtract}
            />
          </>
        )}

        {step === "preview" && extractResult && (
          <PreviewStep
            meta={meta}
            result={extractResult}
            cards={cards}
            tierMapping={tierMapping}
            submitting={submitting}
            onCardsChange={setCards}
            onTierMappingChange={setTierMapping}
            onBack={() => setStep("upload")}
            onDiscard={handleReset}
            onConfirm={handleConfirm}
          />
        )}

        {step === "success" && (
          <SuccessStep count={savedCount} refreshWarning={refreshWarning} onReset={handleReset} />
        )}
      </main>
    </div>
  );
}

// ── Ingestion history table ──────────────────────────────────────────────────

interface IngestedRow {
  id: string;
  character: string | null;
  game_version: string | null;
  published_at: string;
  is_active: boolean;
  source_image_url: string | null;
  ingestion_method: "vision_llm" | "manual_confirm" | "scraped";
  ingested_at: string;
  entry_count: number;
  source: {
    id: string;
    author: string;
    source_type: SourceType;
    source_url: string | null;
    trust_weight: number;
  };
}

const fetcher = async (url: string): Promise<{ lists: IngestedRow[] }> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
};

function IngestedListsTable() {
  const { data, error, isLoading } = useSWR<{ lists: IngestedRow[] }>(
    "/api/admin/tier-lists",
    fetcher,
    { revalidateOnFocus: false },
  );
  const [showInactive, setShowInactive] = useState(false);
  const [authorFilter, setAuthorFilter] = useState<string>("");

  const lists = data?.lists ?? [];
  // Unique authors, case-insensitive-sorted, from the currently-loaded data.
  // Keeps the dropdown scoped to authors that actually exist.
  const authors = useMemo(() => {
    const set = new Set<string>();
    for (const l of lists) if (l.source.author) set.add(l.source.author);
    return Array.from(set).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
  }, [lists]);

  const visible = lists
    .filter((l) => (showInactive ? true : l.is_active))
    .filter((l) => !authorFilter || l.source.author === authorFilter);
  const activeCount = lists.filter((l) => l.is_active).length;
  const inactiveCount = lists.length - activeCount;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-200">Prior Ingestions</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {isLoading
              ? "Loading…"
              : `${activeCount} active${inactiveCount > 0 ? ` · ${inactiveCount} superseded` : ""}${authorFilter ? ` · filtered to ${authorFilter}` : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {authors.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <span>Author</span>
              <select
                value={authorFilter}
                onChange={(e) => setAuthorFilter(e.target.value)}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
              >
                <option value="">All ({authors.length})</option>
                {authors.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
          )}
          {inactiveCount > 0 && (
            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-900"
              />
              Show superseded
            </label>
          )}
        </div>
      </div>
      {error ? (
        <div className="px-4 py-6 text-sm text-red-400">
          Failed to load: {error instanceof Error ? error.message : String(error)}
        </div>
      ) : !isLoading && visible.length === 0 ? (
        <div className="px-4 py-6 text-sm text-zinc-500">
          No tier lists ingested yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900/60 text-zinc-400 uppercase tracking-wider">
              <tr>
                <Th>Author</Th>
                <Th>Type</Th>
                <Th>Character</Th>
                <Th>Version</Th>
                <Th>Published</Th>
                <Th className="text-right">Cards</Th>
                <Th className="text-right">Trust</Th>
                <Th>Ingested</Th>
                <Th>Method</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {visible.map((row) => (
                <tr
                  key={row.id}
                  className={`${row.is_active ? "text-zinc-200" : "text-zinc-600"} hover:bg-zinc-900/40 transition-colors`}
                >
                  <Td>
                    {row.source.source_url ? (
                      <a
                        href={row.source.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-emerald-400 hover:underline"
                      >
                        {row.source.author}
                      </a>
                    ) : (
                      row.source.author
                    )}
                  </Td>
                  <Td className="text-zinc-500">{row.source.source_type}</Td>
                  <Td>{row.character ?? "any"}</Td>
                  <Td className="text-zinc-500">{row.game_version ?? "—"}</Td>
                  <Td className="text-zinc-500">{formatDate(row.published_at)}</Td>
                  <Td className="text-right font-mono">{row.entry_count}</Td>
                  <Td className="text-right font-mono text-zinc-500">
                    {row.source.trust_weight.toFixed(1)}
                  </Td>
                  <Td className="text-zinc-500">
                    {formatRelative(row.ingested_at)}
                  </Td>
                  <Td>
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono ${methodBadge(row.ingestion_method)}`}
                    >
                      {row.ingestion_method}
                    </span>
                    {!row.is_active && (
                      <span className="ml-1 text-[10px] text-zinc-600 uppercase">superseded</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`px-3 py-2 text-left font-medium text-[10px] ${className}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-3 py-2 whitespace-nowrap ${className}`}>{children}</td>
  );
}

function methodBadge(method: IngestedRow["ingestion_method"]): string {
  if (method === "scraped") return "bg-blue-500/10 text-blue-400";
  if (method === "manual_confirm") return "bg-zinc-700/40 text-zinc-400";
  return "bg-purple-500/10 text-purple-400";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().split("T")[0];
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toISOString().split("T")[0];
}

// ── Step 1: Upload form ───────────────────────────────────────────────────────

function UploadStep({
  meta,
  ingestMode,
  imageFile,
  scrapeUrl,
  scrapeHtml,
  submitting,
  onMetaChange,
  onIngestModeChange,
  onImageChange,
  onScrapeUrlChange,
  onScrapeHtmlChange,
  onSubmit,
}: {
  meta: SourceMeta;
  ingestMode: IngestMode;
  imageFile: File | null;
  scrapeUrl: string;
  scrapeHtml: string;
  submitting: boolean;
  onMetaChange: (m: SourceMeta) => void;
  onIngestModeChange: (m: IngestMode) => void;
  onImageChange: (f: File | null) => void;
  onScrapeUrlChange: (v: string) => void;
  onScrapeHtmlChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const set = <K extends keyof SourceMeta>(k: K, v: SourceMeta[K]) =>
    onMetaChange({ ...meta, [k]: v });

  const inputCls =
    "w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600";
  const labelCls = "text-sm text-zinc-400";

  const canSubmit =
    ingestMode === "image" ? !!imageFile : !!scrapeUrl && !!scrapeHtml;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <h2 className="text-lg font-semibold text-zinc-100">Ingest Tier List</h2>

      {/* Mode toggle */}
      <div className="inline-flex rounded-md border border-zinc-800 p-0.5 bg-zinc-950">
        <ModeTab
          active={ingestMode === "image"}
          label="Upload image"
          hint="Gemini vision"
          onClick={() => onIngestModeChange("image")}
        />
        <ModeTab
          active={ingestMode === "scrape"}
          label="Paste HTML"
          hint="tiermaker.com, …"
          onClick={() => onIngestModeChange("scrape")}
        />
      </div>

      {/* Source input */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
        {ingestMode === "image" ? (
          <>
            <h3 className="text-sm font-medium text-zinc-300">Image</h3>
            <div>
              <label className={labelCls}>Tier list image</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onImageChange(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-sm file:text-zinc-300 hover:file:bg-zinc-700 cursor-pointer"
              />
            </div>
            {imageFile && (
              <p className="text-xs text-zinc-500">{imageFile.name}</p>
            )}
          </>
        ) : (
          <>
            <h3 className="text-sm font-medium text-zinc-300">Paste from source</h3>
            <p className="text-xs text-zinc-500">
              Open the tier list in your browser, inspect the tier container,
              copy its <code className="font-mono">outerHTML</code>, and paste
              below. Cards are matched to our DB by image-hash.
            </p>
            <div>
              <label className={labelCls}>Source URL</label>
              <input
                type="url"
                value={scrapeUrl}
                onChange={(e) => onScrapeUrlChange(e.target.value)}
                placeholder="https://tiermaker.com/…"
                className={`mt-1 ${inputCls}`}
              />
            </div>
            <div>
              <label className={labelCls}>Tier list HTML</label>
              <textarea
                value={scrapeHtml}
                onChange={(e) => onScrapeHtmlChange(e.target.value)}
                placeholder='<div id="tier-wrap">…</div>'
                rows={8}
                className={`mt-1 ${inputCls} font-mono text-[11px] leading-snug`}
              />
              <p className="mt-1 text-[11px] text-zinc-600">
                {scrapeHtml.length.toLocaleString()} chars pasted
              </p>
            </div>
          </>
        )}
      </section>

      {/* Source metadata */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-4">
        <h3 className="text-sm font-medium text-zinc-300">Source Metadata</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Author</label>
            <input
              type="text"
              required
              value={meta.author}
              onChange={(e) => set("author", e.target.value)}
              placeholder="e.g. alphabetical"
              className={`mt-1 ${inputCls}`}
            />
            {meta.author && (
              <p className="mt-1 text-[11px] text-zinc-600">
                source_id: <code className="font-mono text-zinc-500">{deriveSourceId(meta.author, meta.source_type)}</code>
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>Source Type</label>
            <select
              value={meta.source_type}
              onChange={(e) => set("source_type", e.target.value as SourceType)}
              className={`mt-1 ${inputCls}`}
            >
              <option value="image">Image</option>
              <option value="spreadsheet">Spreadsheet</option>
              <option value="website">Website</option>
              <option value="reddit">Reddit</option>
              <option value="youtube">YouTube</option>
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls}>Source URL (optional)</label>
          <input
            type="url"
            value={meta.source_url}
            onChange={(e) => set("source_url", e.target.value)}
            placeholder="https://..."
            className={`mt-1 ${inputCls}`}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Trust Weight (0–2)</label>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={meta.trust_weight}
              onChange={(e) => set("trust_weight", parseFloat(e.target.value))}
              className={`mt-1 ${inputCls}`}
            />
          </div>
          <div>
            <label className={labelCls}>Scale Type</label>
            <select
              value={meta.scale_type}
              onChange={(e) => set("scale_type", e.target.value as ScaleType)}
              className={`mt-1 ${inputCls}`}
            >
              <option value="letter_6">Letter 6 (S/A/B/C/D/F)</option>
              <option value="letter_5">Letter 5 (S/A/B/C/D)</option>
              <option value="numeric_10">Numeric 10 (1–10)</option>
              <option value="numeric_5">Numeric 5 (1–5)</option>
              <option value="binary">Binary (good/bad)</option>
            </select>
          </div>
        </div>
      </section>

      {/* List metadata */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-4">
        <h3 className="text-sm font-medium text-zinc-300">List Metadata</h3>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Character</label>
            <select
              value={meta.character}
              onChange={(e) => set("character", e.target.value as Character)}
              className={`mt-1 ${inputCls}`}
            >
              <option value="any">(Any / cross-character)</option>
              <option value="ironclad">Ironclad</option>
              <option value="silent">Silent</option>
              <option value="defect">Defect</option>
              <option value="regent">Regent</option>
              <option value="necrobinder">Necrobinder</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Game Version</label>
            <input
              type="text"
              value={meta.game_version}
              onChange={(e) => set("game_version", e.target.value)}
              placeholder="e.g. 0.3.5"
              className={`mt-1 ${inputCls}`}
            />
          </div>
          <div>
            <label className={labelCls}>Published Date</label>
            <input
              type="date"
              required
              value={meta.published_at}
              onChange={(e) => set("published_at", e.target.value)}
              className={`mt-1 ${inputCls}`}
            />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting || !canSubmit}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting
            ? ingestMode === "scrape"
              ? "Scraping..."
              : "Extracting..."
            : ingestMode === "scrape"
              ? "Scrape & Match"
              : "Extract Tiers"}
        </button>
      </div>
    </form>
  );
}

function ModeTab({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      <span className="font-medium">{label}</span>
      <span className="ml-1.5 text-[11px] text-zinc-500">{hint}</span>
    </button>
  );
}

// ── Step 2: Preview ───────────────────────────────────────────────────────────

function PreviewStep({
  meta,
  result,
  cards,
  tierMapping,
  submitting,
  onCardsChange,
  onTierMappingChange,
  onBack,
  onDiscard,
  onConfirm,
}: {
  meta: SourceMeta;
  result: ExtractResult;
  cards: ExtractedCard[];
  tierMapping: Record<string, LetterOption>;
  submitting: boolean;
  onCardsChange: (cards: ExtractedCard[]) => void;
  onTierMappingChange: (m: Record<string, LetterOption>) => void;
  onBack: () => void;
  onDiscard: () => void;
  onConfirm: () => void;
}) {
  const { extraction, imageUrl, cardIdMap } = result;

  const removeCard = (idx: number) =>
    onCardsChange(cards.filter((_, i) => i !== idx));

  const updateCard = (idx: number, patch: Partial<ExtractedCard>) =>
    onCardsChange(cards.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  // Group ALL cards (matched + unmatched) by tier so unmatched cards stay
  // in their extracted position — admin can match them inline while
  // comparing against the source image.
  const allByTier = cards
    .map((c, i) => ({ card: c, idx: i }))
    .reduce<Record<string, Array<{ card: ExtractedCard; idx: number }>>>(
      (acc, entry) => {
        acc[entry.card.tier] = acc[entry.card.tier] ?? [];
        acc[entry.card.tier].push(entry);
        return acc;
      },
      {},
    );

  const saveableCount = cards.filter((c) => cardIdMap[c.matchedName ?? c.name]).length;
  const unmatchedCount = cards.length - saveableCount;
  const totalScraped = result.scrapedCards?.length ?? cards.length;
  const droppedFromScrape = totalScraped - cards.length;

  const detectedScale = extraction.detected_scale;
  const detectedCharacter = extraction.detected_character;
  const scaleMismatch = detectedScale && detectedScale !== meta.scale_type;
  const characterMismatch =
    detectedCharacter &&
    meta.character !== "any" &&
    detectedCharacter.toLowerCase() !== meta.character;

  // Dropdown options: union of the scale's standard options (S/A/…) with any
  // raw labels actually present in the list. Preserves source-order for
  // descriptive scales ("Premium", "Want in most decks") so the dropdown
  // shows the card's real tier instead of falling back to the first letter.
  const detectedTiers: string[] = [];
  const seenTiers = new Set<string>();
  for (const c of cards) {
    if (!seenTiers.has(c.tier)) {
      seenTiers.add(c.tier);
      detectedTiers.push(c.tier);
    }
  }
  const standardOptions = getTierOptions(meta.scale_type);
  const tierOptions = [
    ...detectedTiers,
    ...standardOptions.filter((o) => !seenTiers.has(o)),
  ];

  const inputCls =
    "rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Review Extraction</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Draft auto-saved — safe to reload.{" "}
            <button
              onClick={() => {
                if (confirm("Discard the current extraction draft?")) onDiscard();
              }}
              className="text-zinc-500 hover:text-red-400 underline-offset-2 hover:underline transition-colors"
            >
              Discard
            </button>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onBack}
            disabled={submitting}
            className="rounded-md border border-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-600 transition-colors disabled:opacity-50"
          >
            Back
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting || saveableCount === 0}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting
              ? "Saving..."
              : `Confirm & Save (${saveableCount} cards${saveableCount < cards.length ? `, ${cards.length - saveableCount} unmatched` : ""})`}
          </button>
        </div>
      </div>

      {/* Tier label mapping — only shown when a raw tier label isn't a
          standard letter/number, e.g. "Premium", "Want in most decks", "Bad".
          Auto-inferred by position; admin can override. */}
      {(() => {
        const rawLabels = Array.from(new Set(cards.map((c) => c.tier)));
        const nonStandard = rawLabels.filter(
          (l) => !isStandardTierLabel(l, meta.scale_type),
        );
        if (nonStandard.length === 0) return null;
        return (
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4 space-y-3">
            <div>
              <p className="text-xs font-medium text-zinc-300 uppercase tracking-wide">
                Tier Label Mapping
              </p>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Source uses descriptive labels. Each maps to a letter tier —
                adjust if the auto-inferred order is wrong.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {rawLabels.map((raw) => {
                const isStd = isStandardTierLabel(raw, meta.scale_type);
                const value = isStd
                  ? (raw.toUpperCase() as LetterOption)
                  : (tierMapping[raw] ?? "C");
                return (
                  <label
                    key={raw}
                    className="flex items-center gap-2 text-xs text-zinc-300"
                  >
                    <span className="truncate flex-1" title={raw}>
                      {raw}
                    </span>
                    <span className="text-zinc-600">→</span>
                    <select
                      value={value}
                      disabled={isStd}
                      onChange={(e) =>
                        onTierMappingChange({
                          ...tierMapping,
                          [raw]: e.target.value as LetterOption,
                        })
                      }
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs font-mono text-zinc-200 disabled:opacity-50"
                    >
                      {LETTER_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Warnings */}
      {extraction.warnings && extraction.warnings.length > 0 && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 space-y-1">
          <p className="text-xs font-medium text-yellow-400 uppercase tracking-wide">
            Extraction Warnings
          </p>
          {extraction.warnings.map((w, i) => (
            <p key={i} className="text-sm text-yellow-300">
              {w}
            </p>
          ))}
        </div>
      )}

      {/* Scale / character mismatch notices */}
      {(scaleMismatch || characterMismatch) && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 space-y-1">
          <p className="text-xs font-medium text-yellow-400 uppercase tracking-wide">
            Detection Mismatch
          </p>
          {scaleMismatch && (
            <p className="text-sm text-yellow-300">
              Detected scale <strong>{detectedScale}</strong> differs from form
              value <strong>{meta.scale_type}</strong>. Using form value.
            </p>
          )}
          {characterMismatch && (
            <p className="text-sm text-yellow-300">
              Detected character <strong>{detectedCharacter}</strong> differs
              from form value <strong>{meta.character}</strong>. Using form
              value.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-[1fr_2fr] gap-6">
        {/* Uploaded image or scrape source */}
        <div className="space-y-2">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">
            {imageUrl ? "Source Image" : "Source"}
          </p>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt="Uploaded tier list"
              className="w-full rounded-md border border-zinc-800 object-contain max-h-[600px]"
            />
          ) : (
            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400 break-all">
              <p className="text-zinc-500 mb-1">Scraped from:</p>
              {result.sourceUrl ? (
                <a
                  href={result.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-400 hover:underline"
                >
                  {result.sourceUrl}
                </a>
              ) : (
                <span>unknown</span>
              )}
            </div>
          )}
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 space-y-1 text-xs text-zinc-500">
            <p>
              <span className="text-zinc-400">Detected scale:</span>{" "}
              {detectedScale ?? "—"}
            </p>
            <p>
              <span className="text-zinc-400">Detected character:</span>{" "}
              {detectedCharacter ?? "—"}
            </p>
            <p>
              <span className="text-zinc-400">Total extracted:</span>{" "}
              {cards.length} cards
            </p>
            {droppedFromScrape > 0 && (
              <p className="text-orange-400">
                <span className="text-zinc-400">Dropped from scrape:</span>{" "}
                {droppedFromScrape}
              </p>
            )}
          </div>
        </div>

        {/* Right column: tier groups with inline matched/unmatched cards */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500 uppercase tracking-wide">
              Extracted Tiers
            </p>
            {unmatchedCount > 0 && (
              <span className="text-xs text-orange-300">
                {unmatchedCount} unmatched — resolve inline
              </span>
            )}
          </div>

          {Object.entries(allByTier).map(([tier, entries]) => (
            <div
              key={tier}
              className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden"
            >
              <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900 flex items-center">
                <span className={`text-sm font-semibold ${getTierColor(tier)}`}>
                  Tier {tier}
                </span>
                <span className="ml-2 text-xs text-zinc-500">
                  {entries.length} cards
                </span>
              </div>
              <div className="divide-y divide-zinc-900">
                {entries.map(({ card, idx }) => {
                  const resolvedName = card.matchedName ?? card.name;
                  const isMatched = !!cardIdMap[resolvedName];
                  return (
                    <div
                      key={`${tier}-${idx}`}
                      className={`px-3 py-2 ${isMatched ? "hover:bg-zinc-900/50" : "bg-orange-500/5 border-l-2 border-orange-500/50"} transition-colors`}
                    >
                      <div className="flex items-center gap-2">
                        {card.sourceImageUrl && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={card.sourceImageUrl}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              // Hide the element entirely on failure so admins
                              // don't see a broken-image placeholder for hosts
                              // that block hotlinking or URLs that 404.
                              e.currentTarget.style.display = "none";
                            }}
                            className="h-10 w-8 shrink-0 rounded object-cover border border-zinc-800 bg-zinc-900"
                          />
                        )}
                        {isMatched ? (
                          <span className="text-sm text-zinc-200 truncate min-w-0 flex-1">
                            {resolvedName}
                            {card.matchedName && card.matchedName !== card.name && (
                              <span className="ml-1 text-xs text-zinc-500">
                                ({card.name})
                              </span>
                            )}
                          </span>
                        ) : (
                          <div className="flex-1 flex items-center gap-2 min-w-0">
                            <span className="text-xs text-orange-300 font-mono truncate shrink-0 max-w-[45%]">
                              {card.name || "(unnamed)"}
                            </span>
                            <span className="text-xs text-orange-500/60 shrink-0">→</span>
                            <CardCombobox
                              value={card.matchedName ?? ""}
                              cardIdMap={cardIdMap}
                              defaultQuery={card.name}
                              onChange={(name) =>
                                updateCard(idx, { matchedName: name ?? undefined })
                              }
                            />
                          </div>
                        )}
                        <div className="flex items-center gap-2 shrink-0">
                          <ConfidenceBadge confidence={card.confidence} />
                          <select
                            value={card.tier}
                            onChange={(e) => updateCard(idx, { tier: e.target.value })}
                            className={inputCls}
                            aria-label={`Tier for ${card.name}`}
                          >
                            {tierOptions.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                          {card.matchedName && card.matchedName !== card.name && (
                            <button
                              onClick={() => updateCard(idx, { matchedName: undefined })}
                              className="text-xs text-zinc-600 hover:text-orange-400 transition-colors"
                              aria-label={`Unmatch ${card.name}`}
                            >
                              Unmatch
                            </button>
                          )}
                          <button
                            onClick={() => removeCard(idx)}
                            className="text-zinc-600 hover:text-red-400 transition-colors"
                            aria-label={`Remove ${card.name}`}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {cards.length === 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-8 text-center">
              <p className="text-sm text-zinc-500">No cards remaining.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 3: Success ───────────────────────────────────────────────────────────

function SuccessStep({
  count,
  refreshWarning,
  onReset,
}: {
  count: number;
  refreshWarning: string | null;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 space-y-6">
      <div className="rounded-full bg-emerald-500/10 border border-emerald-500/30 p-6">
        <CheckIcon />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-zinc-100">Tier list saved</h2>
        <p className="text-sm text-zinc-400">
          {count} {count === 1 ? "entry" : "entries"} persisted to the database.
        </p>
      </div>
      {refreshWarning && (
        <div className="max-w-md rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-300">
          <p className="font-medium">Consensus view not refreshed</p>
          <p className="mt-1 text-xs text-yellow-400/80">
            Data saved but the aggregation view could not be refreshed (likely
            a concurrent write). Retry another ingest to trigger a refresh, or
            run{" "}
            <code className="font-mono">
              select refresh_community_tier_consensus();
            </code>{" "}
            manually.
          </p>
          <p className="mt-1 font-mono text-[11px] text-yellow-400/60">
            {refreshWarning}
          </p>
        </div>
      )}
      <button
        onClick={onReset}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
      >
        Ingest another
      </button>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Filterable combobox for matching extracted names to canonical cards.
// Substring match, case-insensitive, prefix matches rank first, up to 20 results.
// Keyboard: ↑↓ navigate, Enter select, Esc close. Seeds the input with the
// extracted name so the admin can skim matches without retyping.
function CardCombobox({
  value,
  cardIdMap,
  defaultQuery,
  onChange,
}: {
  value: string;
  cardIdMap: Record<string, string>;
  defaultQuery?: string;
  onChange: (name: string | null) => void;
}) {
  const allNames = useMemo(
    () => Object.keys(cardIdMap).sort((a, b) => a.localeCompare(b)),
    [cardIdMap],
  );

  const [query, setQuery] = useState(value || defaultQuery || "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Sync external value changes (e.g. "Unmatch" button)
  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allNames.slice(0, 20);
    const prefix: string[] = [];
    const contains: string[] = [];
    for (const name of allNames) {
      const lower = name.toLowerCase();
      if (lower.startsWith(q)) prefix.push(name);
      else if (lower.includes(q)) contains.push(name);
    }
    return [...prefix, ...contains].slice(0, 20);
  }, [query, allNames]);

  const commit = (name: string) => {
    setQuery(name);
    onChange(name);
    setOpen(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && matches[highlight]) commit(matches[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const isValidMatch = !!cardIdMap[query];

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
          // Clear matched state if query no longer corresponds to a valid card
          if (!cardIdMap[e.target.value] && value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        placeholder="Type to search cards…"
        className={`w-full rounded border ${
          isValidMatch
            ? "border-emerald-600/50 bg-emerald-900/10"
            : "border-zinc-700 bg-zinc-900"
        } px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500`}
      />
      {open && matches.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
          {matches.map((name, i) => (
            <li
              key={name}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(name);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`cursor-pointer px-2 py-1 text-xs ${
                i === highlight
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-300"
              }`}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const cls =
    confidence >= 0.9
      ? "text-emerald-400 bg-emerald-500/10"
      : confidence >= 0.7
        ? "text-yellow-400 bg-yellow-500/10"
        : "text-red-400 bg-red-500/10";
  return (
    <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${cls}`}>
      {pct}%
    </span>
  );
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-emerald-400"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// Persist in-progress extraction drafts to localStorage. The image lives
// in Supabase Storage so only its URL needs to be persisted — no binary
// data. Versioned key so schema changes don't resurrect stale drafts.
const DRAFT_KEY = "sts2-tier-list-draft-v1";

interface Draft {
  step: Step;
  meta: SourceMeta;
  ingestMode?: IngestMode;
  extractResult: ExtractResult;
  cards: ExtractedCard[];
  tierMapping?: Record<string, LetterOption>;
}

function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    // Minimal sanity check — require the shape we need to render preview.
    // A scraped draft has a null imageUrl but still has a source URL + cards.
    const er = parsed.extractResult;
    const hasSource = !!er && (er.imageUrl || er.sourceUrl);
    if (!hasSource || !Array.isArray(parsed.cards)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDraft(draft: Draft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Quota exceeded or storage unavailable — not critical, skip silently
  }
}

function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore
  }
}

// Normalize a card name for fuzzy matching. Common OCR / source-format drift
// that should still match the canonical entry:
//   - Casing ("Pact's End" vs "pact's end")
//   - Upgraded variants ("Strike+" vs "Strike")
//   - Apostrophes dropped by OCR ("Pacts End" vs "Pact's End")
//   - Hyphen/en-dash variants
//   - Extra whitespace
// We strip all non-alphanumeric characters (except spaces) to canonicalize.
function normalizeCardName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\+/g, "")
    .replace(/[^a-z0-9\s]/g, "") // drop apostrophes, hyphens, punctuation
    .replace(/\s+/g, " ")
    .trim();
}

// Resolve an extracted name to a canonical one via:
//   1. Exact match against cardIdMap (return as-is, no matchedName needed)
//   2. Normalized match against the pre-built lookup (return canonical)
// Returns null when no match is found — card goes to the unmatched section.
function resolveExtractedName(
  extracted: string,
  cardIdMap: Record<string, string>,
  normalizedLookup: Map<string, string>,
): string | null {
  if (cardIdMap[extracted]) return extracted;
  const canonical = normalizedLookup.get(normalizeCardName(extracted));
  return canonical ?? null;
}

// Prepare a tier list screenshot for upload without sacrificing text quality.
// Card name OCR is the bottleneck — lossy compression softens text edges
// and hurts extraction accuracy, so we avoid it whenever possible.
//
// Strategy:
//   1. File is small enough → send as-is (no processing, no quality loss).
//   2. Dimensions are too large → lossless resize via canvas, output as PNG.
//   3. Source is something else weird → fall through and send the original.
//
// We never use JPEG here — tier list text would suffer.
async function downscaleImage(file: File, maxEdge: number): Promise<File> {
  const MAX_SIZE_NO_TOUCH = 20 * 1024 * 1024; // 20MB — Gemini's per-image cap

  // Fast path: file is already under Gemini's limit, don't re-encode.
  if (file.size <= MAX_SIZE_NO_TOUCH) return file;

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const longest = Math.max(width, height);

  if (longest <= maxEdge) {
    bitmap.close();
    return file;
  }

  const scale = maxEdge / longest;
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  // High-quality downscale for text legibility
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  // Lossless PNG preserves text edges — size cost is acceptable at these
  // dimensions and we've already resized so it won't be huge.
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) return file;

  return new File([blob], file.name.replace(/\.\w+$/, ".png"), {
    type: "image/png",
    lastModified: Date.now(),
  });
}
