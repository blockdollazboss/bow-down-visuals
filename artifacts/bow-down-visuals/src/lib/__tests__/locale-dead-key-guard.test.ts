/**
 * Dead locale-key guard (stack800 lane 3, item 7).
 *
 * videoExport.ffmpegStartedLabel sat in all 10 catalogs after the
 * fake-telemetry line it labelled was removed from the export
 * component — its only src reference was a test asserting the
 * component does NOT contain it. The key is removed everywhere; this
 * guard keeps the catalogs from accumulating the next one.
 *
 * The guard runs the shipped scanner (scripts/check-dead-locale-
 * keys.mjs — see its header for the reference rules and their
 * deliberate under-report bias) and compares the dead set for en
 * against the frozen ratchet (locale-dead-key-ratchet.json):
 *
 *  - a NEW dead key (in the scan, not in the ratchet) fails — wire
 *    the key up or don't add it;
 *  - a STALE ratchet entry (in the ratchet, not in the scan — the
 *    key got wired up or removed) fails — shrink the ratchet in the
 *    same commit. The ratchet may only ever shrink.
 *
 * The pre-existing 161 known-dead keys are frozen, not forgiven:
 * each is a real orphan a future cleanup can delete, shrinking the
 * ratchet as it goes.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];

function flatten(obj: Record<string, any>, prefix = "", out = new Set<string>()): Set<string> {
  for (const [k, v] of Object.entries(obj)) {
    const q = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, q, out);
    else out.add(q);
  }
  return out;
}

describe("the ffmpegStartedLabel orphan is gone from every catalog", () => {
  it("no catalog carries videoExport.ffmpegStartedLabel", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(flatten(cat).has("videoExport.ffmpegStartedLabel"), loc).toBe(false);
      expect(cat.videoExport, loc).toBeTruthy();
    }
  });
});

describe("dead-key ratchet — no new dead keys, ratchet only shrinks", () => {
  it("the scanner's dead set for en exactly equals the frozen ratchet", { timeout: 120_000 }, () => {
    const script = new URL("../../../scripts/check-dead-locale-keys.mjs", import.meta.url);
    const out = execFileSync(process.execPath, [script.pathname, "en"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const dead = JSON.parse(out) as string[];
    const ratchet = JSON.parse(read("./locale-dead-key-ratchet.json")) as string[];

    const newDead = dead.filter((k) => !ratchet.includes(k));
    const stale = ratchet.filter((k) => !dead.includes(k));
    expect(newDead, "new dead keys — wire them up or remove them").toEqual([]);
    expect(stale, "stale ratchet entries — shrink the ratchet").toEqual([]);
    expect(dead).toEqual([...ratchet].sort());
  });
});
