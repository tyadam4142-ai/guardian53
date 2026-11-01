#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
while IFS= read -r file; do node --check "$file"; done < <(find "$ROOT/server/src" "$ROOT/extension" "$ROOT/public" -type f -name '*.js' -print)
node --test "$ROOT"/extension/tests/*.test.js
python3 -m json.tool "$ROOT/extension/manifest.json" >/dev/null
python3 -m json.tool "$ROOT/server/wrangler.jsonc" >/dev/null 2>&1 || echo "wrangler.jsonc uses JSONC comments/schema; validate with Wrangler during deployment."
python3 "$ROOT/scripts/db-smoke.py"
"$ROOT/scripts/package-smoke.sh"
for script in "$ROOT"/scripts/*.sh; do bash -n "$script"; done
echo "Static, SQL, and package smoke checks passed. Cloudflare D1 deployment and live Chrome/Edge/browser tests remain release gates."
