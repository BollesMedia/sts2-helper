# Supabase → Neon + Clerk Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase (DB + Auth) with Neon (DB) + Clerk (Auth) to eliminate $25/mo cost.

**Architecture:** Neon serverless Postgres for all database queries. Clerk for auth (email/password + Discord OAuth). Desktop keeps browser-based OAuth with `sts2replay://` deep links. All desktop data access routes through the Next.js API — no direct DB connections from the client.

**Tech Stack:** `@neondatabase/serverless`, `@clerk/nextjs` (web), `@clerk/clerk-js` (desktop/Tauri), Vitest

**Spec:** `docs/superpowers/specs/2026-04-05-supabase-to-neon-clerk-migration-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/src/lib/db.ts` | Neon serverless SQL client factory |
| `apps/web/src/app/api/game-data/cards/route.ts` | Public GET: all cards |
| `apps/web/src/app/api/game-data/relics/route.ts` | Public GET: all relics |
| `apps/web/src/app/api/game-data/monsters/route.ts` | Public GET: monsters by IDs |
| `apps/web/src/app/api/game-data/characters/route.ts` | Public GET: characters + starter decks |
| `apps/web/src/app/api/game-data/keywords/route.ts` | Public GET: all keywords |
| `apps/web/src/app/api/profile/route.ts` | Authenticated GET: user profile/role |
| `scripts/migrate-schema.sql` | Schema changes for Neon (drop RLS, change user_id type) |
| `scripts/migrate-users.sql` | Template for user ID remapping |
| `packages/shared/evaluation/db-types.ts` | Generic SQL query type alias (avoids Neon dep in shared) |

### Modified Files

| File | Change Summary |
|------|---------------|
| `apps/web/src/middleware.ts` | Add Clerk middleware (clerkMiddleware wrapping CORS) |
| `apps/web/src/app/api/run/route.ts` | Clerk auth + Neon SQL |
| `apps/web/src/app/api/choice/route.ts` | Clerk auth + Neon SQL |
| `apps/web/src/app/api/act-path/route.ts` | Clerk auth + Neon SQL |
| `apps/web/src/app/api/error/route.ts` | Clerk auth + Neon SQL |
| `apps/web/src/app/api/evaluate/route.ts` | Clerk auth + Neon SQL for game data caches |
| `apps/web/src/lib/usage-logger.ts` | Accept Neon sql fn instead of SupabaseClient |
| `apps/web/src/evaluation/run-history-context.ts` | Use Neon sql instead of createServiceClient |
| `apps/web/src/evaluation/strategy/character-strategies.ts` | Use Neon sql instead of createServiceClient |
| `apps/web/src/game-data/sync-codex.ts` | Use Neon client instead of Supabase |
| `packages/shared/evaluation/evaluation-logger.ts` | Accept Neon sql fn instead of SupabaseClient |
| `packages/shared/evaluation/statistical-evaluator.ts` | Accept Neon sql fn instead of SupabaseClient |
| `packages/shared/lib/init.ts` | Remove Supabase config, simplify to API config only |
| `packages/shared/lib/api-client.ts` | Update JSDoc (no functional change) |
| `packages/shared/game-data/use-cards.ts` | Fetch from API instead of Supabase |
| `packages/shared/game-data/use-relics.ts` | Fetch from API instead of Supabase |
| `packages/shared/game-data/use-monsters.ts` | Fetch from API instead of Supabase |
| `packages/shared/game-data/use-potions.ts` | Fetch from API instead of Supabase |
| `packages/shared/game-data/use-keywords.ts` | Fetch from API instead of Supabase |
| `apps/desktop/src/main.tsx` | Replace Supabase init with Clerk init |
| `apps/desktop/src/auth-provider.tsx` | Full rewrite: Clerk JS SDK |
| `apps/desktop/src/lib/card-filter.ts` | Fetch from API instead of Supabase |
| `apps/desktop/src/lib/relic-lookup.ts` | Fetch from API instead of Supabase |
| `apps/desktop/src/lib/upgrade-lookup.ts` | Fetch from API instead of Supabase |
| `apps/desktop/src/views/combat/boss-briefing.tsx` | Fetch from API instead of Supabase |
| `packages/shared/supabase/starter-decks.ts` | Fetch from API instead of Supabase |
| `apps/web/package.json` | Add @clerk/nextjs, @neondatabase/serverless; remove @supabase/* |
| `apps/desktop/package.json` | Add @clerk/clerk-js; remove @supabase/supabase-js |
| `packages/shared/package.json` | Remove @supabase/ssr, @supabase/supabase-js |

### Deleted Files

| File | Reason |
|------|--------|
| `apps/web/src/lib/supabase/server.ts` | Replaced by `apps/web/src/lib/db.ts` |
| `apps/web/src/lib/api-auth.ts` | Replaced by Clerk `auth()` |
| `apps/web/src/app/auth/callback/route.ts` | Clerk handles callbacks internally |
| `packages/shared/supabase/client.ts` | No more Supabase client |
| `packages/shared/supabase/auth.ts` | Auth moves to platform-specific code |

### Kept As-Is (types only, still useful)

| File | Note |
|------|------|
| `packages/shared/supabase/helpers.ts` | Type exports derived from database.types.ts — still valid |
| `packages/shared/types/database.types.ts` | Row/insert types — still valid for Neon queries |

---

## Task 1: Create Feature Branch and Install Dependencies

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/desktop/package.json`
- Modify: `packages/shared/package.json`

- [ ] **Step 1: Create feature branch**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
git checkout -b feat/neon-clerk-migration
```

- [ ] **Step 2: Install web app dependencies**

```bash
cd apps/web
npm install @clerk/nextjs @neondatabase/serverless
npm uninstall @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 3: Install desktop app dependencies**

```bash
cd apps/desktop
npm install @clerk/clerk-js
npm uninstall @supabase/supabase-js
```

- [ ] **Step 4: Update shared package**

```bash
cd packages/shared
npm uninstall @supabase/ssr @supabase/supabase-js
```

- [ ] **Step 5: Verify monorepo builds**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
npm install
```

Expected: lockfile updates, no errors. Build will have TS errors — that's expected since we haven't migrated the code yet.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json apps/web/package.json apps/desktop/package.json packages/shared/package.json
git commit -m "chore: swap supabase deps for clerk + neon"
```

---

## Task 2: Neon DB Client and Schema Migration Script

**Files:**
- Create: `apps/web/src/lib/db.ts`
- Create: `scripts/migrate-schema.sql`
- Create: `scripts/migrate-users.sql`

- [ ] **Step 1: Create Neon DB client**

Create `apps/web/src/lib/db.ts`:

```ts
import { neon } from "@neondatabase/serverless";

export function sql() {
  return neon(process.env.DATABASE_URL!);
}
```

- [ ] **Step 2: Create schema migration SQL**

Create `scripts/migrate-schema.sql`:

```sql
-- Run against Neon after pg_dump restore from Supabase.
-- Drops all Supabase-specific auth references and RLS policies.

-- ============================================
-- Drop RLS policies (user-scoped tables)
-- ============================================

DROP POLICY IF EXISTS "Users can view own runs" ON runs;
DROP POLICY IF EXISTS "Users can insert own runs" ON runs;
DROP POLICY IF EXISTS "Users can update own runs" ON runs;
DROP POLICY IF EXISTS "Users can view own evaluations" ON evaluations;
DROP POLICY IF EXISTS "Users can insert own evaluations" ON evaluations;
DROP POLICY IF EXISTS "Users can view own choices" ON choices;
DROP POLICY IF EXISTS "Users can insert own choices" ON choices;

-- ============================================
-- Drop RLS policies (public read tables)
-- ============================================

DROP POLICY IF EXISTS "Public read cards" ON cards;
DROP POLICY IF EXISTS "Public read relics" ON relics;
DROP POLICY IF EXISTS "Public read potions" ON potions;
DROP POLICY IF EXISTS "Public read monsters" ON monsters;
DROP POLICY IF EXISTS "Public read keywords" ON keywords;
DROP POLICY IF EXISTS "Public read characters" ON characters;
DROP POLICY IF EXISTS "Public read game_versions" ON game_versions;
DROP POLICY IF EXISTS "Public read strategies" ON character_strategies;

-- ============================================
-- Disable RLS on all tables
-- ============================================

ALTER TABLE runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations DISABLE ROW LEVEL SECURITY;
ALTER TABLE choices DISABLE ROW LEVEL SECURITY;
ALTER TABLE cards DISABLE ROW LEVEL SECURITY;
ALTER TABLE relics DISABLE ROW LEVEL SECURITY;
ALTER TABLE potions DISABLE ROW LEVEL SECURITY;
ALTER TABLE monsters DISABLE ROW LEVEL SECURITY;
ALTER TABLE keywords DISABLE ROW LEVEL SECURITY;
ALTER TABLE characters DISABLE ROW LEVEL SECURITY;
ALTER TABLE game_versions DISABLE ROW LEVEL SECURITY;
ALTER TABLE character_strategies DISABLE ROW LEVEL SECURITY;

-- ============================================
-- Drop auth.users FK references
-- ============================================

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_user_id_fkey;
ALTER TABLE evaluations DROP CONSTRAINT IF EXISTS evaluations_user_id_fkey;
ALTER TABLE choices DROP CONSTRAINT IF EXISTS choices_user_id_fkey;

-- ============================================
-- Change user_id from uuid to text
-- (Clerk IDs are strings like "user_2x...")
-- ============================================

ALTER TABLE runs ALTER COLUMN user_id TYPE text USING user_id::text;
ALTER TABLE evaluations ALTER COLUMN user_id TYPE text USING user_id::text;
ALTER TABLE choices ALTER COLUMN user_id TYPE text USING user_id::text;
ALTER TABLE usage_logs ALTER COLUMN user_id TYPE text USING user_id::text;
ALTER TABLE error_logs ALTER COLUMN user_id TYPE text USING user_id::text;

-- Profiles: change PK from uuid to text
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_pkey;
ALTER TABLE profiles ALTER COLUMN id TYPE text USING id::text;
ALTER TABLE profiles ADD PRIMARY KEY (id);
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
```

- [ ] **Step 3: Create user migration template**

Create `scripts/migrate-users.sql`:

```sql
-- Run after users re-register on Clerk.
-- Replace OLD_SUPABASE_UUID and NEW_CLERK_ID for each user.

-- Example for one user:
-- UPDATE runs SET user_id = 'user_2xNEWCLERKID' WHERE user_id = 'old-supabase-uuid-here';
-- UPDATE evaluations SET user_id = 'user_2xNEWCLERKID' WHERE user_id = 'old-supabase-uuid-here';
-- UPDATE choices SET user_id = 'user_2xNEWCLERKID' WHERE user_id = 'old-supabase-uuid-here';
-- UPDATE usage_logs SET user_id = 'user_2xNEWCLERKID' WHERE user_id = 'old-supabase-uuid-here';
-- UPDATE error_logs SET user_id = 'user_2xNEWCLERKID' WHERE user_id = 'old-supabase-uuid-here';
-- UPDATE profiles SET id = 'user_2xNEWCLERKID' WHERE id = 'old-supabase-uuid-here';
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/db.ts scripts/migrate-schema.sql scripts/migrate-users.sql
git commit -m "feat: add Neon DB client and schema migration scripts"
```

---

## Task 3: Clerk Middleware + Web Auth Setup

**Files:**
- Modify: `apps/web/src/middleware.ts`

- [ ] **Step 1: Update middleware to combine Clerk + CORS**

Clerk's `clerkMiddleware` needs to run for auth, but the existing CORS middleware must remain for Tauri desktop requests. Wrap the CORS logic inside `clerkMiddleware`:

Replace the full contents of `apps/web/src/middleware.ts`:

```ts
import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ALLOWED_ORIGINS = [
  "http://localhost:1420", // Tauri dev
  "tauri://localhost", // Tauri production (macOS)
  "https://tauri.localhost", // Tauri production (Windows)
];

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (origin.startsWith("tauri://")) return true;
  if (origin.endsWith(".localhost") && origin.startsWith("https://")) return true;
  return false;
}

function applyCorsHeaders(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get("origin") ?? "";
  const isAllowed = isAllowedOrigin(origin);

  if (isAllowed) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }

  return response;
}

export default clerkMiddleware(async (_auth, request) => {
  const origin = request.headers.get("origin") ?? "";

  // Handle preflight OPTIONS
  if (request.method === "OPTIONS" && isAllowedOrigin(origin)) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const response = NextResponse.next();
  return applyCorsHeaders(request, response);
});

export const config = {
  matcher: [
    // Run on API routes
    "/api/:path*",
    // Run on all routes except static files and _next
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};
```

- [ ] **Step 2: Verify middleware loads**

Run: `cd apps/web && npx next build 2>&1 | head -20`

Expected: Build should start (may fail on other TS errors from Supabase removal, but middleware itself should compile).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/middleware.ts
git commit -m "feat: add Clerk middleware with CORS support"
```

---

## Task 4: Migrate API Auth + Simple API Routes

**Files:**
- Delete: `apps/web/src/lib/api-auth.ts`
- Delete: `apps/web/src/lib/supabase/server.ts`
- Modify: `apps/web/src/app/api/run/route.ts`
- Modify: `apps/web/src/app/api/choice/route.ts`
- Modify: `apps/web/src/app/api/act-path/route.ts`
- Modify: `apps/web/src/app/api/error/route.ts`
- Modify: `apps/web/src/lib/usage-logger.ts`

- [ ] **Step 1: Delete old auth files**

```bash
rm apps/web/src/lib/api-auth.ts
rm apps/web/src/lib/supabase/server.ts
rmdir apps/web/src/lib/supabase
```

- [ ] **Step 2: Rewrite `/api/run/route.ts`**

Replace the full contents of `apps/web/src/app/api/run/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";

const startSchema = z.object({
  action: z.literal("start"),
  runId: z.string().min(1),
  character: z.string().min(1),
  ascension: z.number().int().min(0).optional(),
  gameVersion: z.string().nullable().optional(),
  gameMode: z.enum(["singleplayer", "multiplayer"]).optional(),
});

const endSchema = z.object({
  action: z.literal("end"),
  runId: z.string().min(1),
  victory: z.boolean().nullable().optional(),
  finalFloor: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
  bossesFought: z.array(z.string()).nullable().optional(),
  finalDeck: z.array(z.string()).nullable().optional(),
  finalRelics: z.array(z.string()).nullable().optional(),
  finalDeckSize: z.number().int().nullable().optional(),
  actReached: z.number().int().nullable().optional(),
  causeOfDeath: z.string().nullable().optional(),
  narrative: z.unknown().nullable().optional(),
});

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const db = sql();

  if (body.action === "start") {
    const result = startSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid request", detail: result.error.flatten() },
        { status: 400 }
      );
    }

    const d = result.data;
    try {
      await db`
        INSERT INTO runs (run_id, character, ascension_level, game_version, game_mode, user_id)
        VALUES (${d.runId}, ${d.character}, ${d.ascension ?? 0}, ${d.gameVersion ?? null}, ${d.gameMode ?? "singleplayer"}, ${userId})
        ON CONFLICT (run_id) DO UPDATE SET character = EXCLUDED.character
      `;
    } catch (error) {
      console.error("Failed to create run:", error);
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }

    return NextResponse.json({ success: true, runId: d.runId });
  }

  if (body.action === "end") {
    const result = endSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid request", detail: result.error.flatten() },
        { status: 400 }
      );
    }

    const d = result.data;
    try {
      await db`
        UPDATE runs SET
          ended_at = NOW(),
          victory = ${d.victory ?? null},
          final_floor = ${d.finalFloor ?? null},
          notes = ${d.notes ?? null},
          bosses_fought = ${d.bossesFought ?? null},
          final_deck = ${d.finalDeck ?? null},
          final_relics = ${d.finalRelics ?? null},
          final_deck_size = ${d.finalDeckSize ?? null},
          act_reached = ${d.actReached ?? null},
          cause_of_death = ${d.causeOfDeath ?? null},
          narrative = ${d.narrative ? JSON.stringify(d.narrative) : null}
        WHERE run_id = ${d.runId}
      `;
    } catch (error) {
      console.error("Failed to end run:", error);
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
```

- [ ] **Step 3: Rewrite `/api/choice/route.ts`**

Replace the full contents of `apps/web/src/app/api/choice/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";

const choiceSchema = z.object({
  runId: z.string().nullable().optional(),
  choiceType: z.string().min(1),
  floor: z.number().int().min(0).optional(),
  act: z.number().int().min(1).optional(),
  sequence: z.number().int().min(0).optional(),
  offeredItemIds: z.array(z.string()),
  chosenItemId: z.string().nullable().optional(),
  recommendedItemId: z.string().nullable().optional(),
  recommendedTier: z.string().nullable().optional(),
  wasFollowed: z.boolean().nullable().optional(),
  rankingsSnapshot: z.unknown().nullable().optional(),
  gameContext: z.unknown().nullable().optional(),
  evalPending: z.boolean().optional(),
});

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const result = choiceSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid request", detail: result.error.flatten() },
      { status: 400 }
    );
  }

  const d = result.data;
  const db = sql();

  try {
    await db`
      INSERT INTO choices (
        run_id, choice_type, floor, act, sequence,
        offered_item_ids, chosen_item_id, user_id,
        recommended_item_id, recommended_tier, was_followed,
        rankings_snapshot, game_context, eval_pending
      ) VALUES (
        ${d.runId ?? null}, ${d.choiceType}, ${d.floor ?? 0}, ${d.act ?? 1}, ${d.sequence ?? 0},
        ${d.offeredItemIds}, ${d.chosenItemId ?? null}, ${userId},
        ${d.recommendedItemId ?? null}, ${d.recommendedTier ?? null}, ${d.wasFollowed ?? null},
        ${d.rankingsSnapshot ? JSON.stringify(d.rankingsSnapshot) : null},
        ${d.gameContext ? JSON.stringify(d.gameContext) : null},
        ${d.evalPending ?? false}
      )
      ON CONFLICT (run_id, floor, choice_type, sequence) DO UPDATE SET
        chosen_item_id = EXCLUDED.chosen_item_id,
        recommended_item_id = EXCLUDED.recommended_item_id,
        recommended_tier = EXCLUDED.recommended_tier,
        was_followed = EXCLUDED.was_followed,
        rankings_snapshot = EXCLUDED.rankings_snapshot,
        game_context = EXCLUDED.game_context,
        eval_pending = EXCLUDED.eval_pending
    `;
  } catch (error) {
    console.error("Failed to log choice:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Rewrite `/api/act-path/route.ts`**

Replace the full contents of `apps/web/src/app/api/act-path/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";

const actPathSchema = z.object({
  runId: z.string(),
  act: z.number().int().min(1),
  recommendedPath: z.array(z.object({
    col: z.number(),
    row: z.number(),
    nodeType: z.string(),
  })),
  actualPath: z.array(z.object({
    col: z.number(),
    row: z.number(),
    nodeType: z.string(),
  })),
  nodePreferences: z.unknown().nullable().optional(),
  deviationCount: z.number().int().min(0),
  deviationNodes: z.array(z.object({
    col: z.number(),
    row: z.number(),
    recommended: z.string(),
    actual: z.string(),
  })),
  contextAtStart: z.unknown().nullable().optional(),
});

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const result = actPathSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid request", detail: result.error.flatten() },
      { status: 400 }
    );
  }

  const d = result.data;
  const db = sql();

  try {
    await db`
      INSERT INTO act_paths (
        run_id, act, recommended_path, actual_path,
        node_preferences, deviation_count, deviation_nodes,
        context_at_start, user_id
      ) VALUES (
        ${d.runId}, ${d.act},
        ${JSON.stringify(d.recommendedPath)}, ${JSON.stringify(d.actualPath)},
        ${d.nodePreferences ? JSON.stringify(d.nodePreferences) : null},
        ${d.deviationCount},
        ${JSON.stringify(d.deviationNodes)},
        ${d.contextAtStart ? JSON.stringify(d.contextAtStart) : null},
        ${userId}
      )
      ON CONFLICT (run_id, act) DO UPDATE SET
        recommended_path = EXCLUDED.recommended_path,
        actual_path = EXCLUDED.actual_path,
        node_preferences = EXCLUDED.node_preferences,
        deviation_count = EXCLUDED.deviation_count,
        deviation_nodes = EXCLUDED.deviation_nodes,
        context_at_start = EXCLUDED.context_at_start
    `;
  } catch (error) {
    console.error("Failed to log act path:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Rewrite `/api/error/route.ts`**

Replace the full contents of `apps/web/src/app/api/error/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { source, level, message, context, app_version, platform } = body;

  if (!source || !message) {
    return NextResponse.json({ error: "source and message required" }, { status: 400 });
  }

  let safeContext = null;
  if (context) {
    const contextStr = JSON.stringify(context);
    safeContext = contextStr.length < 50000 ? context : { truncated: true, originalSize: contextStr.length };
  }

  const db = sql();

  await db`
    INSERT INTO error_logs (user_id, source, level, message, context, app_version, platform)
    VALUES (
      ${userId},
      ${String(source).slice(0, 50)},
      ${String(level ?? "error").slice(0, 10)},
      ${String(message).slice(0, 5000)},
      ${safeContext ? JSON.stringify(safeContext) : null},
      ${app_version ? String(app_version).slice(0, 20) : null},
      ${platform ? String(platform).slice(0, 20) : null}
    )
  `;

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Rewrite `usage-logger.ts`**

Replace the full contents of `apps/web/src/lib/usage-logger.ts`:

```ts
import type { SqlQuery } from "@sts2/shared/evaluation/db-types";

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.00 },
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
};

export async function logUsage(
  db: SqlQuery,
  params: {
    userId: string | null;
    evalType: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }
): Promise<void> {
  const pricing = MODEL_PRICING[params.model] ?? MODEL_PRICING["claude-haiku-4-5-20251001"];
  const costEstimate =
    (params.inputTokens / 1_000_000) * pricing.input +
    (params.outputTokens / 1_000_000) * pricing.output;

  await db`
    INSERT INTO usage_logs (user_id, eval_type, model, input_tokens, output_tokens, cost_estimate)
    VALUES (${params.userId}, ${params.evalType}, ${params.model}, ${params.inputTokens}, ${params.outputTokens}, ${costEstimate})
  `;
}
```

- [ ] **Step 7: Delete auth callback route**

```bash
rm apps/web/src/app/auth/callback/route.ts
rmdir apps/web/src/app/auth/callback
rmdir apps/web/src/app/auth
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: migrate API routes from Supabase to Clerk auth + Neon DB"
```

---

## Task 5: Migrate Evaluation Module DB Calls

**Files:**
- Modify: `packages/shared/evaluation/evaluation-logger.ts`
- Modify: `packages/shared/evaluation/statistical-evaluator.ts`
- Modify: `apps/web/src/evaluation/run-history-context.ts`
- Modify: `apps/web/src/evaluation/strategy/character-strategies.ts`
- Modify: `apps/web/src/app/api/evaluate/route.ts`

- [ ] **Step 1: Create shared DB type alias**

Create `packages/shared/evaluation/db-types.ts`:

```ts
/**
 * Generic tagged-template SQL query function.
 * Matches the signature of neon() from @neondatabase/serverless
 * without requiring the package as a dependency in shared.
 */
export type SqlQuery = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;
```

- [ ] **Step 2: Rewrite `evaluation-logger.ts`**

Replace the full contents of `packages/shared/evaluation/evaluation-logger.ts`:

```ts
import type { EvaluationContext, CardEvaluation } from "./types";
import type { SqlQuery } from "./db-types";
import { createContextHash } from "./context-hash";

/**
 * Log an evaluation to the database (fire-and-forget).
 */
export async function logEvaluation(
  db: SqlQuery,
  ctx: EvaluationContext,
  evaluation: CardEvaluation,
  runId: string | null,
  gameVersion: string | null,
  userId: string | null = null,
  evalType?: string,
  originalTierValue?: number,
  weightAdjustments?: unknown[]
): Promise<void> {
  const contextHash = createContextHash(ctx);

  await db`
    INSERT INTO evaluations (
      run_id, user_id, game_version,
      item_type, item_id, item_name,
      character, archetypes, primary_archetype,
      act, floor, ascension, deck_size, hp_percent,
      gold, energy, relic_ids, has_scaling, curse_count,
      tier_value, synergy_score, confidence,
      recommendation, reasoning, source, context_hash,
      eval_type, original_tier_value, weight_adjustments
    ) VALUES (
      ${runId}, ${userId}, ${gameVersion},
      'card', ${evaluation.itemId}, ${evaluation.itemName},
      ${ctx.character}, ${ctx.archetypes.map((a) => a.archetype)}, ${ctx.primaryArchetype},
      ${ctx.act}, ${ctx.floor}, ${ctx.ascension}, ${ctx.deckSize}, ${ctx.hpPercent},
      ${ctx.gold}, ${ctx.energy}, ${ctx.relicIds}, ${ctx.hasScaling}, ${ctx.curseCount},
      ${evaluation.tierValue}, ${evaluation.synergyScore}, ${evaluation.confidence},
      ${evaluation.recommendation}, ${evaluation.reasoning}, ${evaluation.source}, ${contextHash},
      ${evalType ?? null}, ${originalTierValue ?? evaluation.tierValue},
      ${weightAdjustments ? JSON.stringify(weightAdjustments) : null}
    )
  `;
}
```

- [ ] **Step 2: Rewrite `statistical-evaluator.ts`**

Replace the full contents of `packages/shared/evaluation/statistical-evaluator.ts`:

```ts
import type { EvaluationContext, CardEvaluation } from "./types";
import type { SqlQuery } from "./db-types";
import type { TierLetter } from "./tier-utils";

export const MIN_EVALS_FOR_STATISTICAL = 25;
export const MIN_AVG_CONFIDENCE = 60;
export const MAX_TIER_STDDEV = 1.5;

function getAscensionTier(ascension: number): string {
  if (ascension <= 4) return "low";
  if (ascension <= 9) return "mid";
  return "high";
}

export async function getStatisticalEvaluation(
  db: SqlQuery,
  itemId: string,
  ctx: EvaluationContext,
  ascension: number = 0
): Promise<CardEvaluation | null> {
  const ascensionTier = getAscensionTier(ascension);

  // Tier 1: item_id + character + primary_archetype + act + ascension_tier
  const exactRows = await db`
    SELECT * FROM evaluation_stats_v2
    WHERE item_id = ${itemId}
      AND character = ${ctx.character}
      AND primary_archetype = ${ctx.primaryArchetype ?? ""}
      AND act = ${ctx.act}
      AND ascension_tier = ${ascensionTier}
    LIMIT 1
  `;

  if (exactRows.length > 0 && meetsThresholds(exactRows[0])) {
    return statsToEvaluation(itemId, exactRows[0]);
  }

  // Tier 2: item_id + character + act + ascension_tier (no archetype)
  const broadRows = await db`
    SELECT * FROM evaluation_stats_v2
    WHERE item_id = ${itemId}
      AND character = ${ctx.character}
      AND act = ${ctx.act}
      AND ascension_tier = ${ascensionTier}
      AND primary_archetype IS NULL
    LIMIT 1
  `;

  if (broadRows.length > 0 && meetsThresholds(broadRows[0])) {
    return statsToEvaluation(itemId, broadRows[0]);
  }

  // Tier 3: item_id + character + ascension_tier (broadest)
  const broadestRows = await db`
    SELECT item_name, tier_value, synergy_score, confidence, recommendation, ascension
    FROM evaluations
    WHERE item_id = ${itemId}
      AND character = ${ctx.character}
      AND source = 'claude'
  `;

  const filteredRows = broadestRows.filter((r) => {
    const rowTier = getAscensionTier(Number(r.ascension) || 0);
    return rowTier === ascensionTier;
  });

  if (filteredRows.length >= MIN_EVALS_FOR_STATISTICAL) {
    const avgConfidence = Math.round(
      filteredRows.reduce((sum, r) => sum + Number(r.confidence), 0) / filteredRows.length
    );
    const totalWeight = filteredRows.reduce((sum, r) => sum + Number(r.confidence), 0);
    const weightedTier = totalWeight > 0
      ? filteredRows.reduce((sum, r) => sum + Number(r.tier_value) * Number(r.confidence), 0) / totalWeight
      : 3;
    const weightedSynergy = totalWeight > 0
      ? Math.round(filteredRows.reduce((sum, r) => sum + Number(r.synergy_score) * Number(r.confidence), 0) / totalWeight)
      : 50;
    const tierValues = filteredRows.map((r) => Number(r.tier_value));
    const mean = tierValues.reduce((a, b) => a + b, 0) / tierValues.length;
    const variance = tierValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / tierValues.length;
    const stddev = Math.sqrt(variance);

    const recCounts: Record<string, number> = {};
    for (const r of filteredRows) {
      const rec = String(r.recommendation);
      recCounts[rec] = (recCounts[rec] ?? 0) + 1;
    }
    const mostCommonRec = Object.entries(recCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "situational";

    const aggregated = {
      item_name: String(filteredRows[0]?.item_name ?? itemId),
      weighted_tier: weightedTier,
      weighted_synergy: weightedSynergy,
      avg_confidence: avgConfidence,
      most_common_rec: mostCommonRec,
      eval_count: filteredRows.length,
      tier_stddev: stddev,
    };

    if (meetsThresholds({ eval_count: aggregated.eval_count, avg_confidence: aggregated.avg_confidence, tier_stddev: aggregated.tier_stddev })) {
      return statsToEvaluation(itemId, aggregated);
    }
  }

  return null;
}

export function meetsThresholds(stats: {
  eval_count: number | null;
  avg_confidence: number | null;
  tier_stddev: number | null;
}): boolean {
  return (
    (Number(stats.eval_count) || 0) >= MIN_EVALS_FOR_STATISTICAL &&
    (Number(stats.avg_confidence) || 0) >= MIN_AVG_CONFIDENCE &&
    (Number(stats.tier_stddev) ?? Infinity) <= MAX_TIER_STDDEV
  );
}

export function statsToEvaluation(
  itemId: string,
  stats: {
    item_name: string | null;
    weighted_tier: number | null;
    weighted_synergy: number | null;
    avg_confidence: number | null;
    most_common_rec: string | null;
    eval_count: number | null;
  }
): CardEvaluation {
  const tierValue = Math.round(Number(stats.weighted_tier) || 3);
  const tierLetters: TierLetter[] = ["F", "F", "D", "C", "B", "A", "S"];

  return {
    itemId,
    itemName: String(stats.item_name ?? itemId),
    rank: 0,
    tier: tierLetters[Math.max(0, Math.min(6, tierValue))] ?? "C",
    tierValue,
    synergyScore: Number(stats.weighted_synergy) || 50,
    confidence: Number(stats.avg_confidence) || 50,
    recommendation: (String(stats.most_common_rec) || "situational") as CardEvaluation["recommendation"],
    reasoning: `Based on ${stats.eval_count} previous evaluations (avg confidence: ${stats.avg_confidence}%)`,
    source: "statistical",
  };
}
```

- [ ] **Step 3: Rewrite `run-history-context.ts`**

Replace the full contents of `apps/web/src/evaluation/run-history-context.ts`:

```ts
import { sql } from "@/lib/db";

let cachedHistory: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 1000 * 60 * 5;

export async function getRunHistoryContext(): Promise<string> {
  if (cachedHistory && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedHistory;
  }

  try {
    const db = sql();
    const runs = await db`
      SELECT character, ascension_level, victory, final_floor, notes, bosses_fought
      FROM runs
      WHERE ended_at IS NOT NULL
      ORDER BY started_at DESC
      LIMIT 50
    `;

    if (runs.length === 0) {
      cachedHistory = "";
      cacheTimestamp = Date.now();
      return "";
    }

    const wins = runs.filter((r) => r.victory === true).length;
    const losses = runs.filter((r) => r.victory === false).length;
    const avgFloor = Math.round(
      runs.reduce((sum, r) => sum + (Number(r.final_floor) || 0), 0) / runs.length
    );

    const bossDeaths: Record<string, number> = {};
    const bossKills: Record<string, number> = {};
    for (const run of runs) {
      const bosses = (run.bosses_fought as string[]) ?? [];
      for (const boss of bosses) {
        if (run.victory === false) {
          bossDeaths[boss] = (bossDeaths[boss] ?? 0) + 1;
        } else if (run.victory === true) {
          bossKills[boss] = (bossKills[boss] ?? 0) + 1;
        }
      }
    }

    const recentLossNotes = runs
      .filter((r) => r.victory === false && r.notes)
      .slice(0, 5)
      .map((r) => String(r.notes));

    const lines: string[] = [
      `Player stats: ${wins}W/${losses}L (${runs.length} runs), avg floor ${avgFloor}`,
    ];

    const dangerousBosses = Object.entries(bossDeaths)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (dangerousBosses.length > 0) {
      lines.push(
        `Struggles against: ${dangerousBosses.map(([b, d]) => `${b} (${d} deaths)`).join(", ")}`
      );
    }

    if (recentLossNotes.length > 0) {
      const themes: Record<string, number> = {};
      const keywords: Record<string, string> = {
        defense: "lacking defense/block",
        block: "lacking defense/block",
        def: "lacking defense/block",
        hp: "HP management issues",
        heal: "HP management issues",
        elite: "elite fights too risky",
        boss: "boss fights unprepared",
        scaling: "lacking damage scaling",
        damage: "lacking damage scaling",
        energy: "energy economy problems",
      };

      for (const note of recentLossNotes) {
        const lower = note.toLowerCase();
        for (const [kw, theme] of Object.entries(keywords)) {
          if (lower.includes(kw)) {
            themes[theme] = (themes[theme] ?? 0) + 1;
          }
        }
      }

      const topThemes = Object.entries(themes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([t]) => t);

      if (topThemes.length > 0) {
        lines.push(`Recurring weaknesses: ${topThemes.join(", ")}`);
      }
    }

    cachedHistory = lines.join("\n");
    cacheTimestamp = Date.now();
    return cachedHistory;
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Rewrite `character-strategies.ts`**

Replace the full contents of `apps/web/src/evaluation/strategy/character-strategies.ts`:

```ts
import { sql } from "@/lib/db";

let strategyCache: Record<string, string> = {};
let cacheTimestamp = 0;
const CACHE_TTL = 1000 * 60 * 30;

async function loadStrategies(): Promise<Record<string, string>> {
  if (
    Object.keys(strategyCache).length > 0 &&
    Date.now() - cacheTimestamp < CACHE_TTL
  ) {
    return strategyCache;
  }

  try {
    const db = sql();
    const data = await db`SELECT id, strategy FROM character_strategies`;

    if (data.length > 0) {
      strategyCache = {};
      for (const row of data) {
        strategyCache[String(row.id).toLowerCase()] = String(row.strategy);
      }
      cacheTimestamp = Date.now();
    }
  } catch {
    // Fall through to cache or empty
  }

  return strategyCache;
}

export async function getCharacterStrategy(
  character: string
): Promise<string | null> {
  const strategies = await loadStrategies();
  const key = character.toLowerCase().trim();
  return strategies[key] ?? strategies[`the ${key}`] ?? null;
}
```

- [ ] **Step 5: Update evaluate route imports**

The evaluate route (`apps/web/src/app/api/evaluate/route.ts`) uses `createServiceClient()` for multiple inline queries (boss reference, keyword glossary, card enrichment, card win rates) and passes the Supabase client to `logEvaluation` and `getStatisticalEvaluation`. Update the imports and all Supabase usage:

At the top of the file, replace:
```ts
import { createServiceClient } from "@/lib/supabase/server";
```
with:
```ts
import { sql } from "@/lib/db";
```

Replace:
```ts
import { requireAuth } from "@/lib/api-auth";
```
with:
```ts
import { auth } from "@clerk/nextjs/server";
```

In the `POST` handler, replace:
```ts
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
```
with:
```ts
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

Replace every instance of:
```ts
const supabase = createServiceClient();
```
with:
```ts
const db = sql();
```

In `loadBossReference()`, replace:
```ts
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("monsters")
      .select("name, min_hp, max_hp, moves")
      .eq("type", "Boss");
```
with:
```ts
    const db = sql();
    const data = await db`
      SELECT name, min_hp, max_hp, moves FROM monsters WHERE type = 'Boss'
    `;
```

In `loadKeywordGlossary()`, replace:
```ts
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("keywords")
      .select("name, description")
      .order("name");
```
with:
```ts
    const db = sql();
    const data = await db`
      SELECT name, description FROM keywords ORDER BY name
    `;
```

In `enrichCards()`, replace:
```ts
      const supabase = createServiceClient();
      const { data } = await supabase
        .from("cards")
        .select("id, description, description_raw, type, keywords")
        .in("id", missing);
```
with:
```ts
      const db = sql();
      const data = await db`
        SELECT id, description, description_raw, type, keywords
        FROM cards WHERE id = ANY(${missing})
      `;
```

Update all calls to `getStatisticalEvaluation(supabase, ...)` → `getStatisticalEvaluation(db, ...)`.

Update all calls to `logEvaluation(supabase, ...)` → `logEvaluation(db, ...)`.

Update all calls to `logUsage(supabase, ...)` → `logUsage(db, ...)`.

Update references from `auth.userId` to `userId` (since Clerk's `auth()` returns `{ userId }` directly).

For the `card_win_rates` query, replace:
```ts
    .from("card_win_rates")
```
with the equivalent Neon SQL query.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: migrate evaluation modules to Neon SQL"
```

---

## Task 6: Game Data API Routes

**Files:**
- Create: `apps/web/src/app/api/game-data/cards/route.ts`
- Create: `apps/web/src/app/api/game-data/relics/route.ts`
- Create: `apps/web/src/app/api/game-data/monsters/route.ts`
- Create: `apps/web/src/app/api/game-data/characters/route.ts`
- Create: `apps/web/src/app/api/game-data/keywords/route.ts`
- Create: `apps/web/src/app/api/profile/route.ts`

- [ ] **Step 1: Create cards route**

Create `apps/web/src/app/api/game-data/cards/route.ts`:

```ts
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  const db = sql();
  const data = await db`SELECT * FROM cards ORDER BY name`;
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
```

- [ ] **Step 2: Create relics route**

Create `apps/web/src/app/api/game-data/relics/route.ts`:

```ts
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  const db = sql();
  const data = await db`SELECT * FROM relics ORDER BY name`;
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
```

- [ ] **Step 3: Create monsters route**

Create `apps/web/src/app/api/game-data/monsters/route.ts`:

```ts
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ids = searchParams.get("ids");
  const db = sql();

  if (ids) {
    const idList = ids.split(",").map((id) => id.trim());
    const data = await db`SELECT * FROM monsters WHERE id = ANY(${idList})`;
    return NextResponse.json(data);
  }

  const data = await db`SELECT * FROM monsters ORDER BY name`;
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
```

- [ ] **Step 4: Create characters route**

Create `apps/web/src/app/api/game-data/characters/route.ts`:

```ts
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  const db = sql();
  const data = await db`SELECT * FROM characters`;
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
```

- [ ] **Step 5: Create keywords route**

Create `apps/web/src/app/api/game-data/keywords/route.ts`:

```ts
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  const db = sql();
  const data = await db`SELECT * FROM keywords ORDER BY name`;
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
```

- [ ] **Step 6: Create profile route**

Create `apps/web/src/app/api/profile/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = sql();
  const rows = await db`SELECT role FROM profiles WHERE id = ${userId}`;
  const role = rows[0]?.role ?? "user";

  return NextResponse.json({ role });
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/api/game-data apps/web/src/app/api/profile
git commit -m "feat: add game data and profile API routes for Neon"
```

---

## Task 7: Migrate Shared Game Data Hooks

**Files:**
- Modify: `packages/shared/game-data/use-cards.ts`
- Modify: `packages/shared/game-data/use-relics.ts`
- Modify: `packages/shared/game-data/use-monsters.ts`
- Modify: `packages/shared/game-data/use-potions.ts`
- Modify: `packages/shared/game-data/use-keywords.ts`
- Modify: `packages/shared/game-data/create-game-data-hook.ts`

- [ ] **Step 1: Update `create-game-data-hook.ts` to accept a URL-based fetcher**

Replace the full contents of `packages/shared/game-data/create-game-data-hook.ts`:

```ts
"use client";

import useSWR from "swr";
import { apiFetch } from "../lib/api-client";

const SWR_CONFIG = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  dedupingInterval: 1000 * 60 * 60, // 1 hour — game data is static
};

/**
 * Factory for game data hooks. Fetches from the API game-data routes.
 */
export function createGameDataHook<T>(key: string, apiPath: string) {
  return function useGameData() {
    return useSWR<T[]>(
      `game-data:${key}`,
      async () => {
        const res = await apiFetch(apiPath, { method: "GET" });
        if (!res.ok) throw new Error(`Failed to fetch ${key}: ${res.status}`);
        return res.json();
      },
      SWR_CONFIG
    );
  };
}
```

- [ ] **Step 2: Update all game data hooks**

Replace `packages/shared/game-data/use-cards.ts`:

```ts
"use client";

import useSWR from "swr";
import { apiFetch } from "../lib/api-client";
import type { Card } from "../supabase/helpers";
import { createGameDataHook } from "./create-game-data-hook";

export const useCards = createGameDataHook<Card>("cards", "/api/game-data/cards");

export function useCardById(id: string | null) {
  return useSWR(
    id ? `game-data:card:${id}` : null,
    async () => {
      if (!id) return null;
      const res = await apiFetch("/api/game-data/cards", { method: "GET" });
      if (!res.ok) throw new Error(`Failed to fetch cards: ${res.status}`);
      const cards: Card[] = await res.json();
      return cards.find((c) => c.id === id) ?? null;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 1000 * 60 * 60,
    }
  );
}
```

Replace `packages/shared/game-data/use-relics.ts`:

```ts
"use client";

import type { Relic } from "../supabase/helpers";
import { createGameDataHook } from "./create-game-data-hook";

export const useRelics = createGameDataHook<Relic>("relics", "/api/game-data/relics");
```

Replace `packages/shared/game-data/use-monsters.ts`:

```ts
"use client";

import type { Monster } from "../supabase/helpers";
import { createGameDataHook } from "./create-game-data-hook";

export const useMonsters = createGameDataHook<Monster>("monsters", "/api/game-data/monsters");
```

Replace `packages/shared/game-data/use-potions.ts`:

```ts
"use client";

import type { Potion } from "../supabase/helpers";
import { createGameDataHook } from "./create-game-data-hook";

export const usePotions = createGameDataHook<Potion>("potions", "/api/game-data/potions");
```

Note: potions route doesn't exist yet. Add it if the web app uses potions, otherwise the hook will 404. Check if there's a web page that uses `usePotions()`. If not, this hook is only used client-side and can be updated later. For now, create a potions route:

Create `apps/web/src/app/api/game-data/potions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  const db = sql();
  const data = await db`SELECT * FROM potions ORDER BY name`;
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
```

Replace `packages/shared/game-data/use-keywords.ts`:

```ts
"use client";

import type { Keyword } from "../supabase/helpers";
import { createGameDataHook } from "./create-game-data-hook";

export const useKeywords = createGameDataHook<Keyword>("keywords", "/api/game-data/keywords");
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: migrate game data hooks from Supabase to API routes"
```

---

## Task 8: Migrate Desktop Auth Provider

**Files:**
- Modify: `apps/desktop/src/main.tsx`
- Modify: `apps/desktop/src/auth-provider.tsx`
- Modify: `packages/shared/lib/init.ts`

- [ ] **Step 1: Simplify `init.ts`**

Replace the full contents of `packages/shared/lib/init.ts`:

```ts
import { setApiBaseUrl, setAccessTokenGetter, setFetchImplementation } from "./api-client";

interface SharedConfig {
  apiBaseUrl: string;
  accessTokenGetter?: () => Promise<string | null>;
  fetchImplementation?: typeof globalThis.fetch;
}

export function initSharedConfig(config: SharedConfig) {
  setApiBaseUrl(config.apiBaseUrl);
  if (config.accessTokenGetter) {
    setAccessTokenGetter(config.accessTokenGetter);
  }
  if (config.fetchImplementation) {
    setFetchImplementation(config.fetchImplementation);
  }
}
```

- [ ] **Step 2: Rewrite `main.tsx`**

Replace the full contents of `apps/desktop/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "./store/store";
import * as Sentry from "@sentry/react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import "./index.css";
import { App } from "./App";
import { AuthProvider } from "./auth-provider";
import { ErrorBoundary } from "./components/error-boundary";
import { initSharedConfig } from "@sts2/shared/lib/init";
import { reportError, initErrorReporter } from "@sts2/shared/lib/error-reporter";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN ?? "https://12f87c41bf7be1e26757c68d4089ac8b@o4511051123064832.ingest.us.sentry.io/4511142195953664",
  sendDefaultPii: false,
  environment: import.meta.env.DEV ? "development" : "production",
  release: `sts2-replay@0.12.1`,
});

initErrorReporter({
  captureException: (err, ctx) => Sentry.captureException(err, ctx as Parameters<typeof Sentry.captureException>[1]),
  captureMessage: (msg, ctx) => { Sentry.captureMessage(msg, ctx as Parameters<typeof Sentry.captureMessage>[1]); },
  setContext: (name, ctx) => Sentry.setContext(name, ctx),
  setTag: (key, value) => Sentry.setTag(key, value),
  setUser: (user) => Sentry.setUser(user),
});

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://sts2-helper.vercel.app";

// Clerk initialization happens inside AuthProvider.
// Here we just configure the shared API client for making requests.
initSharedConfig({
  apiBaseUrl: API_BASE,
  fetchImplementation: tauriFetch as typeof globalThis.fetch,
  // accessTokenGetter is set by AuthProvider once Clerk is loaded
});

window.onerror = (message, source, lineno, colno, error) => {
  reportError("unhandled_error", String(message), {
    source, lineno, colno,
    stack: error?.stack,
  });
};

window.addEventListener("unhandledrejection", (e) => {
  reportError("unhandled_rejection", e.reason?.message ?? String(e.reason), {
    stack: e.reason?.stack,
  });
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <ErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ErrorBoundary>
    </Provider>
  </React.StrictMode>
);
```

- [ ] **Step 3: Rewrite `auth-provider.tsx`**

Replace the full contents of `apps/desktop/src/auth-provider.tsx`:

```tsx
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import Clerk from "@clerk/clerk-js";
import type { UserResource } from "@clerk/types";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { open } from "@tauri-apps/plugin-shell";
import { setAccessTokenGetter } from "@sts2/shared/lib/api-client";
import { apiFetch } from "@sts2/shared/lib/api-client";
import { setReportingUser } from "@sts2/shared/lib/error-reporter";
import { useAppDispatch } from "./store/hooks";
import { userRoleSet, type UserRole } from "./features/connection/connectionSlice";

const DEEP_LINK_PREFIX = "sts2replay://auth/callback";
const CLERK_PK = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";

interface AuthContextValue {
  user: UserResource | null;
  loading: boolean;
  signInPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signInDiscord: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signInPassword: async () => ({ error: "Not initialized" }),
  signUp: async () => ({ error: "Not initialized" }),
  signInDiscord: async () => ({ error: "Not initialized" }),
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserResource | null>(null);
  const [loading, setLoading] = useState(true);
  const clerkRef = useRef<Clerk | null>(null);
  const dispatch = useAppDispatch();

  const loadUserRole = useCallback(async () => {
    try {
      const res = await apiFetch("/api/profile", { method: "GET" });
      if (res.ok) {
        const data = await res.json();
        dispatch(userRoleSet((data.role as UserRole) ?? "user"));
      } else {
        dispatch(userRoleSet("user"));
      }
    } catch {
      dispatch(userRoleSet("user"));
    }
  }, [dispatch]);

  const syncUser = useCallback((clerkUser: UserResource | null | undefined) => {
    const u = clerkUser ?? null;
    setUser(u);
    if (u) {
      localStorage.setItem("sts2-user-id", u.id);
      setReportingUser({ id: u.id, email: u.primaryEmailAddress?.emailAddress });
      loadUserRole();
    } else {
      localStorage.removeItem("sts2-user-id");
      setReportingUser(null);
      dispatch(userRoleSet("user"));
    }
  }, [dispatch, loadUserRole]);

  useEffect(() => {
    const clerk = new Clerk(CLERK_PK);
    clerkRef.current = clerk;

    clerk.load().then(() => {
      // Wire Clerk session token into shared API client
      setAccessTokenGetter(async () => {
        const session = clerk.session;
        if (!session) return null;
        return session.getToken();
      });

      syncUser(clerk.user);
      setLoading(false);

      // Listen for auth state changes
      clerk.addListener((resources) => {
        syncUser(resources.user);
      });
    });

    // Listen for deep link callbacks (OAuth redirect from browser)
    let unlistenDeepLink: (() => void) | undefined;
    onOpenUrl(async (urls) => {
      for (const url of urls) {
        if (!url.startsWith(DEEP_LINK_PREFIX)) continue;
        // Clerk handles the redirect callback — call handleRedirectCallback
        // which reads the URL params and completes the sign-in flow
        try {
          await clerk.handleRedirectCallback({ redirectUrl: url });
        } catch (err) {
          console.error("[deep-link] Failed to handle redirect:", err);
        }
      }
    }).then((fn) => { unlistenDeepLink = fn; });

    return () => {
      unlistenDeepLink?.();
    };
  }, [syncUser]);

  const signInPassword = useCallback(async (email: string, password: string) => {
    const clerk = clerkRef.current;
    if (!clerk) return { error: "Clerk not loaded" };
    try {
      const result = await clerk.client.signIn.create({
        identifier: email,
        password,
      });
      if (result.status === "complete" && result.createdSessionId) {
        await clerk.setActive({ session: result.createdSessionId });
      }
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const clerk = clerkRef.current;
    if (!clerk) return { error: "Clerk not loaded" };
    try {
      const result = await clerk.client.signUp.create({
        emailAddress: email,
        password,
      });
      if (result.status === "complete" && result.createdSessionId) {
        await clerk.setActive({ session: result.createdSessionId });
      }
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  const signInDiscord = useCallback(async () => {
    const clerk = clerkRef.current;
    if (!clerk) return { error: "Clerk not loaded" };
    try {
      const result = await clerk.client.signIn.create({
        strategy: "oauth_discord",
        redirectUrl: DEEP_LINK_PREFIX,
      });
      const externalUrl = result.firstFactorVerification?.externalVerificationRedirectURL;
      if (externalUrl) {
        await open(externalUrl.toString());
      }
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  const signOut = useCallback(async () => {
    const clerk = clerkRef.current;
    if (!clerk) return;
    await clerk.signOut();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, signInPassword, signUp, signInDiscord, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: rewrite desktop auth provider with Clerk JS SDK"
```

---

## Task 9: Migrate Desktop Game Data Queries

**Files:**
- Modify: `apps/desktop/src/lib/card-filter.ts`
- Modify: `apps/desktop/src/lib/relic-lookup.ts`
- Modify: `apps/desktop/src/lib/upgrade-lookup.ts`
- Modify: `apps/desktop/src/views/combat/boss-briefing.tsx`
- Modify: `packages/shared/supabase/starter-decks.ts`

- [ ] **Step 1: Rewrite `card-filter.ts`**

Replace the full contents of `apps/desktop/src/lib/card-filter.ts`:

```ts
import type { CombatCard } from "@sts2/shared/types/game-state";
import { apiFetch } from "@sts2/shared/lib/api-client";

let validCardNames: Set<string> | null = null;
let loading = false;

const KNOWN_STATUS = new Set([
  "wound", "burn", "dazed", "slimed", "void", "debris",
  "beckon", "disintegration", "frantic escape", "infection",
  "mind rot", "sloth", "soot", "toxic", "waste away",
]);

export function initValidCardNames(): void {
  if (validCardNames || loading) return;

  loading = true;
  apiFetch("/api/game-data/cards", { method: "GET" })
    .then((res) => res.json())
    .then((data: { name: string; type: string }[]) => {
      const names = new Set(
        data.filter((c) => c.type !== "Status").map((c) => c.name.toLowerCase())
      );
      for (const name of [...names]) {
        names.add(`${name}+`);
      }
      validCardNames = names;
      loading = false;
    })
    .catch(() => {
      loading = false;
    });
}

export function isPlayerCard(card: CombatCard): boolean {
  if (validCardNames) {
    return validCardNames.has(card.name.toLowerCase());
  }
  return !KNOWN_STATUS.has(card.name.toLowerCase());
}

export function filterPlayerCards(cards: CombatCard[]): CombatCard[] {
  return cards.filter(isPlayerCard);
}
```

- [ ] **Step 2: Rewrite `relic-lookup.ts`**

Replace the full contents of `apps/desktop/src/lib/relic-lookup.ts`:

```ts
import { apiFetch } from "@sts2/shared/lib/api-client";

let relicDescriptions: Map<string, string> | null = null;
let loading = false;

export function initRelicLookup(): void {
  if (relicDescriptions || loading) return;

  loading = true;
  apiFetch("/api/game-data/relics", { method: "GET" })
    .then((res) => res.json())
    .then((data: { name: string; description: string }[]) => {
      relicDescriptions = new Map(
        data.map((r) => [r.name.toLowerCase(), r.description])
      );
      loading = false;
    })
    .catch(() => {
      loading = false;
    });
}

export function getRelicDescription(name: string): string | null {
  if (!relicDescriptions) return null;
  return relicDescriptions.get(name.toLowerCase()) ?? null;
}
```

- [ ] **Step 3: Rewrite `upgrade-lookup.ts`**

Replace the full contents of `apps/desktop/src/lib/upgrade-lookup.ts`:

```ts
import { apiFetch } from "@sts2/shared/lib/api-client";

interface UpgradeInfo {
  upgrade: string | null;
  upgradeDescription: string | null;
}

let upgradeCache: Map<string, UpgradeInfo> | null = null;
let loading = false;

export function fetchUpgradeData(): void {
  if (upgradeCache || loading) return;

  loading = true;
  apiFetch("/api/game-data/cards", { method: "GET" })
    .then((res) => res.json())
    .then((data: { name: string; upgrade?: string | null; upgrade_description?: string | null }[]) => {
      upgradeCache = new Map();
      for (const card of data) {
        if (card.upgrade || card.upgrade_description) {
          upgradeCache.set(card.name.toLowerCase(), {
            upgrade: card.upgrade ?? null,
            upgradeDescription: card.upgrade_description ?? null,
          });
        }
      }
      loading = false;
    })
    .catch(() => {
      loading = false;
    });
}

export function getUpgradeInfo(cardName: string): UpgradeInfo | null {
  if (!upgradeCache) return null;
  return upgradeCache.get(cardName.toLowerCase()) ?? null;
}
```

- [ ] **Step 4: Rewrite boss-briefing.tsx monster fetch**

In `apps/desktop/src/views/combat/boss-briefing.tsx`, replace the `fetchBossData` function:

```ts
async function fetchBossData(enemyIds: string[]): Promise<Monster[]> {
  const baseIds = [...new Set(enemyIds.map((id) => id.replace(/_\d+$/, "")))];
  const res = await apiFetch(`/api/game-data/monsters?ids=${baseIds.join(",")}`, { method: "GET" });
  if (!res.ok) return [];
  return res.json();
}
```

And update the imports: remove `import { createClient } from "@sts2/shared/supabase/client"` and add `import { apiFetch } from "@sts2/shared/lib/api-client"`. Keep the `Monster` type import from helpers.

- [ ] **Step 5: Rewrite `starter-decks.ts`**

Replace the full contents of `packages/shared/supabase/starter-decks.ts`:

```ts
import type { CombatCard } from "../types/game-state";
import { apiFetch } from "../lib/api-client";

const STORAGE_KEY = "sts2-starter-decks";

let starterDecks: Map<string, CombatCard[]> | null = null;
let loading = false;

export function initStarterDecks(): void {
  if (starterDecks || loading) return;

  if (typeof window !== "undefined") {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as Record<string, string[]>;
        starterDecks = new Map(
          Object.entries(parsed).map(([name, cards]) => [
            name,
            cards.map((c) => ({ name: c, description: "" })),
          ])
        );
        return;
      }
    } catch {
      // Fall through to async fetch
    }
  }

  loading = true;
  apiFetch("/api/game-data/characters", { method: "GET" })
    .then((res) => res.json())
    .then((data: { name: string; starting_deck: string[] | null }[]) => {
      const map = new Map<string, CombatCard[]>();
      const cacheObj: Record<string, string[]> = {};

      for (const row of data) {
        if (!row.starting_deck) continue;
        const key = row.name.toLowerCase();
        const deck = row.starting_deck.map((c) => ({
          name: c,
          description: "",
        }));
        map.set(key, deck);
        cacheObj[key] = row.starting_deck;
      }

      starterDecks = map;
      loading = false;

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cacheObj));
        } catch {
          // Non-critical
        }
      }
    })
    .catch(() => {
      loading = false;
    });
}

export function getStarterDeck(character: string): CombatCard[] {
  if (!starterDecks) return [];
  return starterDecks.get(character.toLowerCase()) ?? [];
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: migrate desktop game data queries to API routes"
```

---

## Task 10: Migrate Sync Codex Script

**Files:**
- Modify: `apps/web/src/game-data/sync-codex.ts`

- [ ] **Step 1: Update sync-codex.ts to use Neon**

At the top of `apps/web/src/game-data/sync-codex.ts`, replace the Supabase setup:

```ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@sts2/shared/types/database.types";
import type { CardInsert, RelicInsert, PotionInsert, MonsterInsert, KeywordInsert } from "@sts2/shared/supabase/helpers";

const CODEX_BASE = "https://spire-codex.com/api";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient<Database>(supabaseUrl, supabaseKey);
```

with:

```ts
import { neon } from "@neondatabase/serverless";
import type { CardInsert, RelicInsert, PotionInsert, MonsterInsert, KeywordInsert } from "@sts2/shared/supabase/helpers";

const CODEX_BASE = "https://spire-codex.com/api";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const db = neon(databaseUrl);
```

Then update each upsert function to use `db` tagged template queries instead of `supabase.from(...).upsert(...)`. For example, the cards upsert becomes:

```ts
// Replace: const { error } = await supabase.from("cards").upsert(rows);
// With individual upserts in a loop or a single multi-row INSERT ... ON CONFLICT
for (const row of rows) {
  await db`
    INSERT INTO cards (id, name, description, description_raw, cost, star_cost, type, rarity, color, target, damage, block, hit_count, keywords, tags, image_url, game_version)
    VALUES (${row.id}, ${row.name}, ${row.description}, ${row.description_raw ?? null}, ${row.cost ?? null}, ${row.star_cost ?? null}, ${row.type}, ${row.rarity}, ${row.color}, ${row.target ?? null}, ${row.damage ?? null}, ${row.block ?? null}, ${row.hit_count ?? null}, ${row.keywords ?? null}, ${row.tags ?? null}, ${row.image_url ?? null}, ${row.game_version ?? null})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, description = EXCLUDED.description, description_raw = EXCLUDED.description_raw,
      cost = EXCLUDED.cost, star_cost = EXCLUDED.star_cost, type = EXCLUDED.type, rarity = EXCLUDED.rarity,
      color = EXCLUDED.color, target = EXCLUDED.target, damage = EXCLUDED.damage, block = EXCLUDED.block,
      hit_count = EXCLUDED.hit_count, keywords = EXCLUDED.keywords, tags = EXCLUDED.tags,
      image_url = EXCLUDED.image_url, game_version = EXCLUDED.game_version, updated_at = NOW()
  `;
}
```

Apply the same pattern for relics, potions, monsters, keywords, and game_versions.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/game-data/sync-codex.ts
git commit -m "feat: migrate sync-codex script to Neon"
```

---

## Task 11: Delete Shared Supabase Client Files

**Files:**
- Delete: `packages/shared/supabase/client.ts`
- Delete: `packages/shared/supabase/auth.ts`
- Modify: `packages/shared/lib/api-client.ts` (update JSDoc only)

- [ ] **Step 1: Delete Supabase client and auth modules**

```bash
rm packages/shared/supabase/client.ts
rm packages/shared/supabase/auth.ts
```

- [ ] **Step 2: Update api-client.ts JSDoc**

In `packages/shared/lib/api-client.ts`, update the comment on `setAccessTokenGetter`:

Replace:
```ts
/**
 * Set a function that returns the current Supabase access token.
 * Desktop app uses this to send Bearer auth; web app relies on cookies.
 */
```
with:
```ts
/**
 * Set a function that returns the current auth session token.
 * Desktop app uses this to send Bearer auth; web app relies on cookies.
 */
```

- [ ] **Step 3: Verify no remaining Supabase imports**

Run: `grep -r "@supabase" packages/shared/lib/ packages/shared/game-data/ packages/shared/evaluation/ apps/web/src/ apps/desktop/src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v ".d.ts" | grep -v "database.types.ts" | grep -v "helpers.ts"`

Expected: No results. If any remain, fix them.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove Supabase client and auth modules"
```

---

## Task 12: Web App Auth Pages (if applicable)

**Files:**
- Check: `apps/web/src/features/auth/auth-provider.tsx`
- Check: `apps/web/src/app/account/page.tsx`
- Check: `apps/web/src/app/runs/page.tsx`

The exploration found these web app files use Supabase. They need updating too.

- [ ] **Step 1: Update web auth provider**

Read `apps/web/src/features/auth/auth-provider.tsx` and update it to use `@clerk/nextjs` instead of Supabase. The web app should use Clerk's `<ClerkProvider>`, `useUser()`, and `<SignIn />` / `<UserButton />` components.

Replace all `createClient()` and `initSupabase()` usage with Clerk equivalents. The web auth provider should be significantly simpler than the desktop one since `@clerk/nextjs` handles most of the boilerplate.

- [ ] **Step 2: Update account page**

In `apps/web/src/app/account/page.tsx`, replace `createClient()` Supabase calls with Clerk's `currentUser()` from `@clerk/nextjs/server` or `useUser()` from `@clerk/nextjs`.

- [ ] **Step 3: Update runs page**

In `apps/web/src/app/runs/page.tsx`, replace `createClient()` calls with the appropriate Neon queries or API calls.

- [ ] **Step 4: Add Clerk providers to web layout**

Wrap the web app layout in `<ClerkProvider>`. In `apps/web/src/app/layout.tsx`, add:

```tsx
import { ClerkProvider } from "@clerk/nextjs";

// In the layout:
<ClerkProvider>
  {children}
</ClerkProvider>
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: migrate web app auth to Clerk"
```

---

## Task 13: Final Verification and Cleanup

**Files:**
- Various

- [ ] **Step 1: Run TypeScript check**

```bash
cd /Users/drewbolles/Sites/_bollesmedia/sts2-helper
npx turbo run lint
```

Fix any type errors. Common issues:
- `SupabaseClient` type no longer available — should all be replaced by now
- Missing `NeonQueryFunction` type import
- Clerk type mismatches

- [ ] **Step 2: Run tests**

```bash
npx turbo run test
```

Fix any failing tests. Tests that mock Supabase will need updating to mock the API fetch calls instead.

- [ ] **Step 3: Check for stale Supabase references**

```bash
grep -r "supabase" apps/ packages/ --include="*.ts" --include="*.tsx" -l | grep -v node_modules | grep -v ".d.ts" | grep -v database.types | grep -v helpers.ts | grep -v starter-decks.ts | grep -v migrations
```

Fix any remaining references.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: fix type errors and update tests for Neon + Clerk"
```

---

## Task 14: User Migration Script

**Files:**
- Create: `scripts/export-supabase-users.sh`

- [ ] **Step 1: Create export script**

Create `scripts/export-supabase-users.sh`:

```bash
#!/bin/bash
# Export Supabase auth users for migration mapping.
# Run this BEFORE cutting over to Clerk.
# Requires: SUPABASE_PROJECT_REF and SUPABASE_SERVICE_ROLE_KEY

set -e

SUPABASE_URL="https://${SUPABASE_PROJECT_REF}.supabase.co"

curl -s "${SUPABASE_URL}/auth/v1/admin/users" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  | jq '[.users[] | {id, email, identities: [.identities[]? | {provider, identity_data: {name: .identity_data.name, email: .identity_data.email}}]}]' \
  > scripts/user-migration.json

echo "Exported users to scripts/user-migration.json"
echo "Users found:"
jq length scripts/user-migration.json
```

- [ ] **Step 2: Commit**

```bash
chmod +x scripts/export-supabase-users.sh
git add scripts/export-supabase-users.sh
git commit -m "chore: add Supabase user export script for migration"
```

---

## Execution Notes

**Environment variables needed before testing:**
- `DATABASE_URL` — Neon connection string
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — from Clerk dashboard
- `CLERK_SECRET_KEY` — from Clerk dashboard
- `VITE_CLERK_PUBLISHABLE_KEY` — same as NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

**Clerk dashboard setup required:**
1. Create Clerk application
2. Enable Discord OAuth provider
3. Add `sts2replay://auth/callback` to allowed redirect URIs
4. Configure email/password sign-in

**DB migration order:**
1. `pg_dump` Supabase → local file
2. Create Neon project + database
3. Restore dump to Neon
4. Run `scripts/migrate-schema.sql`
5. Set `DATABASE_URL` env var
6. Test API routes

**Testing the desktop deep-link flow:**
1. Build desktop app with new Clerk auth
2. Click "Sign in with Discord"
3. System browser opens → Clerk Discord OAuth
4. After auth, browser redirects to `sts2replay://auth/callback`
5. Tauri catches deep link → Clerk handles redirect callback
6. User is authenticated in the desktop app
