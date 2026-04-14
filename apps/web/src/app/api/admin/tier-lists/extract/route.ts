import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { requireAdmin } from "@/lib/api-admin-auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  tierExtractionSchema,
  buildTierExtractionSystemPrompt,
} from "@sts2/shared/evaluation/tier-extraction";
import { EVAL_MODELS } from "@sts2/shared/evaluation/models";

// Allowlist MIME types to prevent attacker-controlled extensions serving as HTML
// from the public storage bucket. Keep in sync with migration 023 bucket config.
const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

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

  // Fetch all known cards for the extraction prompt and name→id map
  const { data: cards } = await supabase.from("cards").select("id, name");
  const cardNames = (cards ?? []).map((c) => c.name);
  const cardIdMap: Record<string, string> = {};
  for (const c of cards ?? []) {
    cardIdMap[c.name] = c.id;
  }

  // Call Claude Sonnet with vision
  const systemPrompt = buildTierExtractionSystemPrompt(cardNames);

  try {
    const result = await generateText({
      model: anthropic(EVAL_MODELS.vision),
      maxOutputTokens: 4096,
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

    return NextResponse.json({
      imageUrl,
      extraction: result.output,
      cardIdMap,
    });
  } catch (err) {
    console.error("[Tier Lists Extract] Vision call failed:", err);
    return NextResponse.json(
      {
        error: "Extraction failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
