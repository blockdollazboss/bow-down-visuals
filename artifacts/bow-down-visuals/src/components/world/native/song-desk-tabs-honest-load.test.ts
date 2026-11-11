/**
 * SongDeskTabs — honest load standard (deep-pins tranche 3, batch 5).
 * The Song Desk's other tabs: Inspo bench, Mashup bench, Hum bench.
 *
 * ONE DEFECT was fixed in this tranche and is pinned below
 * (red-before proven): SongMashupBench swallowed its library load
 * failure into setSongs([]) — the seam (fetchLibrarySongs) throws on
 * failure BY DESIGN, its header recording "callers show an honest
 * error state, never a fake empty library" — so a failed read
 * rendered the "A mashup needs two songs in your library — make or
 * upload songs first" copy, telling a member WITH a full library to
 * go make songs. The bench now flags songsFailed, renders a failure
 * line with a retry that re-runs the real load, and only a
 * successful read can reach the fewer-than-two copy. Two new locale
 * keys (worldAudioDesk.mashupLoadFailed / mashupRetry) carry English
 * verbatim in the other nine catalogs per the honesty rule.
 *
 * The rest pins as-is:
 * - SongInspoBench's presets read is the page's own documented
 *   nice-to-have pattern (its comment mirrors InspoTab's); analyze
 *   throws on non-ok AND on a DNA-less body; generate treats a null
 *   generate result as "didn't start" — an error, never a success.
 *   Its savePreset is best-effort BY THE PAGE'S OWN DESIGN ("as the
 *   page treats it") — no success is claimed anywhere for it (no
 *   toast, no note), the preset simply doesn't appear; pinned as
 *   that documented exception.
 * - SongHumBench has no collection load (a file intake); analyze and
 *   generate both throw on non-ok and on a parse-less body before
 *   any result state.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SongDeskTabs.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

describe("SongMashupBench — a failed library read is a failure line, never 'go make songs' (the fix)", () => {
  it("the loader flags the failure instead of folding it into an empty list", () => {
    const loader = slice(src, "export function SongMashupBench(", "const run = async () => {");
    expect(loader).toContain("const list = await fetchLibrarySongs(getAccessToken);");
    expect(loader).toContain("setSongsFailed(false);");
    expect(loader).toContain("if (!cancelled) setSongsFailed(true);");
    expect(loader).not.toContain("setSongs([])");
    expect(loader).toContain("}, [songTick]);");
  });

  it("render order is loading → failed (with retry) → fewer-than-two → the bench", () => {
    const loadAt = src.indexOf("{songs === null ? (");
    const failAt = src.indexOf('data-testid="world-song-mashup-load-error"');
    const fewAt = src.indexOf(") : songs.length < 2 ? (");
    expect(loadAt).toBeGreaterThan(-1);
    expect(failAt).toBeGreaterThan(loadAt);
    expect(fewAt).toBeGreaterThan(failAt);
    const failBlock = src.slice(failAt, fewAt);
    expect(failBlock).toContain('t("worldAudioDesk.mashupLoadFailed")');
    expect(failBlock).toContain("setSongs(null); setSongTick((n) => n + 1);");
    expect(failBlock).toContain('t("worldAudioDesk.mashupRetry")');
  });

  it("the mashup run throws on non-ok and on an audio-less body before the result", () => {
    const body = slice(src, "const run = async () => {", "const songOptions =");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldAudioDesk.mashupDidntLand")));');
    expect(body).toContain("const parsed = mashupResultOfResponse(data);");
    expect(body).toContain('if (!parsed) throw new Error(t("worldAudioDesk.mashupNoAudio"));');
    expect(body.indexOf("setResult(parsed)")).toBeGreaterThan(body.indexOf("if (!parsed) throw"));
  });

  it.each(LOCALES)("%s carries the two new mashup-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../../../locales/${loc}.json`)));
    for (const k of ["worldAudioDesk.mashupLoadFailed", "worldAudioDesk.mashupRetry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});

describe("SongInspoBench — presets are the documented nice-to-have; the paid path is strict", () => {
  it("analyze throws on non-ok and on a DNA-less body before setDna", () => {
    const body = slice(src, "const analyze = async () => {", "const generate = async () => {");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldAudioDesk.inspoAnalyzeFailed")));');
    expect(body).toContain("const parsed = styleDnaOfResponse(data);");
    expect(body).toContain('if (!parsed) throw new Error(t("worldAudioDesk.inspoNoStyle"));');
    expect(body.indexOf("setDna(parsed)")).toBeGreaterThan(body.indexOf("if (!parsed) throw"));
  });

  it("generate treats a null generate result as an error, never a success", () => {
    const body = slice(src, "const generate = async () => {", "const savePreset = async () => {");
    expect(body).toContain('if (!result) throw new Error(t("worldAudioDesk.inspoDidntStart"));');
    expect(body.indexOf("setRawResult(result.rawResult)")).toBeGreaterThan(body.indexOf("if (!result) throw"));
  });

  it("savePreset is best-effort by the page's own design and claims no success anywhere", () => {
    const body = slice(src, "const savePreset = async () => {", "const dnaText =");
    expect(body).toContain("if (res.ok && data.preset) {");
    expect(body).toContain("/* best-effort, as the page treats it */");
    expect(body).not.toContain("toast");
  });
});

describe("SongHumBench — no collection load; both calls strict", () => {
  /* Sliced within the bench's own section: SongInspoBench above it
     declares analyze/generate with the same names. */
  const humSrc = src.slice(src.indexOf("export function SongHumBench"));

  it("analyze throws on non-ok and on an incomplete body before state", () => {
    const body = slice(humSrc, "const analyze = async () => {", "const generate = async () => {");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldAudioDesk.humAnalyzeAudioFailed")));');
    expect(body).toContain("const parsed = humAnalysisOfResponse(data);");
    expect(body).toContain('if (!parsed) throw new Error(t("worldAudioDesk.analysisIncomplete"));');
    expect(body.indexOf("setAnalysis(parsed.analysis)")).toBeGreaterThan(body.indexOf("if (!parsed) throw"));
  });

  it("generate throws on non-ok and on a url-less body before the player", () => {
    const body = slice(humSrc, "const generate = async () => {", "\n  return (\n    <div data-testid=\"world-song-hum-bench\"");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldAudioDesk.humSongFailed")));');
    expect(body).toContain("const url = humSongUrlOfResponse(data);");
    expect(body).toContain('if (!url) throw new Error(t("worldAudioDesk.humNoAudioPlay"));');
    expect(body.indexOf("setSongUrl(url)")).toBeGreaterThan(body.indexOf("if (!url) throw"));
  });
});
