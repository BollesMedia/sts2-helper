import { NextResponse } from "next/server";
import { z } from "zod";
import { withAdmin } from "@/lib/api-admin-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveAdapter } from "@sts2/shared/tier-sources";
import { matchSection, type CardRow } from "@/lib/tier-refresh/match-cards";

const MAX_HTML_BYTES = 8 * 1024 * 1024;

const scrapeSchema = z.object({
  // Tolerant URL field: accepts bare `tiermaker.com/x/y` or protocol-less
  // input and upgrades to https://. Full URLs pass through untouched.
  url: z
    .string()
    .min(3)
    .transform((raw) => {
      const trimmed = raw.trim();
      if (/^https?:\/\//i.test(trimmed)) return trimmed;
      return `https://${trimmed.replace(/^\/\//, "")}`;
    })
    .refine((u) => {
      try {
        new URL(u);
        return true;
      } catch {
        return false;
      }
    }, "Not a valid URL"),
  html: z.string().min(1).max(MAX_HTML_BYTES),
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

export const POST = withAdmin(async (request) => {
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

  const adapterResult = adapter.parse(html, url);
  const totalCards = adapterResult.sections.reduce(
    (sum, s) => sum + s.cards.length,
    0,
  );
  if (totalCards === 0) {
    return NextResponse.json(
      {
        error: "No cards found in pasted HTML",
        warnings: adapterResult.warnings,
      },
      { status: 422 },
    );
  }

  const supabase = createServiceClient();

  const { data: cardsData, error: cardsError } = await supabase
    .from("cards")
    .select("id, name, color, phash");
  if (cardsError) {
    console.error("[Tier Lists Scrape] Card fetch failed:", cardsError);
    return NextResponse.json({ error: "Card fetch failed" }, { status: 500 });
  }

  const candidates = (cardsData ?? []) as CardRow[];

  // Adapter owns the host allowlist: only URLs matching the same site that
  // handled the scrape are eligible.
  const { hostname: scrapeHost } = new URL(url);

  const sectionsOut = await Promise.all(
    adapterResult.sections.map(async (section) => {
      const result = await matchSection(section, character, candidates, scrapeHost);
      return {
        detectedCharacter: section.detectedCharacter,
        scaleType: section.scaleType,
        scaleConfig: section.scaleConfig ?? null,
        matched: result.matched,
        unmatched: result.matched.filter((m) => !m.cardId),
        warnings: [...section.warnings, ...result.warnings],
      };
    }),
  );

  return NextResponse.json({
    sections: sectionsOut,
    warnings: adapterResult.warnings,
  });
});
