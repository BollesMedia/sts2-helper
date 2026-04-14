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

Always use `vercel env pull .env.local` in main. Don't hand-edit `.env.local`. See `feedback_vercel_env_vars.md` in user memory.

## Package manager

pnpm. Never mix lockfiles.
