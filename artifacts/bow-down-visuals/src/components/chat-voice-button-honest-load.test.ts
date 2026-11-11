/**
 * ChatVoiceButton — honest load standard (deep-pins
 * tranche 5). The button is seam-driven (lib/chat-voice):
 * idle / listening / transcribing are real capture states,
 * and every error kind the seam reports is forwarded to the
 * note line under the input via chatVoiceNote(state, error)
 * — nothing is swallowed. An unsupported browser sets the
 * "unsupported" error kind instead of the button silently
 * doing nothing; a transcript reaches the parent only from
 * the seam's onFinal (the button never invents text); the
 * session is disposed on unmount so no late callback lands
 * on an unmounted tree. Transcribing is a hard stop for
 * re-entry — no double capture.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ChatVoiceButton.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the seam states — surfaced, never swallowed", () => {
  it("every state/error change is reported to the note line through chatVoiceNote", () => {
    expect(src).toContain("onNoteChange?.(chatVoiceNote(state, error));");
    expect(src).toContain("}, [state, error, onNoteChange]);");
    expect(src).toContain("onError: (kind) => setError(kind),");
    expect(src).toContain("onState: setState,");
  });

  it("unsupported is an explicit error kind, set before any session can start", () => {
    const body = slice(src, "const toggle = () => {", "sessionRef.current.start();");
    expect(body).toContain("if (!supported) {");
    expect(body).toContain('setError("unsupported");');
    expect(body.indexOf('setError("unsupported");')).toBeLessThan(body.indexOf("createChatVoiceSession("));
    expect(src).toContain("const [supported] = useState<boolean>(() => isChatVoiceSupported());");
  });

  it("transcripts arrive only via onFinal, which also clears the error", () => {
    const body = slice(src, "onFinal: (text) => {", "onError: (kind) => setError(kind),");
    expect(body).toContain("setError(null);");
    expect(body).toContain("onTranscript(text);");
  });

  it("transcribing blocks re-entry; listening stops; unmount disposes the session", () => {
    const body = slice(src, "const toggle = () => {", "sessionRef.current.start();");
    expect(body).toContain('if (state === "listening") {');
    expect(body).toContain("sessionRef.current?.stop();");
    expect(body).toContain('if (state === "transcribing") return;');
    const unmount = slice(src, "return () => {", "}, []);");
    expect(unmount).toContain("sessionRef.current?.dispose();");
    expect(unmount).toContain("sessionRef.current = null;");
  });
});
