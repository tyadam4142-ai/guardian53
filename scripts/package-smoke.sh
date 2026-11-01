#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/project/scripts"
cp -a "$ROOT/extension" "$TMP/project/extension"
cp "$ROOT/scripts/package-extension.sh" "$TMP/project/scripts/package-extension.sh"
chmod +x "$TMP/project/scripts/package-extension.sh"
(
  cd "$TMP/project"
  GUARDIAN_API_ORIGIN=https://guardian53-test.example.invalid ./scripts/package-extension.sh >/dev/null
  unzip -t build/guardian53-extension.zip >/dev/null
  python3 - <<'PY'
import json, zipfile
with zipfile.ZipFile('build/guardian53-extension.zip') as archive:
    manifest = json.loads(archive.read('manifest.json'))
    config = archive.read('config.js').decode('utf-8')
assert manifest['host_permissions'] == ['<all_urls>', 'https://guardian53-test.example.invalid/*']
assert "API_BASE_URL: 'https://guardian53-test.example.invalid'" in config
assert 'background.js' in archive.namelist() and 'manifest.json' in archive.namelist()
print('Extension packaging smoke test passed.')
PY
)
