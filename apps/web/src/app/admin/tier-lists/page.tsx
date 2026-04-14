"use client";

import { useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { LoginScreen } from "@/features/auth/login-screen";
import type { TierExtractionResult } from "@sts2/shared/evaluation/tier-extraction";

// ── Types ────────────────────────────────────────────────────────────────────

type SourceType = "image" | "spreadsheet" | "website" | "reddit" | "youtube";
type ScaleType = "letter_6" | "letter_5" | "numeric_10" | "numeric_5" | "binary";
type Character = "any" | "ironclad" | "silent" | "defect" | "regent" | "necrobinder";

interface SourceMeta {
  id: string;
  author: string;
  source_type: SourceType;
  source_url: string;
  trust_weight: number;
  scale_type: ScaleType;
  character: Character;
  game_version: string;
  published_at: string;
}

interface ExtractedCard {
  name: string;
  tier: string;
  confidence: number;
}

interface ExtractResult {
  imageUrl: string;
  extraction: TierExtractionResult;
  cardIdMap: Record<string, string>;
}

type Step = "upload" | "preview" | "success";

// ── Default form values ───────────────────────────────────────────────────────

const defaultMeta: SourceMeta = {
  id: "",
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
  const isDev = process.env.NODE_ENV === "development";

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-screen bg-background text-foreground">
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (!user && !isDev) {
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
  const [step, setStep] = useState<Step>("upload");
  const [meta, setMeta] = useState<SourceMeta>(defaultMeta);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [extractResult, setExtractResult] = useState<ExtractResult | null>(null);
  const [cards, setCards] = useState<ExtractedCard[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);

  // ── Step 1: Extract ─────────────────────────────────────────────────────────

  const handleExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageFile) return;

    setSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.append("image", imageFile);

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

    const result = data as ExtractResult;
    setExtractResult(result);

    // Flatten tiers → card rows
    const flat: ExtractedCard[] = [];
    for (const tier of result.extraction.tiers ?? []) {
      for (const card of tier.cards) {
        flat.push({ name: card.name, tier: tier.label, confidence: card.confidence });
      }
    }
    setCards(flat);
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
        const card_id = cardIdMap[c.name];
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

    const body = {
      imageUrl,
      source: {
        id: meta.id,
        author: meta.author,
        source_type: meta.source_type,
        source_url: meta.source_url || null,
        trust_weight: meta.trust_weight,
        scale_type: meta.scale_type,
        scale_config: null,
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
  };

  // ── Step 3: Reset ───────────────────────────────────────────────────────────

  const handleReset = () => {
    setStep("upload");
    setMeta(defaultMeta);
    setImageFile(null);
    setExtractResult(null);
    setCards([]);
    setError(null);
    setSavedCount(0);
    setRefreshWarning(null);
  };

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
          <UploadStep
            meta={meta}
            imageFile={imageFile}
            submitting={submitting}
            onMetaChange={setMeta}
            onImageChange={setImageFile}
            onSubmit={handleExtract}
          />
        )}

        {step === "preview" && extractResult && (
          <PreviewStep
            meta={meta}
            result={extractResult}
            cards={cards}
            submitting={submitting}
            onCardsChange={setCards}
            onBack={() => setStep("upload")}
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

// ── Step 1: Upload form ───────────────────────────────────────────────────────

function UploadStep({
  meta,
  imageFile,
  submitting,
  onMetaChange,
  onImageChange,
  onSubmit,
}: {
  meta: SourceMeta;
  imageFile: File | null;
  submitting: boolean;
  onMetaChange: (m: SourceMeta) => void;
  onImageChange: (f: File | null) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const set = <K extends keyof SourceMeta>(k: K, v: SourceMeta[K]) =>
    onMetaChange({ ...meta, [k]: v });

  const inputCls =
    "w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600";
  const labelCls = "text-sm text-zinc-400";

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <h2 className="text-lg font-semibold text-zinc-100">Ingest Tier List</h2>

      {/* Image upload */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
        <h3 className="text-sm font-medium text-zinc-300">Image</h3>
        <div>
          <label className={labelCls}>Tier list image</label>
          <input
            type="file"
            accept="image/*"
            required
            onChange={(e) => onImageChange(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-sm file:text-zinc-300 hover:file:bg-zinc-700 cursor-pointer"
          />
        </div>
        {imageFile && (
          <p className="text-xs text-zinc-500">{imageFile.name}</p>
        )}
      </section>

      {/* Source metadata */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-4">
        <h3 className="text-sm font-medium text-zinc-300">Source Metadata</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Source ID (slug)</label>
            <input
              type="text"
              required
              value={meta.id}
              onChange={(e) => set("id", e.target.value)}
              placeholder="e.g. alphabetical-ironclad-v035"
              className={`mt-1 ${inputCls}`}
            />
          </div>
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
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
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
          disabled={submitting || !imageFile}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Extracting..." : "Extract Tiers"}
        </button>
      </div>
    </form>
  );
}

// ── Step 2: Preview ───────────────────────────────────────────────────────────

function PreviewStep({
  meta,
  result,
  cards,
  submitting,
  onCardsChange,
  onBack,
  onConfirm,
}: {
  meta: SourceMeta;
  result: ExtractResult;
  cards: ExtractedCard[];
  submitting: boolean;
  onCardsChange: (cards: ExtractedCard[]) => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { extraction, imageUrl, cardIdMap } = result;

  const removeCard = (idx: number) =>
    onCardsChange(cards.filter((_, i) => i !== idx));

  // Group cards by tier for display
  const byTier = cards.reduce<Record<string, ExtractedCard[]>>((acc, card) => {
    acc[card.tier] = acc[card.tier] ?? [];
    acc[card.tier].push(card);
    return acc;
  }, {});

  const unresolvedNames = cards
    .filter((c) => !cardIdMap[c.name])
    .map((c) => c.name);

  const detectedScale = extraction.detected_scale;
  const detectedCharacter = extraction.detected_character;
  const scaleMismatch =
    detectedScale && detectedScale !== meta.scale_type;
  const characterMismatch =
    detectedCharacter &&
    meta.character !== "any" &&
    detectedCharacter.toLowerCase() !== meta.character;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Review Extraction</h2>
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
            disabled={submitting || cards.length === 0}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Saving..." : `Confirm & Save (${cards.length} cards)`}
          </button>
        </div>
      </div>

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

      {/* Unresolved cards warning */}
      {unresolvedNames.length > 0 && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/10 px-4 py-3 space-y-1">
          <p className="text-xs font-medium text-orange-400 uppercase tracking-wide">
            Unresolved Cards ({unresolvedNames.length})
          </p>
          <p className="text-sm text-orange-300">
            These cards were not found in the card database and will be skipped:{" "}
            {unresolvedNames.join(", ")}
          </p>
        </div>
      )}

      <div className="grid grid-cols-[1fr_2fr] gap-6">
        {/* Uploaded image */}
        <div className="space-y-2">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">
            Source Image
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Uploaded tier list"
            className="w-full rounded-md border border-zinc-800 object-contain max-h-[600px]"
          />
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
          </div>
        </div>

        {/* Card list grouped by tier */}
        <div className="space-y-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">
            Extracted Tiers
          </p>
          {Object.entries(byTier).map(([tier, tierCards]) => (
            <div key={tier} className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
              <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900">
                <span className="text-sm font-semibold text-zinc-100">
                  Tier {tier}
                </span>
                <span className="ml-2 text-xs text-zinc-500">
                  {tierCards.length} cards
                </span>
              </div>
              <div className="divide-y divide-zinc-900">
                {tierCards.map((card) => {
                  const globalIdx = cards.indexOf(card);
                  const isUnresolved = !cardIdMap[card.name];
                  return (
                    <div
                      key={`${tier}-${card.name}`}
                      className="flex items-center justify-between px-3 py-2 hover:bg-zinc-900/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`text-sm truncate ${isUnresolved ? "text-orange-400" : "text-zinc-200"}`}
                        >
                          {card.name}
                          {isUnresolved && (
                            <span className="ml-1 text-xs text-orange-500">
                              (unresolved)
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <ConfidenceBadge confidence={card.confidence} />
                        <button
                          onClick={() => removeCard(globalIdx)}
                          className="text-zinc-600 hover:text-red-400 transition-colors"
                          aria-label={`Remove ${card.name}`}
                        >
                          <TrashIcon />
                        </button>
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
