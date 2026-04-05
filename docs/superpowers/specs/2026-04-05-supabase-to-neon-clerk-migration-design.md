# STS2 Helper: Supabase → Neon + Clerk Migration

**Date:** 2026-04-05
**Status:** Approved
**Approach:** Full migration (Approach A) — replace Supabase entirely with Neon (DB) + Clerk (auth)

## Motivation

Eliminate the $25/mo Supabase Pro charge. The app is pre-monetization with ~5 users. Supabase free tier is not viable due to project freeze after 1 week of inactivity. Neon free tier + Clerk free tier (10K MAU) covers all current needs at $0/mo.

## Architecture Overview

- **Database:** Neon Postgres (serverless driver `@neondatabase/serverless`)
- **Auth:** Clerk (`@clerk/clerk-js` for Tauri desktop, `@clerk/nextjs` for web)
- **Auth methods:** Email/password + Discord OAuth (both retained)
- **Desktop auth flow:** Browser-based OAuth with `sts2replay://` deep links (same pattern as current)
- **All work on a feature branch**

## Section 1: Database Migration (Neon)

### Schema changes

- `pg_dump` Supabase DB (data + schema), restore to Neon
- Drop all RLS policies (9 user-scoped + 8 public read)
- Drop `auth.users` foreign key references from `runs`, `evaluations`, `choices`
- Change `user_id` column type from `uuid` to `text` on: `runs`, `evaluations`, `choices`, `usage_logs`, `error_logs`, `profiles`
- Drop `profiles.id` FK reference to `auth.users(id)` — becomes a plain `text` primary key

### What stays the same

- All table structures, indexes, views (`evaluation_stats`), and game data tables unchanged
- Existing migration files stay in `supabase/migrations/` as history but are not used operationally
- Future migrations managed via raw SQL files or a migration tool (TBD)

### Connection

- `@neondatabase/serverless` for Next.js API routes (supports edge + serverless)
- Connection string via `DATABASE_URL` env var
- No direct DB access from the desktop app — all queries go through the API

### New game data API routes (public, no auth)

The desktop currently queries Supabase directly for game data. These become new Next.js API routes:

- `GET /api/game-data/cards` — all cards (used by `card-filter.ts`, `upgrade-lookup.ts`)
- `GET /api/game-data/relics` — all relics (used by `relic-lookup.ts`)
- `GET /api/game-data/monsters?ids=...` — monsters by ID (used by `boss-briefing.tsx`)
- `GET /api/game-data/characters` — characters with starter decks

Public read endpoints, no auth required (matches current RLS: `select using (true)`). Add `Cache-Control` headers since game data changes infrequently.

## Section 2: Auth Migration (Clerk)

### Auth methods

- **Email/password:** Clerk's `signIn.create({ identifier, password })` and `signUp.create({ emailAddress, password })` via `@clerk/clerk-js`
- **Discord OAuth:** Browser-based flow — desktop opens system browser → Clerk Discord OAuth → redirects to `sts2replay://auth/callback` with session token → Tauri deep-link handler exchanges token

### Desktop auth flow (Tauri)

1. Initialize `@clerk/clerk-js` with `Clerk({ publishableKey })` in `main.tsx` — replaces `initSupabase()`
2. Email/password: Clerk JS SDK called directly from Tauri webview (no browser hop)
3. Discord: `clerk.client.signIn.authenticateWithRedirect({ strategy: 'oauth_discord', redirectUrl: 'sts2replay://auth/callback' })` → opens system browser → deep-link handler calls `clerk.handleRedirectCallback()` or extracts session token from URL
4. Session token getter: `clerk.session.getToken()` replaces `supabase.auth.getSession()` — same pattern, returns JWT for Bearer auth
5. Auth state listener: `clerk.addListener()` replaces `supabase.auth.onAuthStateChange()`

### Web app auth

- Replace `@supabase/ssr` with `@clerk/nextjs` middleware
- `requireAuth()` in API routes becomes `auth()` from `@clerk/nextjs/server`
- Drop the cookie-based Supabase server client entirely
- Auth callback route (`/auth/callback/route.ts`) replaced by Clerk's built-in handling

### Shared package changes

- Delete `packages/shared/supabase/auth.ts`
- Delete `packages/shared/supabase/client.ts`
- Update `packages/shared/lib/init.ts` — remove Supabase config, add Clerk publishable key
- `api-client.ts` token getter keeps same interface, backed by Clerk instead of Supabase

### User ID format

- Supabase: UUID (`a1b2c3d4-...`)
- Clerk: string (`user_2x4k...`)
- All `user_id` columns become `text` (covered in Section 1)

## Section 3: API Route Changes

### Routes requiring auth changes

All routes currently using `requireAuth()` switch to Clerk's `auth()`:

- `POST /api/run`
- `POST /api/evaluate`
- `POST /api/choice`
- `POST /api/act-path`
- `POST /api/error`

### Auth replacement

```ts
// Before (api-auth.ts — dual-path Bearer + cookie)
const auth = await requireAuth();
if ("error" in auth) return auth.error;

// After (Clerk — handles both Bearer and cookie automatically)
import { auth } from "@clerk/nextjs/server";
const { userId } = await auth();
if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

### DB client replacement

```ts
// Before
import { createServiceClient } from "@/lib/supabase/server";
const supabase = createServiceClient();
await supabase.from("runs").upsert({ run_id, character, user_id });

// After
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
await sql`INSERT INTO runs (run_id, character, user_id)
          VALUES (${runId}, ${character}, ${userId})
          ON CONFLICT (run_id) DO UPDATE SET character = ${character}`;
```

### New route: `GET /api/profile`

Returns the authenticated user's profile (role). Used by the desktop app's auth provider to load user role after sign-in. Replaces the direct `.from("profiles")` query.

### Removed files

- `apps/web/src/lib/supabase/server.ts` (service client)
- `apps/web/src/lib/api-auth.ts` (dual-path auth)
- `apps/web/src/app/auth/callback/route.ts` (Supabase code exchange)

## Section 4: Desktop App Changes

### Initialization (`main.tsx`)

- Remove: `supabaseUrl`, `supabaseAnonKey`, `storageMode: "localStorage"`
- Add: Clerk initialization via `Clerk({ publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY })`
- `accessTokenGetter`: `clerk.session.getToken()` replaces `supabase.auth.getSession()`
- `fetchImplementation`: stays (Tauri HTTP plugin still needed)
- `apiBaseUrl`: unchanged

### Auth provider (`auth-provider.tsx`) — full rewrite

- Initialize Clerk JS SDK
- Email/password via Clerk SDK
- Discord via system browser + deep link callback
- Session state via `clerk.addListener()`
- User role: query `/api/profile` instead of direct Supabase `.from("profiles")` call
- Expose same `AuthContextValue` interface: `user`, `loading`, `signInPassword`, `signUp`, `signInDiscord`, `signOut`

### Login screen (`login-screen.tsx`) — no changes

Consumes `useAuth()` hook which keeps the same interface.

### Game data queries — file changes

| File | Current | New |
|------|---------|-----|
| `card-filter.ts` | `supabase.from("cards").select(...)` | `fetch("/api/game-data/cards")` via shared API client |
| `relic-lookup.ts` | `supabase.from("relics").select(...)` | `fetch("/api/game-data/relics")` via shared API client |
| `upgrade-lookup.ts` | `supabase.from("cards").select(...)` | `fetch("/api/game-data/cards")` (filter client-side) |
| `boss-briefing.tsx` | `supabase.from("monsters").select(...)` | `fetch("/api/game-data/monsters?ids=...")` via shared API client |
| `starter-decks.ts` | `supabase.from("characters").select(...)` | `fetch("/api/game-data/characters")` via shared API client |

All keep in-memory caching + localStorage patterns — just the data source changes.

### Dependency changes

- **Remove:** `@supabase/supabase-js` from desktop `package.json`
- **Add:** `@clerk/clerk-js`
- **Keep:** `@tauri-apps/plugin-deep-link`, `@tauri-apps/plugin-shell`, `@tauri-apps/plugin-http`

### Shared package dependency changes

- **Remove:** `@supabase/ssr`, `@supabase/supabase-js`
- **Delete:** `supabase/` directory (auth.ts, client.ts) — shared package no longer provides a Supabase client
- **No new auth dependency** — auth moves out of the shared package. Desktop uses `@clerk/clerk-js` directly, web uses `@clerk/nextjs`. Shared package retains `api-client.ts` (token getter interface unchanged).

### Web app dependency changes

- **Remove:** `@supabase/supabase-js`, `@supabase/ssr`
- **Add:** `@clerk/nextjs`, `@neondatabase/serverless`

## Section 5: User Migration Strategy

### Pre-cutover (Supabase still live)

1. Export user mapping from Supabase: `id` (uuid), `email`, Discord identity for all 5 users
2. Store as `scripts/user-migration.json`

### Cutover

1. Deploy new code behind feature branch deploy on Vercel
2. Have 5 users re-register on Clerk (Discord or email/password)
3. For each user, note new Clerk user ID (`user_2x...`)
4. Run migration script against Neon:

```sql
UPDATE runs SET user_id = 'user_2xNEW' WHERE user_id = 'old-supabase-uuid';
UPDATE evaluations SET user_id = 'user_2xNEW' WHERE user_id = 'old-supabase-uuid';
UPDATE choices SET user_id = 'user_2xNEW' WHERE user_id = 'old-supabase-uuid';
UPDATE usage_logs SET user_id = 'user_2xNEW' WHERE user_id = 'old-supabase-uuid';
UPDATE profiles SET id = 'user_2xNEW' WHERE id = 'old-supabase-uuid';
```

5. Verify each user can see their existing runs/data
6. Decommission Supabase project

### Rollback plan

Supabase project stays live until migration is verified. Revert feature branch if something goes wrong — no data lost on either side.

## Environment Variables

### Remove

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL` (desktop)
- `VITE_SUPABASE_ANON_KEY` (desktop)

### Add

- `DATABASE_URL` (Neon connection string)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `VITE_CLERK_PUBLISHABLE_KEY` (desktop)
