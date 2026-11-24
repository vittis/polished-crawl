#!/bin/sh
# Resolve each upstream revision once. The preview job installs emsdk only when the plan contains a build.
set -eu
cd "$(dirname "$0")/.."
plan() {
    recipe=$(node engine/recipe.mjs)
    for channel in stable trunk; do
        if [ "$channel" = trunk ]; then ref=refs/heads/master
        else ref=$(git ls-remote --tags --refs https://github.com/crawl/crawl.git | cut -f2 | grep -E '^refs/tags/[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)
        fi
        test -n "$ref"
        commit=$(git ls-remote https://github.com/crawl/crawl.git "$ref" "$ref^{}" | tail -1 | cut -f1)
        test "${#commit}" -eq 40
        if test -f "engine/dist/$channel/engine.json" && node --input-type=module -e '
          import {readFileSync} from "node:fs";
          const [path, commit, recipe] = process.argv.slice(1);
          const info = JSON.parse(readFileSync(path));
          process.exit(info.commit === commit && info.recipe === recipe ? 0 : 1);
        ' "engine/dist/$channel/engine.json" "$commit" "$recipe"; then
            continue
        fi
        printf '%s %s\n' "$channel" "$commit"
    done
}
case "${1:-}" in
    --plan) plan ;;
    --build)
        while read -r channel commit; do
            ENGINE_REVISION="$commit" sh engine/build.sh "$channel" </dev/null
        done < "$2" ;;
    --test)
        node engine/smoke.mjs
        ENGINE_VARIANT=asyncify node engine/smoke.mjs
        REQUIRE_ENGINE=1 npm run e2e ;;
    *) echo 'usage: engine/ci.sh --plan | --build PLAN_FILE | --test' >&2; exit 2 ;;
esac
