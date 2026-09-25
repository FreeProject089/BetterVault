#!/usr/bin/env bash
# Publie (ou met à jour) le résumé de la porte de sécurité en commentaire de la
# demande de fusion. Un seul commentaire par porte : il est repéré par un
# marqueur caché et remplacé à chaque passage, au lieu de s'empiler.
#   scripts/pr-comment.sh <fichier-markdown> <marqueur>
# Variables : GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, GITHUB_SERVER_URL, GITHUB_RUN_ID
set -euo pipefail

file="${1:?fichier du résumé manquant}"
marker="<!-- ${2:?marqueur manquant} -->"
: "${PR_NUMBER:?PR_NUMBER manquant}"

run_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-}"
body="$(printf '%s\n%s\n\n[Rapports complets et journaux](%s)\n' "$marker" "$(cat "$file")" "$run_url")"

existing="$(gh api --paginate "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
  --jq ".[] | select(.user.type == \"Bot\" and (.body | startswith(\"${marker}\"))) | .id" | head -n 1)"

if [ -n "$existing" ]; then
  gh api -X PATCH "repos/${GITHUB_REPOSITORY}/issues/comments/${existing}" -f body="$body" >/dev/null
  echo "Commentaire mis à jour (${existing})"
else
  gh api -X POST "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" -f body="$body" >/dev/null
  echo "Commentaire publié"
fi
