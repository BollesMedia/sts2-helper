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

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const formData = await request.formData();
  const file = formData.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing image file" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Upload to Supabase Storage
  const ext = file.name.split(".").pop() || "png";
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
