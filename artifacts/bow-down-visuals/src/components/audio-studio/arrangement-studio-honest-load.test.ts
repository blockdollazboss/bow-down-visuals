/**
 * ArrangementStudio (the local-first arrangement editor) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A classification pin for the local-editor doctrine (the
 * ManualDAW shape): there is NO server load to dress up.
 * - STATE INITIALIZES from the member's own local draft, or
 *   a genuinely empty arrangement — the editor's empty
 *   timeline is the member's real workspace, not a claim
 *   about server data.
 * - THE SERVER DRAFT RESTORE only ever FILLS an empty local
 *   state ("local wins"), requires a proven non-empty
 *   payload (server.tracks.length > 0), and silently no-ops
 *   on any failure — a failed restore can never overwrite or
 *   misrepresent local work.
 * - THE AUTO-SAVE writes local FIRST (synchronously, every
 *   change) and the server copy only when signed in; the
 *   savedAt stamp follows that real local save, so the
 *   "saved" mark is always true of the copy that matters.
 * - UPLOADS surface failures as destructive toasts; nothing
 *   lands on the timeline that didn't upload.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ArrangementStudio.tsx");

describe("local-first: the server can only fill an empty local state", () => {
  it("initial state is the local draft or a real empty arrangement", () => {
    expect(src).toContain("() => loadLocalArrangement() ?? emptyArrangement(),");
    expect(src).toContain("/* Server draft restore (only fills an empty local state — local wins). */");
    expect(src).toContain("if (loadLocalArrangement()) return;");
    expect(src).toContain("if (!cancelled && server && server.tracks.length > 0) setArrangement(server);");
  });

  it("the auto-save writes local first; uploads fail out loud", () => {
    expect(src).toContain("saveLocalArrangement(arrangement);");
    expect(src).toContain('toast({ title: "Upload failed", description: plainErrorText(err, "Could not upload."), variant: "destructive" });');
  });
});
