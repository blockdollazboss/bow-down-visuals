/**
 * ColorGradeSection — honest load standard (deep-pins
 * tranche 5). PINNED POST-FIX. THE FIX (this tranche): the
 * preset load used to swallow non-ok and throws ("non-
 * fatal"), leaving presets=[] while the section rendered
 * "Loading presets…" whenever the list was empty — a failed
 * load spun forever. The load now tracks presetsLoading /
 * presetsFailed: render order is failed + Retry → loading →
 * a proven-empty line → the preset grid. The paid apply was
 * already honest: a cancelled confirmation returns silently
 * and the applied state is set only on res.ok with a url in
 * the body.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ColorGradeSection.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("THE FIX — the preset load can fail, finish, and be empty, distinctly", () => {
  it("non-ok and thrown reads set presetsFailed; only an ok read clears it; loading always settles", () => {
    expect(src).toContain("const [presetsLoading, setPresetsLoading] = useState(true);");
    expect(src).toContain("const [presetsFailed, setPresetsFailed] = useState(false);");
    const body = slice(src, "const loadPresets = useCallback(async () => {", "useEffect(() => { void loadPresets(); }, [loadPresets]);");
    expect(body).toContain("if (res?.ok) {");
    expect(body).toContain("setPresets(data.presets ?? []);");
    expect(body).toContain("setPresetsFailed(false);");
    expect(body).toContain("setPresetsFailed(true);");
    expect(body).toContain("setPresetsLoading(false);");
    const elsePart = slice(body, "} else {", "} catch {");
    expect(elsePart).toContain("setPresetsFailed(true);");
    expect(elsePart).not.toContain("setPresets(");
    const catchPart = slice(body, "} catch {", "} finally {");
    expect(catchPart).toContain("setPresetsFailed(true);");
    expect(catchPart).not.toContain("setPresets(");
  });

  it("render order: failed + Retry → loading → proven-empty → grid", () => {
    const body = slice(src, "{presets.length === 0 && presetsFailed ? (", "{presets.map((p) => (");
    expect(body).toContain("Presets couldn&rsquo;t load.");
    expect(body).toContain("onClick={() => void loadPresets()}");
    expect(body).toContain(") : presets.length === 0 && presetsLoading ? (");
    expect(body).toContain("Loading presets…");
    expect(body).toContain(") : presets.length === 0 ? (");
    expect(body).toContain("No presets came back from the server.");
    expect(body.indexOf("Presets couldn&rsquo;t load.")).toBeLessThan(body.indexOf("Loading presets…"));
    expect(body.indexOf("Loading presets…")).toBeLessThan(body.indexOf("No presets came back from the server."));
  });
});

describe("the paid apply, pinned briefly", () => {
  it("cancel returns silently; the result lands only past the ok + url gate; failure names no-spend", () => {
    const body = slice(src, "async function applyPreset(", "function handleBurnManual() {");
    expect(body).toContain("if (res === null) return; // user cancelled the credit confirm");
    expect(body).toContain("if (!res.ok || !data.url) {");
    expect(body).toContain('setError(apiErrorMessage(data, "Color grade failed — no Visual Bucs were spent."));');
    expect(body).toContain("setResult({");
    expect(body.indexOf("if (res === null) return;")).toBeLessThan(body.indexOf("if (!res.ok || !data.url) {"));
    expect(body.indexOf("if (!res.ok || !data.url) {")).toBeLessThan(body.indexOf("setResult({"));
    const catchPart = slice(body, "} catch {", "} finally {");
    expect(catchPart).toContain('setError("Color grade failed — no Visual Bucs were spent.");');
    expect(catchPart).not.toContain("setResult");
  });
});
