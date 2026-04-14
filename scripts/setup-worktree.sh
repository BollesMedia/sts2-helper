#!/usr/bin/env bash
# Symlinks gitignored Vercel state (.vercel/, .env.local) from the main
# worktree so new feature worktrees inherit env vars and project linkage
# without re-running `vercel link` / `vercel env pull` each time.
#
# Run from inside any worktree after creating it:
#   scripts/setup-worktree.sh
#
# Pulls updates automatically: if you run `vercel env pull` in main, all
# worktrees pick up the new env immediately (they're symlinks).

set -euo pipefail

MAIN_WT=$(git worktree list --porcelain | awk '/^worktree / {path=$2} /^branch refs\/heads\/main$/ {print path; exit}')
CURRENT_WT=$(git rev-parse --show-toplevel)

if [ -z "$MAIN_WT" ]; then
  echo "Error: could not find main worktree via 'git worktree list'" >&2
  exit 1
fi

if [ "$CURRENT_WT" = "$MAIN_WT" ]; then
  echo "Already on main — nothing to link"
  exit 0
fi

cd "$CURRENT_WT"

link_from_main() {
  local name="$1"
  local target="$MAIN_WT/$name"

  if [ ! -e "$target" ]; then
    echo "Skip $name — not present in main ($target). Run setup in main first:"
    case "$name" in
      .vercel) echo "    (cd \"$MAIN_WT\" && vercel link)" ;;
      .env.local) echo "    (cd \"$MAIN_WT\" && vercel env pull .env.local)" ;;
    esac
    return
  fi

  if [ -e "$name" ] || [ -L "$name" ]; then
    echo "Skip $name — already exists in worktree"
    return
  fi

  ln -s "$target" "$name"
  echo "Linked $name -> $target"
}

link_from_main .vercel
link_from_main .env.local

# Next.js loads env from the app directory, not the monorepo root. Replicate
# main's apps/web/.env.local -> ../../.env.local symlink so pnpm --filter
# @sts2/web dev picks up the env vars.
if [ ! -e apps/web/.env.local ] && [ ! -L apps/web/.env.local ]; then
  if [ -e .env.local ] || [ -L .env.local ]; then
    (cd apps/web && ln -s ../../.env.local .env.local)
    echo "Linked apps/web/.env.local -> ../../.env.local"
  fi
fi

echo "Worktree setup complete: $CURRENT_WT"
