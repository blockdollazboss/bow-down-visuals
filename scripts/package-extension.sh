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

# Update the version label on the extension page (never stale again)
EXT_PAGE="$SITE_DIR/artifacts/bow-down-visuals/src/pages/extension.tsx"
python3 << PYEOF
import re
s = open("$EXT_PAGE").read()
# Replace any "Download for Chrome — vX.Y.Z" with current version
s = re.sub(r'Download for Chrome — v[\d.]+', 'Download for Chrome — v$VERSION', s)
open("$EXT_PAGE", 'w').write(s)
print("Extension page label updated to v$VERSION")
PYEOF

echo "Done: v$VERSION packaged and synced."
echo "Next: commit, push to staging, verify, then merge to main after approval."
