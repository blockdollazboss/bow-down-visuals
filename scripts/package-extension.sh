#!/bin/bash
# Package the Thy Cheat Code extension and sync version to website.
# Single source of truth: ~/workspace/bow-down-visuals-extension/manifest.json
# This script reads the version from there, builds the zip, and updates
# the website's download label so it can NEVER go stale.
set -e

EXT_DIR="$HOME/workspace/bow-down-visuals-extension"
SITE_DIR="$HOME/workspace/bow-down-visuals"
PUBLIC_DIR="$SITE_DIR/artifacts/bow-down-visuals/public"
YOUR_FILES="$HOME/workspace/your_files"

# Read version from manifest (single source of truth)
VERSION=$(python3 -c "import json; print(json.load(open('$EXT_DIR/manifest.json'))['version'])")
echo "Packaging extension v$VERSION..."

# Build the zip
cd "$EXT_DIR"
ZIP_NAME="bow-down-visuals-extension-v2.zip"
rm -f "$ZIP_NAME"
zip -qr "$ZIP_NAME" . -x "*.DS_Store*" -x "$ZIP_NAME"

# Copy to website public dir and your_files
cp "$ZIP_NAME" "$PUBLIC_DIR/$ZIP_NAME"
cp "$ZIP_NAME" "$YOUR_FILES/$ZIP_NAME"
echo "Zip copied to website and your_files"

# Update the version label on the extension page (never stale again).
# Since the i18n move, the label lives in the VALUES of the
# "download_for_chrome_v2_0_1" key in src/locales/*.json — NOT in
# extension.tsx. Update every locale and FAIL LOUDLY if nothing changed
# (the old regex targeted a literal that no longer exists and printed
# success unconditionally — silent no-op, found Oct 20, 2026).
LOCALES_DIR="$SITE_DIR/artifacts/bow-down-visuals/src/locales"
python3 << PYEOF
import glob, re, sys
files = glob.glob("$LOCALES_DIR/*.json")
total = 0
for path in files:
    s = open(path).read()
    s2 = re.sub(r'("download_for_chrome_v2_0_1"\s*:\s*"[^"]*v)[\d.]+', r'\g<1>$VERSION', s)
    if s2 != s:
        total += 1
        open(path, 'w').write(s2)
if total == 0:
    print("ERROR: extension label not found in any locale file — label step FAILED, nothing was updated.", file=sys.stderr)
    sys.exit(1)
print(f"Extension page label updated to v$VERSION in {total} locale file(s)")
PYEOF

echo "Done: v$VERSION packaged and synced."
echo "Next: commit, push to staging, verify, then merge to main after approval."
