#!/usr/bin/env bash
# Pull Vercel env vars into .env.local and merge sensitive values from
# .env.local.secrets.
#
# Why: Vercel "sensitive" env vars can't be read back via `vercel env pull` —
# they come down as empty strings. Keep them in a gitignored
# .env.local.secrets sidecar, rotate in one place, let this script merge them
# into the pulled .env.local.
#
# Usage:
#   scripts/pull-env.sh                 # pulls development (default)
#   scripts/pull-env.sh production      # pulls production
#   scripts/pull-env.sh preview         # pulls preview
#
# Always runs from the main checkout — safe to invoke from any worktree.

set -euo pipefail

MAIN_WT=$(git worktree list --porcelain | awk '/^worktree / {path=$2} /^branch refs\/heads\/main$/ {print path; exit}')
if [ -z "$MAIN_WT" ]; then
  echo "Error: could not find main worktree" >&2
  exit 1
fi
cd "$MAIN_WT"

ENV="${1:-development}"
SECRETS_FILE=".env.local.secrets"

echo "→ Pulling Vercel env ($ENV) into main..."
vercel env pull .env.local --environment="$ENV" --yes > /dev/null

if [ ! -f "$SECRETS_FILE" ]; then
  echo ""
  echo "⚠  $SECRETS_FILE not found in main ($MAIN_WT)."
  echo "   Sensitive Vercel vars will be empty in .env.local."
  echo ""
  echo "   Create it with one KEY=value per line, e.g.:"
  echo "     ANTHROPIC_API_KEY=sk-ant-..."
  echo "     GOOGLE_GENERATIVE_AI_API_KEY=..."
  echo ""
  echo "   Already gitignored by the .env* rule."
  exit 0
fi

echo "→ Merging $SECRETS_FILE..."
merged=0
while IFS= read -r line || [ -n "$line" ]; do
  # Skip blank lines and comments.
  [ -z "$line" ] && continue
  case "$line" in \#*) continue ;; esac

  key="${line%%=*}"
  value="${line#*=}"

  # Skip lines that don't look like KEY=value.
  [ "$key" = "$line" ] && continue

  if grep -qE "^${key}=" .env.local; then
    awk -v k="$key" -v v="$value" '
      $0 ~ "^"k"=" { print k"="v; next }
      { print }
    ' .env.local > .env.local.tmp && mv .env.local.tmp .env.local
  else
    printf '%s=%s\n' "$key" "$value" >> .env.local
  fi
  merged=$((merged + 1))
done < "$SECRETS_FILE"

echo "✓ .env.local ready (merged $merged secret$([ "$merged" -eq 1 ] || echo 's'))"
