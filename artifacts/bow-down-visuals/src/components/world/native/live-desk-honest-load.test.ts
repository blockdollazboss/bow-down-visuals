/**
 * LiveDesk (the World live studio + the schedule desk) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 2).
 *
 * - THE STATUS READ: a non-ok read throws into the failed flag;
 *   the status (and with it the leftover-stream banner) records
 *   only from a proven payload. END LEFTOVER follows from that:
 *   after its end attempt it RE-READS the status, so a failed
 *   end leaves the still-live stream on screen — which is the
 *   truth — and can never paint "ended" (contrast the 2D
 *   BroadcastStudio, whose local banner + success toast needed
 *   the tranche-2 batch-1 fix).
 * - THE VIEWER COUNT is a live additive number: a failed poll
 *   keeps the last proven count and the next poll retries; it
 *   never zeroes or invents.
 * - THE SCHEDULED-STREAMS LOAD: non-ok throws into its failed
 *   flag (the desk's schedLoadFailed state); success records +
 *   clears it. The save flow checks its POST before claiming
 *   created/updated.
 *
 * FINDING + FIX (this lane): the schedule desk's two DELETEs
 * were unchecked while their notes claimed success.
 * handleCancel awaited the DELETE, then unconditionally set
 * "…is cancelled." — a failed delete (the row still scheduled,
 * as the reload honestly showed) was announced as cancelled.
 * The save flow's edit path deleted the old plan unchecked,
 * then set "Stream updated — … the old one is cancelled."
 * Both now check res.ok: a failed cancel lands on the new
 * schedCancelFailed line, and a failed old-plan delete lands
 * on schedOldStillThere ("both are still on the schedule") —
 * the updated note is said only when the delete landed. The
 * lists themselves always reloaded server truth and still do.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./LiveDesk.tsx");

describe("the status read: the leftover banner is server truth", () => {
  it("a non-ok status read throws into the failed flag; success clears it", () => {
    expect(desk).toContain('if (!res.ok) throw new Error("status");');
    expect(desk).toContain("setStatus(normalizeLiveStatus(await res.json()");
    expect(desk).toContain("setFailed(false);");
    expect(desk).toContain("setFailed(true);");
  });

  it("end leftover re-reads the status after its attempt — a failed end stays on screen, truthfully", () => {
    const start = desk.indexOf("async function endLeftover()");
    const end = desk.slice(start, desk.indexOf('data-testid="world-live-studio"'));
    expect(end).toContain("await loadStatus();");
    expect(end).not.toContain("setStatus(null)");
  });

  it("the viewer poll records only on ok and keeps the last count otherwise", () => {
    expect(desk).toContain("if (res.ok) {");
    expect(desk).toContain("if (typeof d.stream?.viewer_count === \"number\") setViewers(d.stream.viewer_count);");
    expect(desk).toContain("} catch { /* next poll retries */ }");
  });
});

describe("the schedule desk load + save", () => {
  it("a non-ok list read throws into the failed flag", () => {
    expect(desk).toContain('if (!res.ok) throw new Error("streams");');
    expect(desk).toContain("setView(normalizeScheduledStreams(await res.json()));");
  });

  it("the save checks its POST before claiming created or updated", () => {
    expect(desk).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldLivePromo.schedSaveFailed")));');
  });
});

describe("FIX: the schedule deletes may no longer claim success unchecked", () => {
  it("cancel throws on a non-ok delete into the failure note; the cancelled note rides ok", () => {
    const cancel = desk.slice(desk.indexOf("async function handleCancel(row: ScheduledStreamRow)"), desk.indexOf("const muted = isLight ? \"text-[#6B5B36]\" : \"text-white/50\";\n\n  return (\n    <div className=\"space-y-3\" data-testid=\"world-live-schedule\">"));
    expect(cancel).toContain("const res = await fetch(SCHEDULED_STREAM_PATH(row.id), { method: \"DELETE\", headers: await authHeaders() });");
    expect(cancel).toContain('if (!res.ok) throw new Error("cancel");');
    expect(cancel).toContain('setNote(t("worldLivePromo.streamCancelledNote", { title: row.title }));');
    expect(cancel.indexOf('throw new Error("cancel")')).toBeLessThan(cancel.indexOf("streamCancelledNote"));
    expect(cancel).toContain('setNote(t("worldLivePromo.schedCancelFailed"));');
  });

  it("the edit path says 'old one cancelled' only when the delete landed", () => {
    expect(desk).toContain("const delRes = await fetch(SCHEDULED_STREAM_PATH(editingId), { method: \"DELETE\", headers: await authHeaders() });");
    expect(desk).toContain('setNote(delRes.ok ? t("worldLivePromo.schedUpdatedNote") : t("worldLivePromo.schedOldStillThere"));');
  });
});
