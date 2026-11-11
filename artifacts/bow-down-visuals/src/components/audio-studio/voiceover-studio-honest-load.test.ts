/**
 * VoiceoverStudio (the Voiceover Pro page) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE GENERATE action was already honest: non-ok OR a
 *   success payload without an audioUrl throws into the
 *   error line; success is claimed only with the url.
 * - FIX (this tranche): THE VOICE LIST was the AudioDesk
 *   defect's twin (that twin was fixed in tranche 2). The
 *   loader never checked res.ok — an error body parsed as an
 *   empty catalog and a thrown fetch did the same, so every
 *   failure landed in the voices.length === 0 branch, which
 *   printed the load-failed copy for signed-in users (with a
 *   stray sign-in sentence fragment appended) and offered NO
 *   retry: one transient failure bricked the picker for the
 *   session, and a proven-empty library would have been
 *   told it "failed" instead. The loader now throws on
 *   non-ok into a dedicated voicesFailed state; the render
 *   chain is loading → failed (with a retry that re-runs the
 *   real load) → proven-empty → the grid. Two new keys
 *   (voiceover.voicesEmpty / voiceover.voicesRetry) ride the
 *   catalogs in this same commit.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./VoiceoverStudio.tsx");

describe("the generate action gates success on ok + a proven audio url", () => {
  it("non-ok or a missing audioUrl throws into the error line", () => {
    expect(src).toContain("if (!res.ok || !data.audioUrl) {");
    expect(src).toContain('setError(plainErrorText(err, t("voiceover.generateFailedError")));');
  });
});

describe("FIX: the voice list separates failed from proven-empty", () => {
  it("the loader throws on non-ok and records failure in its own state", () => {
    expect(src).toContain('if (!res.ok) throw new Error("voices load failed");');
    expect(src).toContain("const [voicesFailed, setVoicesFailed] = useState(false);");
    expect(src).toContain("setVoicesFailed(true);");
    expect(src).toContain("setVoicesFailed(false);");
  });

  it("the render chain is loading → failed (with retry) → proven-empty → grid", () => {
    const loadingIdx = src.indexOf("{voicesLoading ? (");
    const failedIdx = src.indexOf(") : voicesFailed ? (");
    const emptyIdx = src.indexOf(") : voices.length === 0 ? (");
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(failedIdx).toBeGreaterThan(loadingIdx);
    expect(emptyIdx).toBeGreaterThan(failedIdx);
    expect(src).toContain('data-testid="btn-retry-voices"');
    expect(src).toContain('t("voiceover.voicesRetry")');
    expect(src).toContain('t("voiceover.voicesEmpty")');
  });

  it("the retry re-runs the real load through the effect dependency", () => {
    expect(src).toContain("}, [user, voicesRetry]);");
    expect(src).toContain("onClick={() => setVoicesRetry((n) => n + 1)}");
  });
});
