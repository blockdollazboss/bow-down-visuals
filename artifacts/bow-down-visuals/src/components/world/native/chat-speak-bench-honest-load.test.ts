/**
 * ChatSpeakBench — honest load standard (deep-pins tranche 4,
 * batch E). Readiness AND the price come from the server status
 * read, never a client constant: the cost badge and the spend
 * override both ride status.creditCost. A thrown status read
 * lands the failed state (the drawer's unavailable words, with a
 * retry that resets status and bumps the nonce), and the render
 * runs loading → failed → casting → unavailable → the ready
 * bench, so "still being cast" is a named state with no speak
 * control at all. The speak itself: a cached synthesis replays
 * locally for free before any new charge is considered; a
 * declined confirmation comes back as a null result and returns
 * to idle with nothing charged; an answer with no outcome is the
 * failed note, never a playback; the audio URL is kept only from
 * a real outcome. Editing the text is a new intent — fresh key,
 * cached audio dropped.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ChatSpeakBench.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the status read — server readiness and server price, failure is a state", () => {
  it("a thrown status read sets the failed flag; a good read sets status and clears it", () => {
    const body = slice(src, "/* The status read — readiness + the server's price. */", "/* Unmount: stop our playback (the drawer's rule). */");
    expect(body).toContain("const s = await fetchChatSpeakStatus((input, init) =>");
    expect(body.indexOf("setStatus(s);")).toBeLessThan(body.indexOf("setStatusFailed(false);"));
    expect(body).toContain("if (alive) setStatusFailed(true);");
  });

  it("the price is the server's figure, used for both the badge and the spend override", () => {
    expect(src).toContain("const cost = status?.creditCost ?? 0;");
    expect(src).toContain("overrideCost: cost,");
    expect(src).toContain("overrideFeature: WORLD_SPEAK_FEATURE,");
  });

  it("renders loading → failed+retry → casting → unavailable → ready bench, in that order", () => {
    const body = slice(src, "{view === \"loading\" ? (", "</section>");
    expect(body.indexOf("{view === \"loading\" ? (")).toBeLessThan(body.indexOf(") : statusFailed ? ("));
    expect(body.indexOf(") : statusFailed ? (")).toBeLessThan(body.indexOf(") : view === \"casting\" ? ("));
    expect(body.indexOf(") : view === \"casting\" ? (")).toBeLessThan(body.indexOf(") : view === \"unavailable\" ? ("));
    expect(body).toContain("message={CHAT_SPEAK_UNAVAILABLE_COPY}");
    expect(body).toContain("setStatusNonce((n) => n + 1);");
    expect(body).toContain("{CHAT_SPEAK_CASTING_COPY}");
  });
});

describe("the speak — decline charges nothing, success only from a real outcome", () => {
  it("a cached synthesis replays for free before readiness is even checked for a new speak", () => {
    const body = slice(src, "const speak = async () => {", "return (\n    <section data-testid=\"world-chat-speak-bench\"");
    expect(body.indexOf("if (urlRef.current) {")).toBeLessThan(body.indexOf("if (!ready || view !== \"ready\") return;"));
    expect(body).toContain("/* Already synthesized once — replay is local and free. */");
  });

  it("decline, no-outcome and success are three separate endings, in that order", () => {
    const body = slice(src, "const speak = async () => {", "return (\n    <section data-testid=\"world-chat-speak-bench\"");
    expect(body).toContain("const result = await requestChatSpeak(speakFetch, text.trim(), keyRef.current);");
    expect(body).toContain("if (result === null) {");
    expect(body).toContain("/* Spend confirmation cancelled — no request, no charge. */");
    expect(body).toContain("const outcome = speakOutcomeOf(result);");
    expect(body).toContain("if (!outcome) {");
    expect(body).toContain("setPhase(\"error\");");
    expect(body.indexOf("urlRef.current = outcome.audioPlayUrl;")).toBeGreaterThan(body.indexOf("if (!outcome) {"));
    expect(body.indexOf("playUrl(outcome.audioPlayUrl);")).toBeGreaterThan(body.indexOf("urlRef.current = outcome.audioPlayUrl;"));
  });

  it("editing the text is a new intent: fresh key, cached audio dropped", () => {
    expect(src).toContain("keyRef.current = null;");
    expect(src).toContain("urlRef.current = null;");
    expect(src).toContain("if (!keyRef.current) keyRef.current = newChatSpeakKey();");
  });
});
