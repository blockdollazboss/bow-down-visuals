/**
 * HookDesk (World native) — honest load standard (deep-pins
 * tranche 5). No mount list load: history is session-built.
 * The pinned surface is the six-mode paid run (hooks /
 * captions / preflight / titles / scripts / ctas), which
 * follows the house law plus a per-mode shape-guard: cancel
 * is silent; 402 / out_of_credits is its own state; a
 * non-ok answer notes the server's message; and in EVERY
 * mode an ok answer whose body drifts is a failed make
 * with that mode's own empty-result note — the mode's
 * result state and the history entry are set only from a
 * parsed body, so no mode can dress a drifted answer as
 * rows.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./HookDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the run — every mode shape-guards its answer", () => {
  it("cancel silent; 402 own state; !ok notes the server's words before any mode branch", () => {
    const body = slice(src, "const res = await confirmedFetch(path, {", "const restoreHistory =");
    expect(body).toContain("if (!res) return; // spend confirmation declined — nothing ran");
    expect(body).toContain('if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {');
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain('setNote(apiErrorMessage(d, t("worldCreateMedia.hookHiccup")));');
    expect(body.indexOf("if (!res.ok) {")).toBeLessThan(body.indexOf('if (mode === "hooks") {'));
  });

  it("each mode: an unparseable body notes that mode's empty line and returns before its result is set", () => {
    const body = slice(src, "const res = await confirmedFetch(path, {", "const restoreHistory =");
    const modes: Array<[string, string, string]> = [
      ["const parsed = hooksOfResponse(data);", 'setNote(t("worldCreateMedia.hookEmptyHooks")); return;', "setHooks(parsed);"],
      ["const parsed = captionsOfResponse(data);", 'setNote(t("worldCreateMedia.hookEmptyCaptions")); return;', "setCaptionResult(parsed);"],
      ["const parsed = preflightOfResponse(data);", 'setNote(t("worldCreateMedia.hookEmptyScorecard")); return;', "setPreflight(parsed);"],
      ["const parsed = titlesOfResponse(data);", 'setNote(t("worldJoinSweep.tsbEmptyTitles")); return;', "setTitlesResult(parsed);"],
      ["const parsed = scriptOfResponse(data);", 'setNote(t("worldJoinSweep.tsbEmptyScript")); return;', "setScriptResult(parsed);"],
      ["const parsed = ctasOfResponse(data);", 'setNote(t("worldCreateMedia.hookEmptyCtas")); return;', "setCtas(parsed);"],
    ];
    for (const [parse, empty, setter] of modes) {
      expect(body).toContain(parse);
      expect(body).toContain(`if (!parsed) { ${empty} }`);
      expect(body).toContain(setter);
      expect(body.indexOf(`if (!parsed) { ${empty} }`)).toBeLessThan(body.indexOf(setter));
    }
    const catchPart = slice(body, "    } catch {\n      setNote(", "} finally {");
    expect(catchPart).toContain('setNote(t("worldCreateMedia.hookHiccup"));');
    expect(catchPart).not.toContain("setHistory");
  });
});
