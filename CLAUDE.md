# STS2 Helper — project guidance

## Worktree setup

After creating a worktree, run `scripts/setup-worktree.sh` from inside the new worktree. It symlinks `.vercel/` and `.env.local` from the main checkout so the app and CLI work without re-running `vercel link` / `vercel env pull`.

```bash
git worktree add .worktrees/feat/123-foo -b feat/123-foo
cd .worktrees/feat/123-foo
scripts/setup-worktree.sh
```

If the main checkout doesn't have `.vercel/` or `.env.local` yet, the script prints the exact commands to run there first.

## Env var management

Run `scripts/pull-env.sh` from any worktree — pulls Vercel dev env into main and merges sensitive values from `.env.local.secrets`.

```bash
scripts/pull-env.sh                # pulls development (default)
scripts/pull-env.sh production     # pulls production
scripts/pull-env.sh preview        # pulls preview
```

**`.env.local.secrets`** lives in the main checkout (gitignored by the `.env*` rule). One `KEY=value` per line. This sidecar exists because Vercel "sensitive" vars (AI API keys, etc.) can't be read back via `vercel env pull` — they come down as empty strings. Rotate a sensitive key → edit the sidecar → re-run `pull-env.sh`.

Don't hand-edit `.env.local` — it's overwritten on every pull. Edit `.env.local.secrets` instead.

## Package manager

pnpm. Never mix lockfiles.
