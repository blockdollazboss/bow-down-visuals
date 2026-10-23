#!/usr/bin/env python3
"""Extract a wave's remaining work: missing keys + identical-to-en keys in the wave's namespaces."""
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from waves import WAVES
LOC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "artifacts/bow-down-visuals/src/locales")
def flat(o, p="", out=None):
    out = out if out is not None else {}
    if isinstance(o, dict):
        for k, v in o.items(): flat(v, f"{p}.{k}" if p else k, out)
    else: out[p] = o
    return out
def main():
    loc, wave = sys.argv[1], sys.argv[2]
    ns = WAVES[(loc, wave)]
    en = flat(json.load(open(os.path.join(LOC_DIR, "en.json"))))
    cat = flat(json.load(open(os.path.join(LOC_DIR, f"{loc}.json"))))
    missing, identical = {}, {}
    for k, v in en.items():
        if k.split(".")[0] not in ns: continue
        if k not in cat or cat[k] == "" or (isinstance(cat[k], list) and len(cat[k]) == 0): missing[k] = v
        elif cat[k] == v: identical[k] = v
    out = {"locale": loc, "wave": wave, "namespaces": ns, "missing": missing, "identical": identical}
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "work", f"{loc}-{wave}.json")
    json.dump(out, open(path, "w"), ensure_ascii=False, indent=1)
    from collections import Counter
    cm = Counter(k.split(".")[0] for k in missing); ci = Counter(k.split(".")[0] for k in identical)
    print(f"{loc}-{wave}: missing={len(missing)} identical={len(identical)} total={len(missing)+len(identical)}")
    for n in ns:
        if cm.get(n) or ci.get(n): print(f"  {n}: M={cm.get(n,0)} I={ci.get(n,0)}")
    print("work file:", path)
if __name__ == "__main__": main()
