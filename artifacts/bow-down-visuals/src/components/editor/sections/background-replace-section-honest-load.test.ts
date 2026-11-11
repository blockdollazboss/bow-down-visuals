/**
 * BackgroundReplaceSection — honest load standard (deep-pins
 * tranche 4, batch C). Two paid flows, both checked before any
 * success. (1) The AI plate gate: the status read sets the gate
 * only from an ok answer; a network failure leaves the gate
 * closed (its comment says so) and the panel renders loading →
 * not-configured notice → form in that order, so a failed read
 * never looks like a working generator. Generate: a decline
 * returns with nothing generated and no charge, 503 closes the
 * gate in the UI, 402 is the out-of-credits ending, non-ok and
 * imageUrl-less answers throw, and the plate is set only after
 * the returned image actually loads. (2) The on-device replace:
 * the 200 VB charge is collected only AFTER processing succeeds
 * (charge on delivery); a decline discards the processed blob,
 * a 402 KEEPS it so a top-up retry needs no reprocessing, and
 * the result URL + clip swap happen only after an ok charge.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./BackgroundReplaceSection.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the AI gate — a failed status read keeps the gate closed", () => {
  it("status is set only from an ok answer; loading always ends", () => {
    const body = slice(src, 'const res = await confirmedFetch("/api/bg-generate/status"', "}, [confirmedFetch]);");
    expect(body).toContain("if (res?.ok && alive) {");
    expect(body.indexOf("setAiStatus({")).toBeGreaterThan(body.indexOf("if (res?.ok && alive) {"));
    expect(body).toContain("/* gate stays closed on network error — presets/uploads keep working */");
    expect(body).toContain("if (alive) setAiStatusLoading(false);");
  });

  it("render order: checking → not-configured notice → the form", () => {
    expect(src.indexOf("aiStatusLoading ? (")).toBeLessThan(src.indexOf(": !aiConfigured ? ("));
    expect(src.indexOf(": !aiConfigured ? (")).toBeLessThan(src.indexOf('data-testid="wave9b-bg-ai-prompt"'));
    expect(src).toContain("disabled={!aiConfigured || aiGenerating || aiStatusLoading}");
  });
});

describe("AI generate — decline / 503 / 402 / non-ok are separate endings", () => {
  const body = slice(src, "async function generateAiBackground() {", "  /** Cover-fit an image plate onto the canvas");

  it("an unconfigured gate and a decline both stop before any charge or plate", () => {
    expect(body).toContain("if (aiGenerating || !aiConfigured) return;");
    expect(body).toContain("if (!res) {");
    expect(body).toContain("// User cancelled the credit confirmation — nothing generated, no charge.");
  });

  it("503 closes the UI gate; 402 is the out-of-credits ending; non-ok throws", () => {
    expect(body).toContain("if (res.status === 503) {");
    expect(body).toContain("setAiStatus((s) => (s ? { ...s, configured: false } : s));");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain("if (!data?.imageUrl) {");
  });

  it("the plate is set only after the returned image loads; the toast follows", () => {
    expect(body.indexOf("setAiBg(img);")).toBeGreaterThan(body.indexOf("const img = await loadPlateImage(data.imageUrl);"));
    expect(body.indexOf("toast({")).toBeGreaterThan(body.indexOf("setAiBg(img);"));
    expect(body).toContain("if (data.replayed && data.replayNote) setAiReplayNote(data.replayNote);");
  });
});

describe("replace — charge on delivery, and only an ok charge makes a result", () => {
  it("processing completes and holds the blob before the charge is collected", () => {
    const body = slice(src, "async function replaceBackground() {", "async function collectCharge() {");
    expect(body.indexOf("pendingBlob.current = blob;")).toBeGreaterThan(
      body.indexOf("const blob = await processVideo(mediaUrl, drawBackground, setProgress);"),
    );
    expect(body.indexOf("await collectCharge();")).toBeGreaterThan(body.indexOf("pendingBlob.current = blob;"));
    expect(body).toContain('setPhase("error");');
  });

  it("decline discards the blob; 402 keeps it for the top-up retry", () => {
    const body = slice(src, "async function collectCharge() {", "  /**\n   * On-device pipeline");
    expect(body).toContain("// User cancelled the credit confirmation — discard, no charge.");
    expect(body).toContain("pendingBlob.current = null;");
    const ooc = slice(body, "if (res.status === 402) {", "if (!res.ok) throw");
    expect(ooc).toContain("setOutOfCredits(true);");
    expect(ooc).not.toContain("pendingBlob.current = null;");
    expect(src).toContain("{outOfCredits && pendingBlob.current && (");
    expect(src).toContain('data-testid="wave9b-bg-retry-charge"');
  });

  it("the result URL and clip swap happen only after the ok check", () => {
    const body = slice(src, "async function collectCharge() {", "  /**\n   * On-device pipeline");
    expect(body).toContain("if (!res.ok) throw new Error(t(`${ns}.errorGeneric`));");
    expect(body.indexOf("setResultUrl(url);")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
    expect(body.indexOf("onReplaceClipVideo?.(scene!.id, url);")).toBeGreaterThan(body.indexOf("setResultUrl(url);"));
  });

  it("the on-device pipeline throws rather than returning an empty result", () => {
    expect(src).toContain("await loadSelfieSegmentation().catch(() => {");
    expect(src).toContain('if (blob.size === 0) throw new Error(t(`${ns}.errorGeneric`));');
  });
});
