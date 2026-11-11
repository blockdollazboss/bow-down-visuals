/**
 * ManualDAW (the manual DAW inside the music studio) —
 * honest action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * The DAW edits local editor state (the stems are the
 * member's own timeline, not a collection load — the
 * stems.length === 0 branches are the genuine empty timeline,
 * not a dressed-up failure). Its network life is the EXPORT
 * actions, and they narrate only from proven responses:
 * - a declined credit confirmation (null resp) aborts
 *   quietly in-panel and, for a direct (hub-initiated)
 *   request, reports an honest "Export cancelled before
 *   spending Visual Bucs." status — never a completion;
 * - the export record, the "Export Complete" toast and the
 *   direct-request "complete" status are built ONLY from a
 *   returned resp, warnings included verbatim when the
 *   server sends them;
 * - a failure lands on the export error line AND the
 *   direct-request error status with the same message.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ManualDAW.tsx");

describe("the export narrates only from a proven response", () => {
  it("a declined confirmation reports a cancellation, never a completion", () => {
    expect(src).toContain("/* User cancelled the credit confirmation — abort quietly. */");
    expect(src).toContain('message: "Export cancelled before spending Visual Bucs.",');
  });

  it("the record and completion status are built from the returned resp only", () => {
    expect(src).toContain("const record = buildExportRecord(btn, resp, {");
    expect(src).toContain('status: "complete",');
    expect(src).toContain('toast({ title: "Export Complete", description: `${btn.label} is ready to download.` });');
  });

  it("a failure lands on both the error line and the direct-request status", () => {
    expect(src).toContain('const message = plainErrorText(e, "Export failed. Please try again.");');
    expect(src).toContain("setExportError(message);");
  });
});
