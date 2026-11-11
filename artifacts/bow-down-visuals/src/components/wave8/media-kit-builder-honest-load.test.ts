/**
 * MediaKitBuilder — honest load standard (deep-pins tranche 4,
 * batch E). The paid build is the load that matters: its price
 * is single-sourced from the credit registry (the literal is
 * only the missing-row fallback), a declined confirmation
 * returns with nothing built, 402 is the out-of-credits ending,
 * 503 is its own not-set-up line, any other non-ok is the
 * server's error line, and the kit is set only after every one
 * of those checks — an ok-but-failed answer never becomes a kit
 * on screen. Two reads around it are documented enhancements,
 * pinned as written: the vault list only feeds an optional
 * picker (its failure is non-fatal by its own comment — the
 * server falls back to profile basics and the build sends an
 * empty body), and the shareable link's liveness is CHECKED
 * against the public press-kit rail and reported in three
 * states — unknown while checking, live, or not-live-yet —
 * never simply asserted.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./MediaKitBuilder.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the build — decline / 402 / 503 / non-ok are four endings before the kit", () => {
  it("the price is single-sourced from the registry, with the literal only as its fallback", () => {
    expect(src).toContain("const KIT_COST = getCreditCost(\"/api/wave8/media-kit/generate\")?.cost ?? 100;");
  });

  it("the kit is set only after the decline, 402, 503 and non-ok checks, in that order", () => {
    const body = slice(src, "async function handleBuild() {", "async function downloadPdf() {");
    expect(body).toContain("if (!res) return; // user cancelled the credit confirmation");
    expect(body.indexOf("if (!res) return;")).toBeLessThan(body.indexOf("if (res.status === 402) { setOutOfCredits(true); return; }"));
    expect(body.indexOf("if (res.status === 402) { setOutOfCredits(true); return; }")).toBeLessThan(
      body.indexOf("if (res.status === 503) {"),
    );
    expect(body.indexOf("if (res.status === 503) {")).toBeLessThan(body.indexOf("if (!res.ok) {"));
    expect(body).toContain("setError(apiErrorMessage(data, \"That isn't set up yet — try again later.\"));");
    expect(body).toContain("setError(apiErrorMessage(data, t(\"wave8.mediaKit.errors.buildFailed\")));");
    expect(body.indexOf("setKit(data.kit as MediaKit);")).toBeGreaterThan(body.indexOf("if (!res.ok) {"));
    expect(body).toContain("setError(t(\"wave8.mediaKit.errors.network\"));");
  });
});

describe("the two side reads — documented enhancements, honestly reported", () => {
  it("the vault list is non-fatal by its own comment, and the build works with an empty body without it", () => {
    expect(src).toContain("/* non-fatal — the server falls back to profile basics */");
    expect(src).toContain("{vaults.length > 0 && (");
    expect(src).toContain("body: JSON.stringify(vaultId ? { vaultId } : {}),");
  });

  it("the share link's liveness is checked against the rail and reported live / pending / still-checking", () => {
    const body = slice(src, "/* Check whether a public press kit exists at this handle so the", "async function handleBuild() {");
    expect(body).toContain("const res = await fetch(`/api/press-kit/public/${encodeURIComponent(handle)}`);");
    expect(body).toContain("if (!cancelled) setLinkLive(res.ok);");
    expect(body).toContain("if (!cancelled) setLinkLive(false);");
    expect(src).toContain("linkLive === null");
    expect(src).toContain('t("wave8.mediaKit.linkLive")');
    expect(src).toContain('t("wave8.mediaKit.linkPending")');
  });
});
