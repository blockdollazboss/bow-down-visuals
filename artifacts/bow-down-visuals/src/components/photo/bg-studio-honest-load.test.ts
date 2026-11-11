/**
 * BgStudio — honest load standard (deep-pins tranche 4, batch B).
 * The backdrop-provider status probe is a gate, not a collection:
 * a non-ok answer returns early and a throw leaves the gate
 * unknown (its own comment), so the AI tab shows its offline
 * message and generate re-checks the server (a 503 there is the
 * not-connected error) — a failed probe never fakes availability.
 * Upload (free): the photo url lands only after res.ok, before
 * the success toast. Paid removal: a decline returns with
 * nothing charged, non-ok or a url-less answer throws before any
 * cutout is set, and the tier is labeled "basic" because the
 * server path is the color-key. Pro matting (free, on-device):
 * failure lands in matteError with a LABELED Basic fallback
 * button — never a silent swap. Paid backdrop: the
 * not-configured guard fires before any call, decline / 503 /
 * non-ok-or-url-less are separate endings, and the backdrop url
 * sets only from a checked answer. The free composite refuses
 * to invent a result for the AI kind without a backdrop.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./BgStudio.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("status gate — a failed probe leaves the gate unknown, never available", () => {
  it("non-ok returns early; the status and provider switch land only from an ok answer", () => {
    const body = slice(src, "let alive = true;", "/* ── Upload a photo");
    expect(body).toContain("if (!res?.ok) return;");
    expect(body.indexOf("setBackdropStatus(data);")).toBeGreaterThan(body.indexOf("if (!res?.ok) return;"));
    expect(body).toContain("/* gate stays unknown — AI option shows its offline message */");
    expect(body).toContain("return () => { alive = false; };");
    expect(src).toContain("const aiEnabled = !!backdropStatus?.configured && !statusLoading;");
    expect(src).toContain("{!statusLoading && !aiEnabled && (");
  });
});

describe("upload + removal — checked before any success", () => {
  it("upload sets the photo only after res.ok, before its toast", () => {
    const body = slice(src, "async function handleFile(f: File | undefined) {", "/* ── One-tap background removal");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Upload failed."));');
    expect(body.indexOf("setPhotoUrl(url);")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
    expect(body.indexOf('toast({ title: t("bgStudio.uploadedTitle"')).toBeGreaterThan(body.indexOf("setPhotoUrl(url);"));
  });

  it("paid removal: decline returns; non-ok or url-less throws before the cutout is set", () => {
    const body = slice(src, "async function handleRemoveBackground() {", "/* ── Pro matting:");
    expect(body).toContain("if (!res) { setRemoving(false); return; } // user cancelled the confirm");
    expect(body).toContain('throw new Error(apiErrorMessage(data, t("bgStudio.removeFailed"');
    expect(body).toContain('if (!data.url) throw new Error(t("bgStudio.noOutput"');
    expect(body.indexOf("setCutoutUrl(data.url as string);")).toBeGreaterThan(body.indexOf("if (!data.url) throw"));
    expect(body).toContain('setCutoutTier("basic"); // server path is the corner-sampling color-key');
  });

  it("pro matting failure is honest, with a labeled Basic fallback — never a silent swap", () => {
    const body = slice(src, "async function handleProMatting() {", "/* ── Basic color-key fallback");
    expect(body).toContain("// Honest failure + a labeled Basic fallback — never a silent swap.");
    expect(body).toContain('setMatteError(plainErrorText(e, t("bgStudio.matteFailed"');
    expect(src).toContain("onClick={() => void handleBasicKey()}");
  });
});

describe("backdrop generate + composite — no invented backdrop, no invented result", () => {
  it("not-configured guard first; decline / 503 / bad body separate; the url sets only after the checks", () => {
    const body = slice(src, "async function handleGenerateBackdrop(promptOverride?: string) {", "/* ── Client-side composite");
    expect(body).toContain("if (backdropStatus && !backdropStatus.configured) {");
    expect(body).toContain("if (!res) { setGenerating(false); return; } // user cancelled the confirm");
    expect(body).toContain("if (res.status === 503) {");
    expect(body).toContain("if (!res.ok || !data.url) {");
    expect(body.indexOf("setBackdropUrl(data.url as string);")).toBeGreaterThan(body.indexOf("if (!res.ok || !data.url) {"));
  });

  it("the composite clears the result instead of faking one when the AI backdrop is missing", () => {
    expect(src).toContain('const needsBackdrop = replaceKind === "ai" && !backdropUrl;');
    expect(src).toContain("if (needsBackdrop) { setResultUrl(null); return; }");
    expect(src).toContain('setResultUrl(canvas.toDataURL("image/png"));');
  });
});
