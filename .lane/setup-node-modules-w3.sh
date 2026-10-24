#!/bin/bash
# Lane node_modules recipe (copied from stack29/bookings, proven):
# per-package node_modules = dir of symlinks into the MAIN checkout's
# installed tree, except @workspace/* which point into THIS worktree.
set -e
SRC=/home/hatch/workspace/bow-down-visuals
DST=/home/hatch/workspace/bdv-wt-bumps
for P in "." "artifacts/api-server" "artifacts/bow-down-visuals" "lib/api-zod" "lib/db"; do
  mkdir -p "$DST/$P/node_modules"
  for e in "$SRC/$P/node_modules"/* "$SRC/$P/node_modules"/.[!.]*; do
    [ -e "$e" ] || continue
    name=$(basename "$e")
    [ "$name" = "@workspace" ] && continue
    ln -sfn "$e" "$DST/$P/node_modules/$name"
  done
  mkdir -p "$DST/$P/node_modules/@workspace"
  ln -sfn "$DST/lib/db" "$DST/$P/node_modules/@workspace/db"
  ln -sfn "$DST/lib/api-zod" "$DST/$P/node_modules/@workspace/api-zod"
done
echo SETUP_OK
