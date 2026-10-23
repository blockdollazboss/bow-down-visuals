# RUNBOOK — the real 3D generation, one command away

Prepared 2026-10-18 after the owner's showdown verdict ("We have to do
better"). The best free generator — **Pixal3D on the TRELLIS.2 backbone
(MIT, pixel-aligned to the input art)** — has never actually produced a
body: its `generate_3d` step declares 120 s of ZeroGPU and the
*anonymous* free quota rejected it on all 10 chain attempts. The space's
own error says the unlock out loud: *"Authenticate with a Hugging Face
token for more quota."* Everything below is staged so that the moment a
token exists, **one command per subject** produces a judgeable body on
the proof stage. No accounts were created by this prep; no paid service
exists anywhere in this pipeline.

## The one missing ingredient (owner's call, $0)

A **free Hugging Face account + a read token**
(huggingface.co → Settings → Access Tokens). The token is supplied via
the `HF_TOKEN` environment variable only — never written into any file,
script, or commit in this folder.

## Fire it

```bash
export HF_TOKEN=hf_...            # env only; never echo it back
cd ~/workspace/world-palace/hunyuan-run
./run-treillis.sh guard-male      # then: guard-female, king
```

Per subject the wrapper:
1. Runs `treillis_chain.py` against `tencentarc-pixal3d.hf.space` —
   upload → `/preprocess` → `/generate_3d` → `/extract_glb_api` →
   download. Endpoint signatures were verified live against the space's
   `/gradio_api/info` on 2026-10-18; the parameter vector is the same
   one the anonymous chain proved (it passed upload + preprocess
   repeatedly and died only on quota). Inputs come from
   `~/workspace/world-palace/3d-inputs/` (see its README for sources).
2. Saves the raw GLB to `runs/<subject>-pixal3d.glb`.
3. Installs it into the showdown stage's generated slot
   (`bdv-wt-3d/.../public/world/guard-gen.glb`), first preserving the
   incumbent Hunyuan evidence body as `guard-gen.hunyuan-evidence.glb`.
4. Prints the stage URLs. Judge with `?focus=gen` + `cam=front|side|
   back|threequarter`, `action=walk|bow`, `&speak=` for the jaw; if the
   statue faces backwards add `&genrot=3.14159`.

Declared-quota math to expect: preprocess ~30 s, generate ~120 s,
extract ~240 s per body. If a signed-in grant still rejects a step, the
chain stops with the space's own message; re-running later is safe and
free (no server-side state, no charge).

Options when needed: `treillis_chain.py --seed N --resolution 1024
--faces 100000 --texture 2048 --attempts 4` (defaults shown). The
extract step decimates to `--faces`; 100k is for judging quality — the
hall budget (≤20k tris) is a later integration pass, same as the
Hunyuan body went through.

## Stage 2 — rigging (UniRig), documented, UNTESTED

Generation output is a statue. The showdown's `from-glb.ts` auto-skin
is the judging stand-in; **UniRig** is the production rigger (open
source, built for non-human shapes). `unirig_stage.py` documents both
routes and submits nothing blindly:

- **Space route:** UniRig's repo links **no** public demo space (only
  the model repo `VAST-AI/UniRig`); the demo space found in route
  research was down (runtime error). `python3 unirig_stage.py --probe
  [owner/space]` prints a candidate space's endpoint map for a human
  to confirm before anything is wired.
- **Repo route (exact, from UniRig's README):** needs a CUDA GPU
  ≥ 8 GB VRAM — Colab/Kaggle free tier qualifies; this VM has no GPU.
  `python3 unirig_stage.py --local-plan runs/guard-male-pixal3d.glb
  --name guard-male` prints the full clone → skeleton → skin → merge
  command chain with real paths.
- **Honest caveat:** a UniRig-rigged GLB carries UniRig's bone names,
  not the house 20-bone rig. One Blender mapping pass (the
  `from-glb.ts` named-part path is the integration point) stands
  between a rigged body and the shared clips. Nobody should promise
  otherwise.

## What is genuinely one-command-away vs still blocked

- **One command away (given only the token):** Pixal3D bodies for both
  guards + the King, on the showdown stage, judgeable in the browser.
- **Still blocked on the same token:** nothing else in generation —
  the token IS the wall; there is no second hidden step.
- **Blocked on a GPU (not money):** UniRig production rigging (needs
  any ≥8 GB CUDA GPU — free notebook tiers count once signed in).
- **Not blocked, just later:** decimation to hall budget, regalia
  re-attachment as house meshes, bone-name mapping — integration work
  in the 3D worktree once a body wins the judging.
