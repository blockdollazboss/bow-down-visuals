/**
 * HumToSong — honest load standard (deep-pins tranche 5).
 * A phase machine (capture → analyzing → ready → generating
 * → done) where every transition is earned: analyze throws
 * unless BOTH the hum reference AND the analysis come back
 * (an incomplete analysis is an error, never a ready state
 * built on half a response); generate reaches "done" only
 * past its res.ok gate, with out_of_credits returning to
 * ready beside the OutOfCredits panel and a cancelled
 * credit confirmation returning to ready silently; an empty
 * recording blob and a mic denial are plain errors, never a
 * phantom hum. Extend follows the same law: no url, no
 * success.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./HumToSong.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("analyze — ready requires the whole response", () => {
  it("!ok throws; a missing humRef OR analysis throws incomplete; the catch leaves ready unclaimed", () => {
    const body = slice(src, 'setPhase("analyzing");', "async function generate() {");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Could not analyze that audio."));');
    expect(body).toContain('if (!data.humRef || !data.analysis) throw new Error("Analysis came back incomplete — try again.");');
    expect(body).toContain('setPhase("ready");');
    expect(body.indexOf('if (!data.humRef || !data.analysis) throw new Error("Analysis came back incomplete — try again.");')).toBeLessThan(
      body.lastIndexOf('setPhase("ready");'),
    );
  });

  it("an empty recording is an error before any upload; mic denial is a plain catch", () => {
    expect(src).toContain("if (blob.size === 0) {");
    const body = slice(src, "const stream = await navigator.mediaDevices.getUserMedia({ audio: true });", "async function analyze(");
    expect(body).toContain("} catch {");
  });
});

describe("generate — done is the last gate, not the default", () => {
  it("cancel returns to ready silently; out_of_credits returns to ready with the panel; done sits past !ok", () => {
    const body = slice(src, 'setPhase("generating");', "async function extendSong(");
    expect(body).toContain('setPhase("ready"); // user cancelled the credit confirmation');
    expect(body).toContain('if (data.error === "out_of_credits") {');
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain('throw new Error(apiErrorMessage(data, "Song generation failed."));');
    expect(body).toContain('setPhase("done");');
    expect(body).toContain('toast({ title: "Your song is ready"');
    expect(body.indexOf('throw new Error(apiErrorMessage(data, "Song generation failed."));')).toBeLessThan(
      body.indexOf('setPhase("done");'),
    );
  });

  it("extend: !ok throws and an empty url throws — no phantom extension", () => {
    const body = slice(src, "const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };", "} catch (err) {");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Extension failed."));');
    expect(body).toContain('if (!data.url) throw new Error("Extension came back empty.");');
    expect(body.indexOf('if (!res.ok) throw new Error(apiErrorMessage(data, "Extension failed."));')).toBeLessThan(
      body.indexOf('if (!data.url) throw new Error("Extension came back empty.");'),
    );
  });
});
