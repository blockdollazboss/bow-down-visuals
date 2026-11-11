/**
 * PodcastStudio — honest load standard (deep-pins tranche 5).
 * PINNED POST-FIX. THE FIX (this tranche): the voices load
 * never checked res.ok and its catch emptied the list, while
 * VoicePicker rendered the podcast.voicePicker.error copy
 * ("Couldn't load voices — check your connection and
 * refresh.") for ANY empty list — a successful-but-empty
 * voice list read as a connection failure. The load now
 * throws on !ok into a voicesError flag, and the picker
 * renders in order: loading → failed copy (only when the
 * load actually failed) → the honest podcast.voicePicker
 * .empty line → the grid. Generation was already honest:
 * the result is set only on res.ok with an audioUrl in the
 * body; 402 / out_of_credits is its own ending. The
 * dialogue-status probe stays deliberately permissive (a
 * failed probe leaves the feature enabled and lets the POST
 * surface the real error) — pinned as the documented
 * design, not a silent list.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PodcastStudio.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("THE FIX — voices: failed is not empty", () => {
  it("the load throws on !ok; success clears voicesError; failure sets it and empties the list", () => {
    expect(src).toContain("const [voicesError, setVoicesError] = useState(false);");
    const body = slice(src, "async function loadVoices() {", "if (user) loadVoices();");
    expect(body).toContain('if (!res.ok) throw new Error("voices failed to load");');
    expect(body).toContain("const list = Array.isArray(data.voices) ? data.voices : [];");
    expect(body).toContain("setVoices(list);");
    expect(body).toContain("setVoicesError(false);");
    expect(body.indexOf('if (!res.ok) throw new Error("voices failed to load");')).toBeLessThan(
      body.indexOf("setVoices(list);"),
    );
    expect(body.indexOf("setVoices(list);")).toBeLessThan(body.indexOf("setVoicesError(false);"));
    const catchPart = slice(body, "} catch {", "} finally {");
    expect(catchPart).toContain("setVoices([]);");
    expect(catchPart).toContain("setVoicesError(true);");
  });

  it("picker render order: loading → failed copy → honest empty → grid; every call site passes the flag", () => {
    const body = slice(src, "{loading ? (", "voices.map((v) => (");
    expect(body).toContain('{t("podcast.voicePicker.loading")}');
    expect(body).toContain(") : voices.length === 0 && loadFailed ? (");
    expect(body).toContain('{t("podcast.voicePicker.error")}');
    expect(body).toContain(") : voices.length === 0 ? (");
    expect(body).toContain('{t("podcast.voicePicker.empty")}');
    expect(body.indexOf(") : voices.length === 0 && loadFailed ? (")).toBeLessThan(
      body.indexOf('{t("podcast.voicePicker.empty")}'),
    );
    expect(src.split("loadFailed={voicesError}").length - 1).toBe(3);
  });
});

describe("generation — the episode exists only past the gate", () => {
  it("cancel silent; 402 / out_of_credits returns first; !ok or a missing audioUrl throws before setResult", () => {
    const body = slice(src, "if (!res) return; // user cancelled the credit confirmation (finally resets state)", "} catch (err) {");
    expect(body).toContain('if (res.status === 402 || data.error === "out_of_credits") {');
    expect(body).toContain("if (!res.ok || !data.audioUrl) {");
    expect(body).toContain('throw new Error(apiErrorMessage(data, t("podcast.errors.generationFailed")));');
    expect(body).toContain("setResult(data);");
    expect(body.indexOf("if (!res.ok || !data.audioUrl) {")).toBeLessThan(body.indexOf("setResult(data);"));
    const s402 = slice(body, 'if (res.status === 402 || data.error === "out_of_credits") {', "if (!res.ok || !data.audioUrl) {");
    expect(s402).toContain("return;");
    expect(s402).not.toContain("setResult");
  });
});
