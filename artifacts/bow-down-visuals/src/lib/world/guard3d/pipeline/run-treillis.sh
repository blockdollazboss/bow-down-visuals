#!/usr/bin/env bash
# run-treillis.sh — ONE COMMAND from HF token to a judgeable 3D body on
# the showdown stage.
#
#   export HF_TOKEN=hf_...        # free Hugging Face account token.
#                                 # NEVER paste it into this file, a chat
#                                 # log you keep, or a commit. Env only.
#   ./run-treillis.sh guard-male  # or guard-female | king
#
# What it does:
#   1. Runs treillis_chain.py (Pixal3D / TRELLIS.2-backbone, MIT) on the
#      staged input for the subject (~/workspace/world-palace/3d-inputs/).
#   2. Saves the raw GLB to hunyuan-run/runs/<subject>-pixal3d.glb.
#   3. Installs it into the showdown stage's GENERATED slot
#      (public/world/guard-gen.glb in the 3D worktree). The incumbent
#      Hunyuan evidence body is preserved first as
#      guard-gen.hunyuan-evidence.glb (once).
#   4. Prints how to open the stage and judge the body.
#
# The token is read from the environment by treillis_chain.py and is
# never echoed by this script.
set -euo pipefail

SUBJECT="${1:-}"
INPUTS="$HOME/workspace/world-palace/3d-inputs"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$HOME/workspace/bdv-wt-3d/artifacts/bow-down-visuals"
SLOT="$APP/public/world/guard-gen.glb"
EVIDENCE="$APP/public/world/guard-gen.hunyuan-evidence.glb"

case "$SUBJECT" in
  guard-male)   INPUT="$INPUTS/guard-male-front.png" ;;
  guard-female) INPUT="$INPUTS/guard-female-front.png" ;;
  king)
    # Prefer the locally matted King if prep produced one; the as-shot
    # crop otherwise (Pixal3D preprocess segments it on the space).
    if [ -f "$INPUTS/king-front-matted.png" ]; then
      INPUT="$INPUTS/king-front-matted.png"
    else
      INPUT="$INPUTS/king-front.png"
    fi
    ;;
  *) echo "usage: $0 guard-male|guard-female|king" >&2; exit 64 ;;
esac
[ -f "$INPUT" ] || { echo "staged input missing: $INPUT (run prep_inputs.py)" >&2; exit 66; }

if [ -z "${HF_TOKEN:-}" ]; then
  echo "NOTE: HF_TOKEN is not set. The chain will run anonymously and the"
  echo "space's ZeroGPU quota has rejected generate_3d on every anonymous"
  echo "attempt so far. Continuing anyway in 5s (Ctrl-C to stop)..."
  sleep 5
fi

python3 "$HERE/treillis_chain.py" --input "$INPUT" --name "$SUBJECT"
GLB="$HERE/runs/$SUBJECT-pixal3d.glb"

if [ -f "$SLOT" ] && [ ! -f "$EVIDENCE" ]; then
  cp "$SLOT" "$EVIDENCE"
  echo "incumbent generated body preserved -> $EVIDENCE"
fi
cp "$GLB" "$SLOT"
echo "stage slot updated: $SLOT"

cat <<EOF

JUDGE IT — start the showdown stage (from the 3D worktree app):
  cd "$APP" && ./node_modules/.bin/vite --config vite.config.ts --host 0.0.0.0
then open (the generated body stands in the RIGHT slot, focus=gen isolates it):
  http://localhost:5173/world-3d-showdown.html?focus=gen&cam=front
  http://localhost:5173/world-3d-showdown.html?focus=gen&cam=side
  http://localhost:5173/world-3d-showdown.html?focus=gen&cam=back
  http://localhost:5173/world-3d-showdown.html?focus=gen&cam=threequarter
  http://localhost:5173/world-3d-showdown.html?focus=gen&action=walk
  http://localhost:5173/world-3d-showdown.html?focus=gen&action=bow
If the statue faces the wrong way, add &genrot=3.14159 (or the needed
radians) — the loader takes a front-correction rotation.
Next pipeline stage (rigging beyond the proof auto-skin): unirig_stage.py
EOF
