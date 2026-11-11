/**
 * SongReworkPanel (remix a song / replace a section) —
 * honest action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An action panel with two charged generations (full rework,
 * section replace). Both narrate ONLY from a checked
 * response: non-ok OR a success payload without the song
 * throws the server's message into the panel's error line —
 * a rework that returns no song is never presented as a
 * finished song. The hub push after a proven success is a
 * best-effort side-effect (its catch is labeled as such) and
 * claims nothing itself; the clipboard fallback is likewise
 * honest (the link stays visible when the copy fails).
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SongReworkPanel.tsx");

describe("both generations gate success on ok + a proven song payload", () => {
  it("the rework and the section replace share the same honest gate", () => {
    const gates = src.split('if (!res.ok || !data.song) throw new Error(reworkErrorMessage(data, t("songRework.failed")));').length - 1;
    expect(gates).toBe(2);
    expect(src).toContain('setError(plainErrorText(e, t("songRework.failed")));');
  });

  it("the post-success hub push is a labeled best-effort side-effect", () => {
    expect(src).toContain("} catch { /* hub push is best-effort */ }");
    expect(src).toContain("} catch { /* clipboard unavailable — link is still visible below */ }");
  });
});
