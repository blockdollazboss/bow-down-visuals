#!/usr/bin/env python3
"""treillis_chain.py — Pixal3D (TRELLIS.2 backbone, MIT) generation chain
against the official TencentARC HF Space, WITH a Hugging Face token.

    upload -> /preprocess -> /generate_3d -> /extract_glb_api -> download

The endpoint signatures below were verified live against the space's own
/gradio_api/info on 2026-10-18 and match pixal_chain.py (the anonymous
run): the chain shape is proven — every anonymous attempt passed upload
and preprocess and died ONLY on ZeroGPU quota at generate_3d ("120s
requested vs 0s left ... Authenticate with a Hugging Face token for more
quota"). This script is that same chain plus the token.

TOKEN HYGIENE: the token is read from the HF_TOKEN environment variable
only. It is never printed, never logged, never written to disk — it only
rides the Authorization header to huggingface.co / the space host.

Quota math (declared durations observed on the space): preprocess ~30s,
generate_3d ~120s, extract_glb_api ~240s. A signed-in free ZeroGPU grant
is what makes the 120s + 240s steps fittable; if a step still returns a
quota error, the script says so and stops (re-running later is safe —
nothing is charged and no state is kept server-side between attempts).
"""
import argparse, json, os, sys, time
import requests

BASE = "https://tencentarc-pixal3d.hf.space"
TOKEN = os.environ.get("HF_TOKEN", "").strip()
HEADERS = {"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}
S = requests.Session()

def upload(path):
    ctype = "image/png" if path.lower().endswith(".png") else "image/jpeg"
    with open(path, "rb") as f:
        r = S.post(f"{BASE}/gradio_api/upload",
                   files={"files": (os.path.basename(path), f, ctype)},
                   headers=HEADERS, timeout=180)
    r.raise_for_status()
    return r.json()[0]

def join(fn_index, data, sess):
    r = S.post(f"{BASE}/gradio_api/queue/join",
               json={"data": data, "fn_index": fn_index, "session_hash": sess},
               headers=HEADERS, timeout=120)
    r.raise_for_status()
    return r.json()["event_id"]

def poll(sess, timeout=2400):
    with S.get(f"{BASE}/gradio_api/queue/data", params={"session_hash": sess},
               headers=HEADERS, stream=True, timeout=timeout) as r:
        for line in r.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data: "):
                continue
            try:
                d = json.loads(line[6:])
            except Exception:
                continue
            if d.get("msg") in ("process_completed", "process_error"):
                return d
    return {"msg": "stream_ended"}

def run_step(name, fn_index, data, sess):
    join(fn_index, data, sess)
    res = poll(sess)
    out = res.get("output") or {}
    if out.get("error"):
        raise RuntimeError(f"{name}: {out['error']}")
    if not res.get("success"):
        raise RuntimeError(f"{name}: no success: {json.dumps(res)[:300]}")
    return out.get("data")

def attempt(args, i):
    tag = f"trellis{i}"
    print(f"--- attempt {i}: {args.input} ---", flush=True)
    up = upload(args.input)
    print("uploaded:", up, flush=True)
    pre = run_step("preprocess", 0, [{"path": up}], tag + "pre")
    pre_path = pre[0]["path"]
    print("preprocessed:", pre_path, flush=True)
    # Parameter order verified against /gradio_api/info (2026-10-18):
    # image, seed, resolution, ss_*, shape_slat_*, tex_slat_*,
    # manual_fov, fov_unit, session_id. Values = the space's own defaults
    # as used by the proven anonymous chain.
    gen_data = [{"path": pre_path}, args.seed, args.resolution,
                7.5, 0.7, 12, 5.0,
                7.5, 0.5, 12, 3.0,
                1.0, 0.0, 12, 3.0,
                -1.0, "deg", ""]
    gen = run_step("generate_3d", 1, gen_data, tag + "gen")
    state = gen[0]
    state_path = state.get("state_path") if isinstance(state, dict) else None
    print("state:", json.dumps(state)[:200], flush=True)
    if not state_path:
        raise RuntimeError("generate_3d returned no state_path")
    glb = run_step("extract_glb", 2, [state_path, args.faces, args.texture, ""], tag + "glb")
    glb_path = glb[0]["path"]
    url = glb[0].get("url") or f"{BASE}/gradio_api/file={glb_path}"
    dest = os.path.join(args.outdir, f"{args.name}-pixal3d.glb")
    with S.get(url, headers=HEADERS, stream=True, timeout=900) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1 << 16):
                f.write(chunk)
    print("DOWNLOADED", dest, os.path.getsize(dest), "bytes", flush=True)
    return dest

def main():
    ap = argparse.ArgumentParser(description="Pixal3D/TRELLIS.2 chain (token via HF_TOKEN env)")
    ap.add_argument("--input", required=True, help="staged input image (see 3d-inputs/)")
    ap.add_argument("--name", required=True, help="output basename, e.g. guard-male")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--resolution", type=int, default=1024)
    ap.add_argument("--faces", type=int, default=100000, help="extract decimation target")
    ap.add_argument("--texture", type=int, default=2048)
    ap.add_argument("--attempts", type=int, default=4)
    ap.add_argument("--outdir", default=os.path.dirname(os.path.abspath(__file__)) + "/runs")
    args = ap.parse_args()
    if not TOKEN:
        print("WARNING: HF_TOKEN is not set — running anonymously. The space's "
              "anonymous ZeroGPU quota rejected generate_3d on all 10 prior "
              "attempts; expect the same. Set HF_TOKEN and re-run.", flush=True)
    os.makedirs(args.outdir, exist_ok=True)
    for i in range(1, args.attempts + 1):
        try:
            dest = attempt(args, i)
            print("CHAIN SUCCESS:", dest)
            return 0
        except Exception as e:
            print(f"attempt {i} failed: {e}", flush=True)
            if "ZeroGPU quota" in str(e) and not TOKEN:
                print("Quota wall with no token — further anonymous attempts "
                      "will not help. Stopping.")
                return 2
            time.sleep(45)
    print("CHAIN EXHAUSTED")
    return 1

if __name__ == "__main__":
    sys.exit(main())
