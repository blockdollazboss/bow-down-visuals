#!/bin/bash
set -euo pipefail
WT="$HOME/workspace/bdv-wt-w3-corel"
MAIN="$HOME/workspace/bow-down-visuals"
rm -f "$WT/node_modules"; ln -s "$MAIN/node_modules" "$WT/node_modules"
for rel in artifacts/bow-down-visuals/node_modules lib/db/node_modules lib/api-zod/node_modules; do
  rm -rf "$WT/$rel"; ln -s "$MAIN/$rel" "$WT/$rel"
done
API_NM="$WT/artifacts/api-server/node_modules"
rm -rf "$API_NM"; mkdir -p "$API_NM/@workspace"
for entry in "$MAIN/artifacts/api-server/node_modules"/* "$MAIN/artifacts/api-server/node_modules"/.[!.]*; do
  name=$(basename "$entry"); [ "$name" = "@workspace" ] && continue; [ -e "$entry" ] || continue; ln -s "$entry" "$API_NM/$name"
done
ln -s "$WT/lib/db" "$API_NM/@workspace/db"
ln -s "$WT/lib/api-zod" "$API_NM/@workspace/api-zod"
echo "db:      $(readlink -f "$API_NM/@workspace/db")"
echo "api-zod: $(readlink -f "$API_NM/@workspace/api-zod")"
