#!/bin/bash
# node_modules farm: symlink-farm from the HEALTHY main checkout, with
# @workspace/* re-pointed BY NAME into THIS worktree.
set -e
MAIN=~/workspace/bow-down-visuals
WT=~/workspace/bdv-wt-pos
for pkg in artifacts/api-server artifacts/bow-down-visuals lib/db lib/api-zod; do
  src="$MAIN/$pkg/node_modules"
  dst="$WT/$pkg/node_modules"
  [ -d "$src" ] || { echo "skip $pkg (no node_modules in main)"; continue; }
  rm -rf "$dst"
  cp -rs "$src" "$dst"
  echo "farmed $pkg"
done
# Root node_modules too (shared .bin / hoisted tools)
cp -rs "$MAIN/node_modules" "$WT/node_modules" 2>/dev/null || true
# Re-point @workspace links by name into this worktree
for pkg in artifacts/api-server artifacts/bow-down-visuals lib/db lib/api-zod; do
  ws="$WT/$pkg/node_modules/@workspace"
  [ -d "$ws" ] || continue
  for link in "$ws"/*; do
    name=$(basename "$link")
    target="$WT/lib/$name"
    if [ -d "$target" ]; then
      rm -f "$link"
      ln -s "$target" "$link"
      echo "repointed $pkg @workspace/$name -> $target"
    fi
  done
done
