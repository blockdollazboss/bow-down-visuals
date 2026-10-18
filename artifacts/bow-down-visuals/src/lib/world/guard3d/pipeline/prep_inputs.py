#!/usr/bin/env python3
"""prep_inputs.py — stage the image-to-3D generation inputs in
~/workspace/world-palace/3d-inputs/ from the APPROVED art only.

Extraction / matting / compositing ONLY — no regeneration, no character
edits (character-lock law). Sources:
  - Guards: the approved light-grey sheets in ~/workspace/imagine_media/
    + the pipeline's own approved transparent mattes in the 3D worktree
    (public/world/default-character{,-female}.png).
  - King: panel crops of the approved character reference sheet
    (media-generation-shark-king-character-sheet-0-*.png, 1920x1280).
    Panel borders are detected from the sheet's gold grid lines, not
    guessed.
Idempotent: re-running rebuilds every staged file from source.
"""
import os, shutil, sys
from PIL import Image

HOME = os.path.expanduser("~")
MEDIA = os.path.join(HOME, "workspace/imagine_media")
WT_PUBLIC = os.path.join(HOME, "workspace/bdv-wt-3d/artifacts/bow-down-visuals/public/world")
OUT = os.path.join(HOME, "workspace/world-palace/3d-inputs")
os.makedirs(OUT, exist_ok=True)

MALE_SHEET = os.path.join(MEDIA, "media-generation-king-shark-guard-default-0-b5c12e20-efb2-48c5-a0f7-bab918fc8269.webp")
FEMALE_SHEET = os.path.join(MEDIA, "media-generation-king-shark-guard-female-defaul-0-40588a64-4ffd-40b1-87df-a47b42006034.webp")
KING_SHEET = os.path.join(MEDIA, "media-generation-shark-king-character-sheet-0-44eb68e9-46bc-48c4-92aa-c0d0984ae1ca.png")

def save(img, name):
    p = os.path.join(OUT, name)
    img.save(p)
    print(f"{name}: {img.size[0]}x{img.size[1]} {img.mode} {os.path.getsize(p)} bytes")
    return p

def on_white(rgba):
    bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    bg.alpha_composite(rgba)
    return bg.convert("RGB")

# ── Guards: approved pipeline mattes (primary) + as-shot sheets ──────
for tag, matte_name, sheet in (
    ("male", "default-character.png", MALE_SHEET),
    ("female", "default-character-female.png", FEMALE_SHEET),
):
    matte = Image.open(os.path.join(WT_PUBLIC, matte_name)).convert("RGBA")
    save(matte, f"guard-{tag}-front.png")                 # transparent, primary input
    save(on_white(matte), f"guard-{tag}-front-white.png") # white-bg variant
    save(Image.open(sheet).convert("RGB"), f"guard-{tag}-sheet.png")  # as-shot, light grey

# ── King: crop the view panels off the reference sheet ──────────────
# Panel grid of the 1920x1280 sheet, read off the sheet's gold borders and
# VERIFIED VISUALLY 2026-10-18 (an automated gold-line detector found the
# antique-gold lines too muted to threshold reliably, so the grid below is
# the hand-verified layout; all three crops were eyeballed clean — full
# figure, no panel titles, no border lines).
sheet = Image.open(KING_SHEET).convert("RGB")
x0, x1, x2, x3, x4 = 75, 655, 1175, 1245, 1845
y0, y1, y2 = 128, 478, 858

# Panel 1 — FRONT full-body turnaround (the King's primary input).
# Crop inside the gold border, below the panel title.
save(sheet.crop((x0 + 6, y0 + 46, x1 - 4, y2 - 5)), "king-front.png")

# Optional: matte the King crop (rembg/u2net, run inside hunyuan-run/.venv).
# The stylized art carries a painted ground shadow; u2net keeps it as a
# soft halo, so the alpha is hardened (kill <70, ramp to full at 235).
# A faint shadow remnant between the legs survives — documented in
# 3d-inputs/README.md; Pixal3D's preprocess re-segments regardless, and
# king-front.png stays staged as the as-shot alternate.
try:
    import numpy as np
    from rembg import remove, new_session
    king = Image.open(os.path.join(OUT, "king-front.png")).convert("RGB")
    matted = remove(king, session=new_session("u2net")).convert("RGBA")
    arr = np.array(matted)
    a = arr[..., 3].astype(np.float32)
    arr[..., 3] = np.clip((a - 70) * 255.0 / (235 - 70), 0, 255).astype(np.uint8)
    save(Image.fromarray(arr, "RGBA"), "king-front-matted.png")
except Exception as e:
    print(f"king matte skipped ({e.__class__.__name__}: {e}) — king-front.png still staged")
# Panel 3 — SIDE PROFILE (bust only in the art — reference, not a body input).
save(sheet.crop((x3 + 6, y0 + 46, x4 - 4, y1 - 5)), "king-side-bust.png")
# Panel 4 — BACK VIEW (bust only — reference).
save(sheet.crop((x1 + 6, y1 + 40, x2 - 4, y2 - 5)), "king-back-bust.png")
print("done ->", OUT)
