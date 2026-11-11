/**
 * HarmonyGeneratorModal — honest load standard (deep-pins tranche 3,
 * batch 8). The modes/styles probe on open is a documented
 * enhancement (its comment: a failing probe is non-fatal — the
 * server re-validates on generate; the form stands on the classic
 * defaults, and the style row shows its own "loading styles" line
 * while styles are empty). The generate run is a phase machine:
 * decline returns to the form; 402 returns to the form with the
 * out-of-credits panel; a 503 not_configured returns to the form
 * with the honest not-wired panel AND a one-click classic fallback;
 * non-ok or a preview-less body throws into the error panel; the
 * done phase renders only from a parsed result. The two handoffs
 * (lyric video, cover art) throw on non-ok AND on a url-less body
 * into their own error lines. The share's referral read is a
 * documented passenger (the share works without the code).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./HarmonyGeneratorModal.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the modes probe — documented enhancement", () => {
  it("a failed probe changes nothing; the server re-validates on generate", () => {
    expect(src).toContain("/* modes probe failing is non-fatal — server re-validates on generate */");
    expect(src).toContain("if (!res?.ok || cancelled) return;");
    expect(src).toContain('{styles.length === 0 && <p className="text-xs text-white/40">{t("harmony.loadingStyles")}</p>}');
  });
});

describe("generate — the phase machine keeps its outcomes separate", () => {
  it("decline / 402 / 503-not-configured / bad body each land differently", () => {
    const body = slice(src, "async function handleGenerate(useMode:", "function handleMixIntoSong() {");
    expect(body).toContain('if (!res) { setPhase("form"); return; } // user cancelled the credit confirmation');
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain('if (res.status === 503 && data.code?.includes("not_configured")) {');
    expect(body).toContain("setAiUnavailable(true);");
    expect(body).toContain("if (!res.ok || !data.mixedPreviewUrl) {");
    expect(body.indexOf('setPhase("done")')).toBeGreaterThan(body.indexOf("if (!res.ok || !data.mixedPreviewUrl) {"));
    expect(src).toContain('onClick={() => { setMode("classic"); void handleGenerate("classic"); }}');
  });

  it("the handoffs throw on non-ok and on a url-less body into their own error lines", () => {
    const lyric = slice(src, "async function handleLyricVideo() {", "async function handleCoverArt() {");
    expect(lyric).toContain('if (!res.ok || !data.url) throw new Error(apiErrorMessage(data, t("harmony.lyricVideoFailed")));');
    expect(lyric).toContain("setLyricError(plainErrorText(e, t(\"harmony.lyricVideoFailed\")));");
    const art = slice(src, "async function handleCoverArt() {", "async function handleShare() {");
    expect(art).toContain('if (!res.ok || !data.url) throw new Error(apiErrorMessage(data, t("harmony.coverArtFailed")));');
    expect(art).toContain("setArtError(plainErrorText(e, t(\"harmony.coverArtFailed\")));");
    expect(src).toContain("/* share works without the code too */");
  });
});
