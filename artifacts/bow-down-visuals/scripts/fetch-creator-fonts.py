#!/usr/bin/env python3
"""Fetch + license-verify the creator font library (self-hosted woff2).

Every family must be verifiable in the google/fonts GitHub repo: a family
living under ofl/ is SIL OFL 1.1, under apache/ is Apache-2.0. Families that
cannot be verified in either tree are DROPPED (printed, not downloaded).

Downloads the latin subset woff2 from Google Fonts (fonts.gstatic.com) into
public/fonts/creator/ and writes public/fonts/creator-fonts.css plus a
machine-readable manifest at scripts/creator-fonts-manifest.json.
"""
import json, re, sys, urllib.request, pathlib

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "fonts" / "creator"
OUT.mkdir(parents=True, exist_ok=True)

# slug candidates: (family display name, repo slug, css2 family param, weights, category)
FONTS = [
    ("Cinzel", "cinzel", "Cinzel", "400;700;900", "House"),
    ("Manrope", "manrope", "Manrope", "400;600;800", "House"),
    ("Playfair Display", "playfairdisplay", "Playfair+Display", "400;700;900", "Royal Serifs"),
    ("Cormorant Garamond", "cormorantgaramond", "Cormorant+Garamond", "400;600;700", "Royal Serifs"),
    ("Marcellus", "marcellus", "Marcellus", "400", "Royal Serifs"),
    ("Bodoni Moda", "bodonimoda", "Bodoni+Moda", "400;700;900", "Royal Serifs"),
    ("Cinzel Decorative", "cinzeldecorative", "Cinzel+Decorative", "400;700;900", "Royal Serifs"),
    ("Fraunces", "fraunces", "Fraunces", "400;700;900", "Royal Serifs"),
    ("Libre Baskerville", "librebaskerville", "Libre+Baskerville", "400;700", "Royal Serifs"),
    ("EB Garamond", "ebgaramond", "EB+Garamond", "400;600;700", "Royal Serifs"),
    ("Lora", "lora", "Lora", "400;600;700", "Royal Serifs"),
    ("DM Serif Display", "dmserifdisplay", "DM+Serif+Display", "400", "Royal Serifs"),
    ("Abril Fatface", "abrilfatface", "Abril+Fatface", "400", "Royal Serifs"),
    ("Inter", "inter", "Inter", "400;600;800", "Strong Sans"),
    ("Montserrat", "montserrat", "Montserrat", "400;700;900", "Strong Sans"),
    ("Poppins", "poppins", "Poppins", "400;700;800", "Strong Sans"),
    ("Space Grotesk", "spacegrotesk", "Space+Grotesk", "400;600;700", "Strong Sans"),
    ("DM Sans", "dmsans", "DM+Sans", "400;700", "Strong Sans"),
    ("Work Sans", "worksans", "Work+Sans", "400;600;800", "Strong Sans"),
    ("Outfit", "outfit", "Outfit", "400;700;900", "Strong Sans"),
    ("Sora", "sora", "Sora", "400;700", "Strong Sans"),
    ("Plus Jakarta Sans", "plusjakartasans", "Plus+Jakarta+Sans", "400;700;800", "Strong Sans"),
    ("Bebas Neue", "bebasneue", "Bebas+Neue", "400", "Condensed Poster"),
    ("Oswald", "oswald", "Oswald", "400;600;700", "Condensed Poster"),
    ("Barlow Condensed", "barlowcondensed", "Barlow+Condensed", "600;700", "Condensed Poster"),
    ("Fjalla One", "fjallaone", "Fjalla+One", "400", "Condensed Poster"),
    ("Archivo Narrow", "archivonarrow", "Archivo+Narrow", "400;700", "Condensed Poster"),
    ("Staatliches", "staatliches", "Staatliches", "400", "Condensed Poster"),
    ("Anton", "anton", "Anton", "400", "Bold Display"),
    ("Archivo Black", "archivoblack", "Archivo+Black", "400", "Bold Display"),
    ("Alfa Slab One", "alfaslabone", "Alfa+Slab+One", "400", "Bold Display"),
    ("Titan One", "titanone", "Titan+One", "400", "Bold Display"),
    ("Bungee", "bungee", "Bungee", "400", "Bold Display"),
    ("Righteous", "righteous", "Righteous", "400", "Bold Display"),
    ("Luckiest Guy", "luckiestguy", "Luckiest+Guy", "400", "Bold Display"),
    ("Rubik Mono One", "rubikmonoone", "Rubik+Mono+One", "400", "Bold Display"),
    ("Monoton", "monoton", "Monoton", "400", "Bold Display"),
    ("Fascinate Inline", "fascinateinline", "Fascinate+Inline", "400", "Bold Display"),
    ("Wallpoet", "wallpoet", "Wallpoet", "400", "Bold Display"),
    ("Black Ops One", "blackopsone", "Black+Ops+One", "400", "Bold Display"),
    ("Creepster", "creepster", "Creepster", "400", "Bold Display"),
    ("Bowlby One", "bowlbyone", "Bowlby+One", "400", "Bold Display"),
    ("Russo One", "russoone", "Russo+One", "400", "Bold Display"),
    ("Permanent Marker", "permanentmarker", "Permanent+Marker", "400", "Handwritten"),
    ("Caveat", "caveat", "Caveat", "400;700", "Handwritten"),
    ("Shadows Into Light", "shadowsintolight", "Shadows+Into+Light", "400", "Handwritten"),
    ("Gochi Hand", "gochihand", "Gochi+Hand", "400", "Handwritten"),
    ("Rock Salt", "rocksalt", "Rock+Salt", "400", "Handwritten"),
    ("Kalam", "kalam", "Kalam", "400;700", "Handwritten"),
    ("Patrick Hand", "patrickhand", "Patrick+Hand", "400", "Handwritten"),
    ("Architects Daughter", "architectsdaughter", "Architects+Daughter", "400", "Handwritten"),
    ("Satisfy", "satisfy", "Satisfy", "400", "Scripts"),
    ("Great Vibes", "greatvibes", "Great+Vibes", "400", "Scripts"),
    ("Dancing Script", "dancingscript", "Dancing+Script", "400;700", "Scripts"),
    ("Pacifico", "pacifico", "Pacifico", "400", "Scripts"),
    ("Lobster", "lobster", "Lobster", "400", "Scripts"),
    ("Allura", "allura", "Allura", "400", "Scripts"),
    ("Sacramento", "sacramento", "Sacramento", "400", "Scripts"),
    ("Alex Brush", "alexbrush", "Alex+Brush", "400", "Scripts"),
    ("Press Start 2P", "pressstart2p", "Press+Start+2P", "400", "Pixel"),
    ("Silkscreen", "silkscreen", "Silkscreen", "400;700", "Pixel"),
    ("VT323", "vt323", "VT323", "400", "Pixel"),
    ("DotGothic16", "dotgothic16", "DotGothic16", "400", "Pixel"),
    ("Pixelify Sans", "pixelifysans", "Pixelify+Sans", "400;700", "Pixel"),
]

import subprocess
def fetch(url):
    # curl rides the VM egress proxy reliably; urllib did not.
    for attempt in range(3):
        p = subprocess.run(["curl", "-s", "-m", "30", "-A", UA["User-Agent"], "-w", "\n%{http_code}", url],
                           capture_output=True)
        if p.returncode == 0:
            body, _, code = p.stdout.rpartition(b"\n")
            if int(code or 0) == 200:
                return 200, body
    raise RuntimeError(f"fetch failed: {url}")

def verify_license(slug):
    for tree, lic in (("ofl", "OFL-1.1"), ("apache", "Apache-2.0"), ("ufl", "UFL-1.0")):
        try:
            status, _ = fetch(f"https://raw.githubusercontent.com/google/fonts/main/{tree}/{slug}/METADATA.pb")
            if status == 200:
                return lic
        except Exception:
            pass
    return None

def latin_blocks(css):
    """Return list of (weight, url) for latin (not latin-ext) @font-face blocks."""
    out = []
    for block in css.split("@font-face")[1:]:
        if "/* latin */" not in css.split(block)[0][-30:] and False:
            pass
        m_url = re.search(r"url\((https://[^)]+\.woff2)\)", block)
        m_w = re.search(r"font-weight:\s*([\d ]+);", block)
        if m_url and m_w:
            out.append((m_w.group(1).strip(), m_url.group(1), block))
    return out

results, dropped, css_lines = [], [], []
for family, slug, api, weights, category in FONTS:
    lic = verify_license(slug)
    if not lic:
        dropped.append(family)
        print(f"DROP (license unverified): {family}")
        continue
    # pixel fonts already self-hosted at public/fonts/<file>; still download unified copies
    try:
        _, cssb = fetch(f"https://fonts.googleapis.com/css2?family={api}:wght@{weights}&display=swap")
        css = cssb.decode()
    except Exception as e:
        dropped.append(family); print(f"DROP (css fetch failed): {family}: {e}"); continue
    # split into commented blocks: /* subset */ precedes each @font-face
    parts = re.split(r"/\* ([a-z-]+) \*/", css)
    faces = []  # (subset, weight, url)
    for i in range(1, len(parts) - 1, 2):
        subset, body = parts[i], parts[i + 1]
        m_url = re.search(r"url\((https://[^)]+\.woff2)\)", body)
        m_w = re.search(r"font-weight:\s*([\d ]+);", body)
        if m_url and m_w:
            faces.append((subset, m_w.group(1).strip(), m_url.group(1)))
    latin = [f for f in faces if f[0] == "latin"] or faces[:1]
    if not latin:
        dropped.append(family); print(f"DROP (no latin face): {family}"); continue
    files = []
    for subset, weight, url in latin:
        wlabel = weight.replace(" ", "-")
        fname = f"{slug}-{wlabel}.woff2"
        dest = OUT / fname
        if not dest.exists():
            _, data = fetch(url)
            dest.write_bytes(data)
        files.append({"file": fname, "weight": weight})
        css_lines.append(
            f"@font-face{{font-family:'{family}';font-style:normal;font-weight:{weight};font-display:swap;src:url('/fonts/creator/{fname}') format('woff2');}}"
        )
    results.append({"family": family, "slug": slug, "apiName": api, "weights": weights,
                    "category": category, "license": lic, "files": files})
    print(f"OK {family} [{lic}] {len(files)} file(s)", flush=True)
    # bank incrementally so a network hiccup never loses verified progress
    (ROOT / "public" / "fonts" / "creator-fonts.css").write_text("\n".join(css_lines) + "\n")
    (ROOT / "scripts" / "creator-fonts-manifest.json").write_text(json.dumps({"fonts": results, "dropped": dropped}, indent=1))

(ROOT / "public" / "fonts" / "creator-fonts.css").write_text("\n".join(css_lines) + "\n")
(ROOT / "scripts" / "creator-fonts-manifest.json").write_text(json.dumps({"fonts": results, "dropped": dropped}, indent=1))
print(f"\nVERIFIED: {len(results)}  DROPPED: {len(dropped)} {dropped}")
