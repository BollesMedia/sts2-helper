import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { google } from "@ai-sdk/google";
import { requireAdmin } from "@/lib/api-admin-auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  tierExtractionSchema,
  buildTierExtractionSystemPrompt,
} from "@sts2/shared/evaluation/tier-extraction";

// Gemini 2.5 Pro one-shots tier list extraction where Claude Opus 4.6 and
// Gemini 2.5 Flash both struggled (tested against dense horizontal-row tier
// list screenshots with ~150 cards). Requires GOOGLE_GENERATIVE_AI_API_KEY
// with paid billing on the associated Cloud project.
// Extraction cost: ~$0.05 per image.
const VISION_MODEL = "gemini-2.5-pro";

// Allowlist MIME types to prevent attacker-controlled extensions serving as HTML
// from the public storage bucket. Keep in sync with migration 023 bucket config.
const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB — matches next.config proxyClientMaxBodySize

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const formData = await request.formData();
  const file = formData.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing image file" }, { status: 400 });
  }

  const ext = ALLOWED_MIME_TO_EXT[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: `Unsupported image type: ${file.type}. Allowed: PNG, JPEG, WEBP.` },
      { status: 400 },
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `Image too large (${file.size} bytes). Max ${MAX_IMAGE_BYTES} bytes.` },
      { status: 413 },
    );
  }

  const supabase = createServiceClient();

  // Upload to Supabase Storage with canonical extension + server-controlled content-type
  const filename = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const bytes = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from("tier-list-images")
    .upload(filename, bytes, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("[Tier Lists Extract] Upload failed:", uploadError);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const { data: publicUrlData } = supabase.storage
    .from("tier-list-images")
    .getPublicUrl(filename);
  const imageUrl = publicUrlData.publicUrl;

  // Fetch all known cards — client uses this to match extracted names
  // to canonical IDs (matching happens client-side, not in the prompt).
  const { data: cards } = await supabase.from("cards").select("id, name");
  const cardIdMap: Record<string, string> = {};
  for (const c of cards ?? []) {
    cardIdMap[c.name] = c.id;
  }

  const systemPrompt = buildTierExtractionSystemPrompt();

  try {
    const result = await generateText({
      model: google(VISION_MODEL),
      // Gemini 2.5 Pro reserves part of this budget for internal "thinking"
      // tokens, leaving less for the actual structured-output JSON. A
      // 150-card tier list needs ~12K output tokens; give plenty of headroom.
      maxOutputTokens: 32768,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: new URL(imageUrl),
            },
            {
              type: "text",
              text: "Extract the tier list from this image. Return the structured JSON per the schema.",
            },
          ],
        },
      ],
      output: Output.object({ schema: tierExtractionSchema }),
    });

    // Clamp confidence values to [0, 1] — schema can't enforce bounds
    // on number fields (Anthropic rejects min/max on number/integer types)
    const extraction = result.output;
    for (const tier of extraction.tiers ?? []) {
      for (const card of tier.cards) {
        card.confidence = Math.max(0, Math.min(1, card.confidence));
      }
    }

    return NextResponse.json({
      imageUrl,
      extraction,
      cardIdMap,
    });
  } catch (err) {
    // Surface the raw model output (when available) so we can diagnose
    // whether it's a token-budget issue, schema-mismatch, or refusal.
    const rawOutput =
      err && typeof err === "object" && "text" in err
        ? (err as { text?: unknown }).text
        : undefined;
    const finishReason =
      err && typeof err === "object" && "finishReason" in err
        ? (err as { finishReason?: unknown }).finishReason
        : undefined;

    console.error("[Tier Lists Extract] Vision call failed:", {
      message: err instanceof Error ? err.message : String(err),
      finishReason,
      rawOutputPreview:
        typeof rawOutput === "string" ? rawOutput.slice(0, 500) : rawOutput,
    });

    return NextResponse.json(
      {
        error: "Extraction failed",
        detail: err instanceof Error ? err.message : String(err),
        finishReason,
      },
      { status: 500 },
    );
  }
}
