/**
 * PhotoCanvasEditor — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 3). The editor's one collection load
 * is the member's saved PRESETS; everything else is a write whose
 * answer is checked. This pin records the machines:
 *
 * - PRESETS LOAD: a non-ok (or declined-rail null) answer throws
 *   into presetsFailed; the failed render is the "Couldn't load
 *   your presets" line with a retry wired to the real loader
 *   (btn-retry-presets). The genuine "No presets saved yet" line is
 *   reachable only when presetsFailed is false — the render is a
 *   ternary, so a failure can never fall through to the empty copy.
 *   (The loader's own comment records the standard it was written
 *   to: "A failed load is NOT 'No presets saved yet'.")
 * - WRITES: save preset / save draft / load draft / server export /
 *   batch all throw on a non-ok (or null confirmed) answer into a
 *   toast, and the success toast fires only after the ok check —
 *   loadDraft additionally refuses a draft-less or unparseable
 *   answer instead of swapping the canvas to nothing.
 * - LAYER SET: a layer whose photo never loaded is marked unrendered
 *   in the manifest and named in a "some layers missing" toast —
 *   never shipped as a blank file presented as the layer.
 *
 * NO FIX in this lane — the editor already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const ed = read("./PhotoCanvasEditor.tsx");

describe("presets: a failed load is the failure line + retry, never 'no presets yet'", () => {
  it("the loader throws on non-ok into presetsFailed; success records and clears it", () => {
    const loader = ed.slice(ed.indexOf("const loadPresets = useCallback(async () => {"), ed.indexOf("async function savePreset()"));
    expect(loader).toContain('if (!res?.ok) throw new Error("presets load failed");');
    expect(loader).toContain("setPresetsFailed(false);");
    expect(loader).toContain("setPresetsFailed(true);");
    expect(loader).toContain('A failed load is NOT "No presets saved yet"');
  });

  it("the render is a ternary: failure branch first, empty line only in the success arm", () => {
    expect(ed).toContain("{presetsFailed ? (");
    expect(ed).toContain("Couldn't load your presets.");
    expect(ed).toContain('data-testid="btn-retry-presets"');
    expect(ed).toContain("onClick={() => void loadPresets()}");
    expect(ed).toContain(") : presets.length === 0 && <p className=\"text-xs text-white/35\">No presets saved yet.</p>}");
    expect(ed.indexOf("{presetsFailed ? (")).toBeLessThan(ed.indexOf("No presets saved yet."));
  });
});

describe("the writes check their answers", () => {
  it("save preset / drafts: success is claimed only after the ok check", () => {
    const save = ed.slice(ed.indexOf("async function savePreset()"), ed.indexOf("function applyPreset("));
    expect(save).toContain('if (!res?.ok) throw new Error("Could not save the preset.");');
    expect(save.indexOf("if (!res?.ok) throw")).toBeLessThan(save.indexOf('toast({ title: "Preset saved" })'));
    const draftStart = ed.indexOf("async function saveDraft()");
    const draft = ed.slice(draftStart, ed.indexOf("\n  return (", draftStart));
    expect(draft).toContain('if (!res?.ok) throw new Error("Draft save failed.");');
    expect(draft).toContain('if (!res?.ok) throw new Error("No draft found.");');
    expect(draft).toContain('if (!loaded) throw new Error("No photo canvas draft saved yet.");');
    expect(draft.indexOf("if (!loaded) throw")).toBeLessThan(draft.indexOf("setDoc(loaded);"));
  });

  it("server export + batch throw on non-ok into their failure toasts", () => {
    expect(ed).toContain('if (!res?.ok) throw new Error("Server export failed.");');
    expect(ed).toContain('if (!res?.ok) throw new Error("Batch failed.");');
    expect(ed).toContain('toast({ title: "Server export failed"');
    expect(ed).toContain('toast({ title: "Batch look-sync failed"');
  });

  it("per-output failures render as failures, never as downloads", () => {
    expect(ed).toContain('`${o.specId} — failed: ${plainErrorText(o.error, "render failed")}`');
    expect(ed).toContain('`${r.imageUrl} — failed: ${plainErrorText(r.error, "render failed")}`');
  });

  it("the layer set names unrendered layers instead of shipping blanks", () => {
    expect(ed).toContain("if (!drawn.includes(layer.id)) return Promise.resolve(null); // photo not loaded — never ship a blank layer file");
    expect(ed).toContain("const failed = manifest.layers.filter((l) => !l.rendered);");
    expect(ed).toContain('title: "Layer set downloaded — some layers missing"');
  });
});
