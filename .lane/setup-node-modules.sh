#!/bin/bash
# Farm node_modules from the HEALTHY main checkout (hazard correction
# 2026-10-23: bdv-wt-integration's frontend node_modules is ELOOP-corrupt).
# @workspace packages are mapped BY NAME into THIS worktree — never copied
# from the farm, whose @workspace links point into an old lane tree.
set -euo pipefail
WT="$HOME/workspace/bdv-wt-coposts"
MAIN="$HOME/workspace/bow-down-visuals"

rm -f "$WT/node_modules"
ln -s "$MAIN/node_modules" "$WT/node_modules"

# Plain whole-dir links where the farm dir carries no @workspace links:
for rel in artifacts/bow-down-visuals/node_modules lib/db/node_modules lib/api-zod/node_modules; do
  rm -rf "$WT/$rel"
  ln -s "$MAIN/$rel" "$WT/$rel"
done

# api-server: per-entry farm so @workspace/* resolve into THIS worktree.
API_NM="$WT/artifacts/api-server/node_modules"
rm -rf "$API_NM"
mkdir -p "$API_NM/@workspace"
for entry in "$MAIN/artifacts/api-server/node_modules"/* "$MAIN/artifacts/api-server/node_modules"/.[!.]*; do
  name=$(basename "$entry")
  [ "$name" = "@workspace" ] && continue
  [ -e "$entry" ] || continue
  ln -s "$entry" "$API_NM/$name"
done
ln -s "$WT/lib/db" "$API_NM/@workspace/db"
ln -s "$WT/lib/api-zod" "$API_NM/@workspace/api-zod"

echo "db:      $(readlink -f "$API_NM/@workspace/db")"
echo "api-zod: $(readlink -f "$API_NM/@workspace/api-zod")"
