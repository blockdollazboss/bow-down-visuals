/**
 * InspoTab — honest load standard (deep-pins tranche 3, batch 4).
 * Inspo Mode: playlist vibe → style DNA → song.
 *
 * The My Vibes presets load renders the three honest states in
 * order — "Loading your vibes…" while in flight, then the genuine
 * empty ("No saved vibes yet…") only on a completed read, then the
 * chips. A failed read falls through to the empty copy — pinned
 * AS-IS as the family's documented nice-to-have pattern (the
 * loader's own comment: "presets are a nice-to-have — inspo still
 * works without them"): the tab's real work (analyze → generate)
 * never depends on the presets, and no success is claimed from the
 * read. Recorded here so tranche 4 can re-judge it deliberately
 * rather than by accident.
 *
 * ONE DEFECT was fixed in this tranche and is pinned below
 * (red-before proven): deletePreset removed the chip from the
 * screen after an UNCHECKED DELETE — a failed delete (the preset
 * still saved server-side) made the vibe vanish until reload. The
 * delete now checks res.ok before filtering, and a failure toasts
 * "Delete failed" with the chip left in place.
 *
 * The remaining writes pin as-is: analyze throws the server's words
 * on non-ok before the DNA card opens; the paid generate rides
 * callGenerateApi (decline → null → nothing runs; out_of_credits
 * routes to the parent's out-of-credits state); save preset throws
 * on non-ok before prepending and only toasts "Vibe saved" from a
 * returned preset.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./InspoTab.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("presets load — the documented nice-to-have pattern, states in order", () => {
  it("the loader records presets only from an ok, array-shaped body and always settles loading", () => {
    const loader = slice(src, "/* ── My Vibes presets ── */", "async function analyzeVibe()");
    expect(loader).toContain('fetch("/api/song-inspo/presets", { headers: await authHeaders() })');
    expect(loader).toContain("if (!res.ok) return;");
    expect(loader).toContain("if (Array.isArray(data.presets)) setPresets(data.presets);");
    expect(loader).toContain("presets are a nice-to-have — inspo still works without them");
    expect(loader).toContain("setPresetsLoading(false)");
  });

  it("render order is loading → empty → chips", () => {
    const loadAt = src.indexOf("Loading your vibes…");
    const emptyAt = src.indexOf("No saved vibes yet");
    const chipsAt = src.indexOf("presets.map((p)");
    expect(loadAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(loadAt);
    expect(chipsAt).toBeGreaterThan(emptyAt);
    expect(src).toContain("{presetsLoading ? (");
  });
});

describe("writes — checked before success", () => {
  it("delete preset: the chip leaves the screen only after an ok DELETE (the tranche-3 fix)", () => {
    const body = slice(src, "async function deletePreset(id: string) {", "function shareVibe()");
    expect(body).toContain("const res = await fetch(`/api/song-inspo/presets/${id}`, { method: \"DELETE\", headers: await authHeaders() });");
    expect(body).toContain('if (!res.ok) throw new Error("delete preset failed");');
    expect(body.indexOf("setPresets((p) => p.filter((x) => x.id !== id))")).toBeGreaterThan(
      body.indexOf("if (!res.ok) throw"),
    );
    expect(body).toContain('toast({ title: "Delete failed"');
    expect(body).not.toContain("best-effort");
  });

  it("analyze: non-ok throws the server's words before the DNA card opens", () => {
    const body = slice(src, "async function analyzeVibe() {", "async function generateFromDna()");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Vibe analysis failed."));');
    expect(body.indexOf("setDna({ ...EMPTY_DNA, ...(data.styleDna ?? {}) })")).toBeGreaterThan(
      body.indexOf("if (!res.ok) throw"),
    );
    expect(body).toContain("setAnalyzing(false)");
  });

  it("generate: a declined confirmation runs nothing; out-of-credits routes to the parent state", () => {
    const body = slice(src, "async function generateFromDna() {", "async function savePreset()");
    expect(body).toContain("if (!result) return; // user cancelled the credit confirmation");
    expect(body).toContain('if (msg === "out_of_credits") onOutOfCredits();');
    expect(body.indexOf("onGenerated({")).toBeGreaterThan(body.indexOf("if (!result) return"));
    expect(body).toContain("setGenerating(false)");
  });

  it("save preset: non-ok throws before prepending; the saved toast names the returned preset", () => {
    const body = slice(src, "async function savePreset() {", "async function deletePreset(");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Could not save preset."));');
    expect(body.indexOf("if (data.preset) setPresets((p) => [data.preset!, ...p])")).toBeGreaterThan(
      body.indexOf("if (!res.ok) throw"),
    );
    expect(body).toContain('toast({ title: "Vibe saved"');
    expect(body).toContain('toast({ title: "Save failed"');
  });
});
