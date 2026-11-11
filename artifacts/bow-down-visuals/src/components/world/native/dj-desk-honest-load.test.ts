/**
 * DjDesk — honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 3). The desk's ONE collection load (library +
 * crates, in parallel) already meets the standard; this pin records
 * the machine so it cannot regress:
 *
 * - LOAD: both responses must be ok AND parse through the seam's
 *   shape guards before any state is written; any failure lands in
 *   loadFailed. The failure branch replaces the WHOLE desk with the
 *   failed line + a retry wired to the real loader — there is no
 *   render path where a failed load shows the empty-library or
 *   no-crates copy. The library's genuine empty state is reachable
 *   only after a successful load (tracks !== null, length 0).
 * - WRITES: every crate write (create / PATCH / propose / delete /
 *   export) checks res.ok and the parsed shape before touching
 *   state, and failure lands in the visible crateError line — never
 *   a silent no-op.
 * - ANALYZE (free rail): a per-track failure is named in the note,
 *   a whole-call failure says the analyzer didn't answer, and the
 *   busy set always settles in the finally.
 *
 * NO FIX in this lane — the desk already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./DjDesk.tsx");
const loadBody = desk.slice(desk.indexOf("const load = useCallback(async () => {"), desk.indexOf("useEffect(() => {\n    void load();"));

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
const catalogs = Object.fromEntries(
  LOCALES.map((l) => [l, flat(JSON.parse(read(`../../../locales/${l}.json`)))]),
) as Record<(typeof LOCALES)[number], Record<string, string>>;

describe("the load: failure is a whole-desk error + retry, never an empty shelf", () => {
  it("both legs must be ok, and both bodies must parse, before state is written", () => {
    expect(loadBody).toContain("if (!libRes.ok || !crateRes.ok) throw new Error(\"load failed\");");
    expect(loadBody).toContain("if (!lib || !list) throw new Error(\"load failed\");");
    expect(loadBody.indexOf("if (!libRes.ok || !crateRes.ok)")).toBeLessThan(loadBody.indexOf("setTracks(lib);"));
    expect(loadBody).toContain("setTracks(lib);");
    expect(loadBody).toContain("setCrates(list);");
    expect(loadBody).toContain("setLoadFailed(true);");
    expect(loadBody).toContain("setLoadFailed(false);");
  });

  it("the failure branch renders before the desk body and retries the real loader", () => {
    const failIdx = desk.indexOf("if (loadFailed) {");
    const bodyIdx = desk.indexOf('data-testid="world-dj-desk-empty"');
    expect(failIdx).toBeGreaterThan(-1);
    expect(bodyIdx).toBeGreaterThan(failIdx);
    const failBlock = desk.slice(failIdx, desk.indexOf("return (", failIdx + 10) + 400);
    expect(failBlock).toContain('data-testid="world-dj-desk-failed"');
    expect(failBlock).toContain('t("worldAudioDesk.djLoadFailed")');
    expect(desk).toContain("onClick={() => void load()}");
  });

  it("the genuine empty states are gated on a successful load", () => {
    expect(desk).toContain("tracks === null ? (");
    expect(desk).toContain('t("worldAudioDesk.djLoadingLibrary")');
    expect(desk).toContain("tracks.length === 0 ? (");
    expect(desk).toContain(": crates !== null ? (");
    expect(desk).toContain('t("worldAudioDesk.noCratesYet")');
  });
});

describe("the writes check their answers", () => {
  it("create / patch / propose / delete / export throw on non-ok before touching state", () => {
    expect(desk).toContain('if (!res.ok) throw new Error("save failed");');
    expect(desk).toContain("if (!crate) throw new Error(\"save failed\");");
    expect(desk).toContain('if (!res.ok) throw new Error("create failed");');
    expect(desk).toContain('if (!res.ok) throw new Error("propose failed");');
    expect(desk).toContain("if (!next) throw new Error(\"propose failed\");");
    expect(desk).toContain('if (!res.ok) throw new Error("delete failed");');
    expect(desk).toContain('if (!res.ok) throw new Error("export failed");');
  });

  it("every write failure lands in the one visible crateError line", () => {
    expect(desk).toContain('setCrateError(t("worldAudioDesk.crateCreateFailed"));');
    expect(desk).toContain('setCrateError(t("worldAudioDesk.crateChangeFailed"));');
    expect(desk).toContain('setCrateError(t("worldAudioDesk.crateDeleteFailed"));');
    expect(desk).toContain('setCrateError(t("worldAudioDesk.proposeFailed"));');
    expect(desk).toContain('setCrateError(t("worldAudioDesk.exportFailed"));');
    expect(desk).toContain("{crateError ? <p className={`mt-2 ${errCls}`}>{crateError}</p> : null}");
  });

  it("analyze names per-track failures and always settles its busy set", () => {
    expect(desk).toContain('if (!res.ok) throw new Error("analyze failed");');
    expect(desk).toContain('setAnalyzeNote(t("worldAudioDesk.analyzeSomeFailed", { titles: failedTitles.join(", ") }));');
    expect(desk).toContain('setAnalyzeNote(t("worldAudioDesk.analyzerNoAnswer"));');
    const analyzeBody = desk.slice(desk.indexOf("async function analyze("), desk.indexOf("async function patchCrate("));
    expect(analyzeBody).toContain("} finally {");
    expect(analyzeBody).toContain("for (const id of ids) next.delete(id);");
  });
});

describe("catalog: the load + failure copy resolves in all 10 locales", () => {
  it("worldAudioDesk dj keys are present and non-empty everywhere", () => {
    for (const l of LOCALES) {
      for (const k of ["djTitle", "djLoadFailed", "tryAgain", "djLoadingLibrary", "djEmptyLibrary", "noCratesYet", "crateCreateFailed", "exportFailed"]) {
        expect(catalogs[l][`worldAudioDesk.${k}`], `${l} worldAudioDesk.${k}`).toBeTruthy();
      }
    }
    expect(catalogs.en["worldAudioDesk.djLoadFailed"]).toBe("Your tracks wouldn’t load. Give it another shot.");
  });
});
