#!/bin/sh
# Restore from the last run that verified the hosted preview.
set -eu
cd "$(dirname "$0")/.."

previous=$(gh run list --workflow preview.yml --branch preview --status success --limit 1 --json databaseId --jq '.[0].databaseId // empty')
if [ -n "$previous" ]; then
    count=$(gh api "repos/$GH_REPO/actions/runs/$previous/artifacts" --jq '[.artifacts[] | select(.name=="offline-engines" and .expired==false)] | length')
    if [ "$count" = 1 ]; then
        gh run download "$previous" -n offline-engines -D engine/dist
    fi
fi

if [ "${1:-}" = --required ] && { [ ! -s engine/dist/stable/engine.json ] || [ ! -s engine/dist/trunk/engine.json ]; }; then
    echo "::error::No verified offline engine pair was restored. Run Deploy preview manually on the preview branch to build and verify both channels."
    exit 1
fi
