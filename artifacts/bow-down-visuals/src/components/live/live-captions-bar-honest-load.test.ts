/**
 * LiveCaptionsBar (the viewer's live-captions overlay) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A live viewer surface whose header states its doctrine —
 * the track-off state "says the streamer hasn't opened
 * captions" rather than showing a blank bar or a fake line:
 * - THE STATES are showing / waiting / track-off /
 *   ticket-locked, each rendered as itself; the caption line
 *   renders only from the caption client's proven current
 *   line (client.currentLine), gated by the viewer's own
 *   saved preference.
 * - A SLOW TRACK BEAT (15s) re-checks whether the streamer
 *   opened or closed captions, so the state the bar shows
 *   tracks the proven track state instead of freezing at
 *   whatever it was on mount.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LiveCaptionsBar.tsx");

describe("captions render only from the proven track line; track-off says so", () => {
  it("the line source, the states, and the beat are pinned", () => {
    expect(src).toContain("const line = pref.on && client ? client.currentLine : null;");
    expect(src).toContain('state === "track-off"');
    expect(src).toContain("const beat = setInterval(() => void client.refreshTrack(), 15_000);");
  });
});
