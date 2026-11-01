#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_ORIGIN="${GUARDIAN_API_ORIGIN:-${1:-}}"
if [[ -z "$API_ORIGIN" ]]; then
  echo "Usage: GUARDIAN_API_ORIGIN=https://guardian.example.com ./scripts/package-extension.sh" >&2
  exit 2
fi
OUT="$ROOT/build"
STAGE="$OUT/extension-configured"
mkdir -p "$OUT"
rm -rf "$STAGE"
cp -a "$ROOT/extension" "$STAGE"
python3 - "$STAGE" "$API_ORIGIN" <<'PY'
import json, pathlib, sys
from urllib.parse import urlsplit
ext = pathlib.Path(sys.argv[1]); origin = sys.argv[2].rstrip('/')
parts = urlsplit(origin)
if parts.scheme != 'https' or not parts.netloc or parts.path or parts.query or parts.fragment or parts.username or parts.password:
    raise SystemExit('Pass an HTTPS origin only, e.g. https://guardian.example.com')
config = ext/'config.js'
config.write_text("// Generated for this packaged release.\nself.GUARDIAN_CONFIG = Object.freeze({ API_BASE_URL: %r, POLICY_POLL_MINUTES: 1, EVENTS_POLL_MINUTES: 1, MAX_DYNAMIC_RULES: 4500 });\n" % origin)
manifest_path = ext/'manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['host_permissions'] = ['<all_urls>', origin + '/*']
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
PY
ZIP="$OUT/guardian53-extension.zip"
rm -f "$ZIP"
(cd "$STAGE" && zip -qr "$ZIP" .)
echo "Created $ZIP"
echo "The source extension/ directory was not modified."
echo "Install: unzip it, then load the extracted folder from chrome://extensions with Developer mode enabled."
