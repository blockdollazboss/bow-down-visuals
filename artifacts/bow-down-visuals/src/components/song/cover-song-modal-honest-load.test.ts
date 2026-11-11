/**
 * CoverSongModal — honest load standard (deep-pins tranche 3,
 * batch 8). The presets read on open is a documented enhancement
 * (its comment: presets are optional — the server falls back to a
 * default; the picker shows its own "Loading styles…" line while
 * empty, and simple-mode generate stays gated on a chosen preset,
 * so a failed read can never generate against an invented style).
 * The generate run: decline returns to the form; 402 (status OR the
 * out_of_credits error body) returns to the form with the
 * out-of-credits panel; non-ok OR a song-less OR url-less body
 * throws into the error panel; the done phase renders only from a
 * parsed cover, and onCoverCreated fires only then. The lyric-video
 * and cover-art handoffs mirror the harmony modal's pattern (throw
 * on non-ok/url-less into their own error lines). The share's
 * referral read is a documented passenger.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CoverSongModal.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the presets read — documented enhancement, generate stays gated", () => {
  it("a failed read leaves the picker empty; simple mode cannot generate without a preset", () => {
    expect(src).toContain("/* presets are optional — the server falls back to a default */");
    expect(src).toContain("if (data.presets?.length) {");
    expect(src).toContain("(mode === \"simple\" ? !!presetKey : stylePrompt.trim().length > 0);");
    expect(src).toContain("Loading styles…");
  });
});

describe("generate — outcomes stay separate; done only from a parsed cover", () => {
  it("decline / 402 / incomplete body are three different endings", () => {
    const body = slice(src, "async function handleGenerate() {", "async function handleLyricVideo() {");
    expect(body).toContain('if (!res) { setPhase("form"); return; } // user cancelled the credit confirm');
    expect(body).toContain('if (res.status === 402 || data.error === "out_of_credits") {');
    expect(body).toContain("if (!res.ok || !data.song || !data.audioUrl) {");
    expect(body.indexOf("setCover(data.song);")).toBeGreaterThan(body.indexOf("if (!res.ok || !data.song || !data.audioUrl) {"));
    expect(body.indexOf("onCoverCreated?.(data.song);")).toBeGreaterThan(body.indexOf("setCover(data.song);"));
    expect(body.indexOf('setPhase("done")')).toBeGreaterThan(body.indexOf("if (!res.ok || !data.song || !data.audioUrl) {"));
  });

  it("the handoffs throw on non-ok and on a url-less body into their own error lines", () => {
    const lyric = slice(src, "async function handleLyricVideo() {", "async function handleCoverArt() {");
    expect(lyric).toContain('if (!res.ok || !data.url) throw new Error(apiErrorMessage(data, "Lyric video failed. Please try again."));');
    const art = slice(src, "async function handleCoverArt() {", "async function handleShare() {");
    expect(art).toContain('if (!res.ok || !data.url) throw new Error(apiErrorMessage(data, "Cover art failed. Please try again."));');
    expect(src).toContain("/* share works without the code too */");
  });
});
