#!/bin/bash
# Farm node_modules from the HEALTHY main checkout (hazard correction:
# bdv-wt-integration's frontend node_modules is ELOOP-corrupt).
# @workspace packages are mapped BY NAME into THIS worktree — the main
# checkout's own @workspace links point into an old lane tree.
set -euo pipefail
WT="$HOME/workspace/bdv-wt-comments"
MAIN="$HOME/workspace/bow-down-visuals"

farm_root() {
  local rel="$1"
  local src="$MAIN/$rel" dst="$WT/$rel"
  [ -d "$src" ] || { echo "skip (no farm dir): $rel"; return; }
  rm -rf "$dst"; mkdir -p "$dst"
  for entry in "$src"/* "$src"/.[!.]*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    name=$(basename "$entry")
    [ "$name" = "@workspace" ] && continue
    ln -s "$entry" "$dst/$name"
  done
  # @workspace by name into this worktree
  if [ -d "$src/@workspace" ]; then
    mkdir -p "$dst/@workspace"
    for entry in "$src/@workspace"/*; do
      [ -e "$entry" ] || [ -L "$entry" ] || continue
      name=$(basename "$entry")
      case "$name" in
        db) ln -s "$WT/lib/db" "$dst/@workspace/db" ;;
        api-zod) ln -s "$WT/lib/api-zod" "$dst/@workspace/api-zod" ;;
        api-spec) ln -s "$WT/lib/api-spec" "$dst/@workspace/api-spec" ;;
        api-client-react) ln -s "$WT/lib/api-client-react" "$dst/@workspace/api-client-react" ;;
        *) ln -s "$entry" "$dst/@workspace/$name" ;;
      esac
    done
  fi
}

for rel in node_modules artifacts/api-server/node_modules artifacts/bow-down-visuals/node_modules lib/db/node_modules lib/api-zod/node_modules; do
  farm_root "$rel"
done

for rel in node_modules artifacts/api-server/node_modules artifacts/bow-down-visuals/node_modules lib/db/node_modules lib/api-zod/node_modules; do
  for pkg in db api-zod; do
    p="$WT/$rel/@workspace/$pkg"
    [ -e "$p" ] && echo "$rel/@workspace/$pkg -> $(readlink -f "$p")"
  done
done
