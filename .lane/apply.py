#!/usr/bin/env python3
"""Apply a wave's translations to a catalog.
Reads work/<loc>-<wave>.translations.json {flatkey: value} and work/<loc>-<wave>.allowlist.json [flatkeys].
Verifies coverage, placeholder parity, no U+FFFD; merges in en order; writes byte-style catalog."""
import json, sys, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from waves import WAVES
BASE = os.path.dirname(os.path.abspath(__file__))
LOC_DIR = os.path.join(BASE, "..", "artifacts/bow-down-visuals/src/locales")
def flat(o, p="", out=None):
    out = out if out is not None else {}
    if isinstance(o, dict):
        for k, v in o.items(): flat(v, f"{p}.{k}" if p else k, out)
    else: out[p] = o
    return out
def ph(v):
    s = "\n".join(v) if isinstance(v, list) else str(v)
    return sorted(re.findall(r"\{\{[^}]+\}\}", s))
def set_path(root, parts, value):
    node = root
    for p in parts[:-1]:
        if p not in node or not isinstance(node[p], dict): node[p] = {}
        node = node[p]
    node[parts[-1]] = value
def main():
    loc, wave = sys.argv[1], sys.argv[2]
    ns = set(WAVES[(loc, wave)])
    work = json.load(open(os.path.join(BASE, "work", f"{loc}-{wave}.json")))
    trans = {}
    tj = os.path.join(BASE, "work", f"{loc}-{wave}.translations.json")
    if os.path.exists(tj): trans.update(json.load(open(tj)))
    jl = os.path.join(BASE, "work", f"{loc}-{wave}.translations.jsonl")
    if os.path.exists(jl):
        for line in open(jl):
            line = line.strip()
            if line: trans.update(json.loads(line))
    allow = set(json.load(open(os.path.join(BASE, "work", f"{loc}-{wave}.allowlist.json"))))
    en = flat(json.load(open(os.path.join(LOC_DIR, "en.json"))))
    missing, identical = work["missing"], work["identical"]
    errors = []
    for k in missing:
        if k not in trans: errors.append(f"missing key untranslated: {k}")
    for k in identical:
        if k not in trans and k not in allow: errors.append(f"identical key neither translated nor allowlisted: {k}")
    for k in allow:
        if k not in identical and k not in missing: errors.append(f"STALE allowlist entry (not a work key): {k}")
        if k in identical and k in trans: errors.append(f"identical key both translated and allowlisted: {k}")
        if k in missing and k in trans and trans[k] != missing[k]: errors.append(f"missing allowlisted key translated to a different value: {k}")
    for k, v in trans.items():
        if k not in missing and k not in identical: errors.append(f"translation for non-work key: {k}")
        if k.split(".")[0] not in ns: errors.append(f"translation outside wave namespaces: {k}")
        if "\ufffd" in json.dumps(v, ensure_ascii=False): errors.append(f"U+FFFD in translation: {k}")
        if k in en and ph(v) != ph(en[k]): errors.append(f"placeholder mismatch: {k}: {ph(v)} vs en {ph(en[k])}")
        if isinstance(v, str) and v.strip() == "": errors.append(f"empty translation: {k}")
    if errors:
        print("APPLY ABORTED:"); [print(" -", e) for e in errors[:40]]; sys.exit(1)
    cat = json.load(open(os.path.join(LOC_DIR, f"{loc}.json")))
    # apply in en order so appended keys/namespaces land in en order at parent ends
    for k in en:
        if k in trans: set_path(cat, k.split("."), trans[k])
    raw = json.dumps(cat, ensure_ascii=False, indent=2) + "\n"
    assert "\ufffd" not in raw, "U+FFFD in output catalog"
    open(os.path.join(LOC_DIR, f"{loc}.json"), "w").write(raw)
    # post-verify from disk
    cat2 = flat(json.load(open(os.path.join(LOC_DIR, f"{loc}.json"))))
    left_m = [k for k in missing if k not in cat2]
    left_i = [k for k in identical if k not in allow and cat2.get(k) == en[k]]
    print(f"{loc}-{wave} applied: translated={len(trans)} allowlisted={len(allow)}; post-check missing-left={len(left_m)} identical-left={len(left_i)}")
    if left_m or left_i: print("LEFTOVERS:", left_m[:5], left_i[:5]); sys.exit(1)
if __name__ == "__main__": main()
