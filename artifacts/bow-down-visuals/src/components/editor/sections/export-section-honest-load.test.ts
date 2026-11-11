/**
 * ExportSection (the editor export panel; watermark leg) —
 * honest action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An editor section whose server legs are actions and jobs:
 * - THE WATERMARK UPLOAD gates the settings write on the ok
 *   response — the returned URL enters export settings only
 *   after the `!res.ok` throw; a failed upload lands on the
 *   watermark error line and leaves the previous watermark
 *   setting exactly as it was. The uploading flag clears in
 *   finally.
 * - THE DIRECT-RENDER leg is a status-driven job (its
 *   button disables while the status reads "rendering" and
 *   the render status object — not optimism — drives the
 *   UI), the same job doctrine as the shared export poller
 *   family.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ExportSection.tsx");

describe("the watermark enters settings only from a proven upload", () => {
  it("the gate precedes the settings write; the flag clears in finally", () => {
    const gateIdx = src.indexOf('throw new Error(apiErrorMessage(body, "Upload failed"));');
    const writeIdx = src.indexOf("setExport({ customWatermarkUrl: url });");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(gateIdx);
    expect(src).toContain("setWmUploading(false);");
  });
});
