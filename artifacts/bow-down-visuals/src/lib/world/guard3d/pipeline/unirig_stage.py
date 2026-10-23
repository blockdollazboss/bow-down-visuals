#!/usr/bin/env python3
"""unirig_stage.py — STAGE 2 (rigging) for the free 3D pipeline. STUB.

STATUS: UNTESTED — written 2026-10-18 from UniRig's own repo docs; no
route below has been executed end-to-end yet. Read before running.

WHY THIS EXISTS: Pixal3D/TRELLIS.2 output is a statue (no skeleton). The
showdown stage auto-skins statues onto the house rig procedurally
(from-glb.ts) — good enough to judge a body, approximate at shoulders/
tail. UniRig (VAST-AI + Tsinghua, SIGGRAPH 2025, open source) is the
production rigger: it predicts a topologically valid skeleton + skinning
weights for non-human shapes (shark heads, tails, robe skirts are
exactly its design case, and exactly what template riggers fail on).

ROUTE A — HF SPACE (not verified): UniRig's repo README links NO public
demo space (only the model repo, huggingface.co/VAST-AI/UniRig); the one
demo space found during route research was down with a runtime error.
This script can PROBE a candidate space id (env UNIRIG_SPACE_ID) and
print its gradio endpoint map, but it will NOT submit a job: endpoint
names/indices must be confirmed from the probe output first, by a human.
  python3 unirig_stage.py --probe            # uses UNIRIG_SPACE_ID
  python3 unirig_stage.py --probe some-owner/some-space

ROUTE B — REPO ON A GPU BOX (exact commands, from the repo README —
the reliable path): UniRig needs a CUDA GPU with >= 8 GB VRAM (repo's
own requirement); this VM has no GPU, so run it on Colab/Kaggle free
tier or any GPU box. The chain is:
  git clone https://github.com/VAST-AI-Research/UniRig && cd UniRig
  python -m pip install torch torchvision
  python -m pip install -r requirements.txt   (+ spconv / torch_scatter
  / torch_cluster per README for your CUDA version; checkpoint
  auto-downloads from HF VAST-AI/UniRig)
  bash launch/inference/generate_skeleton.sh --input STATUE.glb --output work/NAME_skeleton.fbx
  bash launch/inference/generate_skin.sh     --input work/NAME_skeleton.fbx --output work/NAME_skin.fbx
  bash launch/inference/merge.sh --source work/NAME_skin.fbx --target STATUE.glb --output NAME-rigged.glb
(--seed N on generate_skeleton.sh samples alternate skeletons.)
  python3 unirig_stage.py --local-plan STATUE.glb --name guard-male
prints this chain with your paths filled in. --execute runs it, and is
refused on a machine without an NVIDIA GPU.

AFTER RIGGING: the rigged GLB carries UniRig's own skeleton, NOT the
house 20-bone names. Integration work (not done here): either retarget
the house clips onto UniRig's bones, or rename/map bones to the house
rig in Blender and re-export. from-glb.ts's named-part path is the
integration point. Do not promise the owner a rigged body "drops in" —
it does not; it is one Blender mapping pass away.
"""
import argparse, json, os, shutil, subprocess, sys
import requests

def probe(space_id):
    print(f"probing HF space: {space_id}")
    try:
        r = requests.get(f"https://huggingface.co/api/spaces/{space_id}", timeout=60)
        print("api/spaces status:", r.status_code)
        if r.status_code == 200:
            d = r.json()
            print("  runtime:", json.dumps(d.get("runtime", {}))[:300])
            host = (d.get("runtime") or {}).get("domain") or \
                   f"https://{space_id.replace('/', '-').lower()}.hf.space"
        else:
            host = f"https://{space_id.replace('/', '-').lower()}.hf.space"
    except Exception as e:
        print("api probe failed:", e)
        host = f"https://{space_id.replace('/', '-').lower()}.hf.space"
    print("candidate host:", host)
    try:
        r = requests.get(f"{host}/gradio_api/info", timeout=60)
        print("gradio_api/info status:", r.status_code)
        if r.status_code == 200:
            for k in r.json().get("named_endpoints", {}):
                print("  endpoint:", k)
            print("-> Confirm the rigging endpoint + its parameter order "
                  "from this list, then wire it in treillis_chain.py style. "
                  "This stub submits nothing.")
            return 0
    except Exception as e:
        print("gradio probe failed:", e)
    print("-> Space unreachable/down (consistent with route research). "
          "Use Route B (--local-plan).")
    return 3

def local_plan(glb, name):
    print(f"""UniRig Route B — run on a CUDA GPU box (>= 8 GB VRAM; Colab T4 OK):

  git clone https://github.com/VAST-AI-Research/UniRig && cd UniRig
  python -m pip install torch torchvision
  python -m pip install -r requirements.txt
  # + spconv / torch_scatter / torch_cluster per the repo README for
  #   your CUDA version; the checkpoint auto-downloads from
  #   huggingface.co/VAST-AI/UniRig on first run.
  mkdir -p work
  bash launch/inference/generate_skeleton.sh --input {glb} --output work/{name}_skeleton.fbx
  bash launch/inference/generate_skin.sh     --input work/{name}_skeleton.fbx --output work/{name}_skin.fbx
  bash launch/inference/merge.sh --source work/{name}_skin.fbx --target {glb} --output {name}-rigged.glb

Then: one Blender pass mapping UniRig's bones to the house rig names
(see from-glb.ts) before the body can play the shared clips.""")

def main():
    ap = argparse.ArgumentParser(description="UniRig rigging stage (STUB, untested)")
    ap.add_argument("--probe", nargs="?", const=os.environ.get("UNIRIG_SPACE_ID", ""),
                    help="probe a candidate HF space id (or env UNIRIG_SPACE_ID)")
    ap.add_argument("--local-plan", metavar="GLB", help="print the exact repo-route commands for this statue GLB")
    ap.add_argument("--name", default="body")
    ap.add_argument("--execute", action="store_true", help="with --local-plan: actually run the chain (GPU box only)")
    args = ap.parse_args()
    if args.probe is not None:
        if not args.probe:
            print("no space id given (arg or UNIRIG_SPACE_ID env). UniRig's "
                  "repo links no demo space; Route B is the reliable path.")
            return 64
        return probe(args.probe)
    if args.local_plan:
        local_plan(os.path.abspath(args.local_plan), args.name)
        if args.execute:
            if not shutil.which("nvidia-smi"):
                print("REFUSED: no NVIDIA GPU on this machine (nvidia-smi missing).")
                return 3
            print("--execute on a GPU box is intentionally left to the "
                  "operator: run the printed chain step by step (the "
                  "install step needs CUDA-version-specific wheels).")
            return 3
        return 0
    ap.print_help()
    return 64

if __name__ == "__main__":
    sys.exit(main())
