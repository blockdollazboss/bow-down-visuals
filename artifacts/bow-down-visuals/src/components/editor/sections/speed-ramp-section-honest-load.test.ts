/**
 * SpeedRampSection — honest load standard (deep-pins tranche 4,
 * batch B). The presets read is a documented enhancement (its
 * catch is marked non-fatal): presets start empty, both preset
 * grids show their "Loading presets…" / "Loading ramps…" line
 * while empty, and a failed read can never invent a preset —
 * applying is gated on activePreset, which exists only when a
 * loaded preset was picked, and the Apply bar renders only for
 * one. The two paid runs mirror each other: slow-mo (300 VB) and
 * preset/ramp (150 VB) each return silently on a decline, land
 * any non-ok or url-less answer in the error line with the
 * no-Bucs-spent copy, and set the result (then the success
 * toast) only after that check — so no render is ever presented
 * that the rail did not confirm. There is no separate 402 panel:
 * an out-of-credits answer travels the same non-ok path into the
 * server's own words.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SpeedRampSection.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("presets — documented enhancement; apply stays gated on a loaded preset", () => {
  it("presets land only from an ok answer; a failed read is non-fatal and invents nothing", () => {
    const body = slice(src, "const loadPresets = useCallback(async () => {", "useEffect(() => {\n    void loadPresets();");
    expect(body).toContain("if (res?.ok) {");
    expect(body.indexOf("setPresets(data.presets ?? []);")).toBeGreaterThan(body.indexOf("if (res?.ok) {"));
    expect(body).toContain("/* non-fatal */");
    expect(src).toContain("Loading presets…");
    expect(src).toContain("Loading ramps…");
  });

  it("no preset can be applied until a loaded one is picked", () => {
    expect(src).toContain("const activePreset = presets.find((p) => p.key === presetKey) ?? null;");
    const body = slice(src, "async function handleApplyPreset() {", "/* ── Handoff:");
    expect(body).toContain("if (!activePreset || !activeScene?.demoClipUrl || working) return;");
    expect(src).toContain("{activePreset && (");
  });
});

describe("paid runs — decline returns; the result and toast sit behind the ok+url check", () => {
  it("slow-mo: non-ok or url-less lands in the no-spend error, never a result", () => {
    const body = slice(src, "async function handleSlowMotion(factor: 2 | 4 | 8) {", "/* ── 2+3.");
    expect(body).toContain("if (res === null) return; // user cancelled the credit confirm");
    expect(body).toContain("if (!res.ok || !data.url) {");
    expect(body).toContain('setError(apiErrorMessage(data, "Slow motion failed — no Visual Bucs were spent."));');
    expect(body.indexOf("setResult({ kind: \"slowmo\"")).toBeGreaterThan(body.indexOf("if (!res.ok || !data.url) {"));
    expect(body.indexOf('title: "Slow-mo rendered"')).toBeGreaterThan(body.indexOf("setResult({ kind: \"slowmo\""));
  });

  it("preset/ramp: the same shape, with its own no-spend copy", () => {
    const body = slice(src, "async function handleApplyPreset() {", "/* ── Handoff:");
    expect(body).toContain("if (res === null) return; // user cancelled the credit confirm");
    expect(body).toContain("if (!res.ok || !data.url) {");
    expect(body).toContain('setError(apiErrorMessage(data, "Speed change failed — no Visual Bucs were spent."));');
    expect(body.indexOf("setResult({ kind: \"preset\"")).toBeGreaterThan(body.indexOf("if (!res.ok || !data.url) {"));
  });
});
