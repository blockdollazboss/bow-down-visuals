/**
 * piano-roll-keyboard.test.ts — stack1000 M5, surface 1 (PianoRoll grid).
 *
 * Keyboard editing for roll notes: focus a note, arrows nudge pitch/time
 * on the grid's own quantize, Shift+arrows resize, Delete removes, Enter
 * auditions. The keyboard path must produce the SAME state transitions
 * as the pointer path — these tests run noteKeyAction's targets through
 * the real moveNote / resizeNote state functions and compare against
 * the pointer drag formulas copied verbatim from the component.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { moveNote, resizeNote, type MidiRollNote } from "@/lib/arrangement";
import { noteKeyAction } from "@/lib/piano-roll-keys";

const SNAP = 0.25; // bpm 120 → beatSec 0.5 → snapSec = beatSec / 2
const note = (patch: Partial<MidiRollNote> = {}): MidiRollNote => ({
  id: "n1", pitch: 60, start: 1, duration: 0.5, velocity: 100, ...patch,
});

/* The pointer formulas, verbatim from PianoRoll's drag handlers:
 * move:   start = Math.round((orig.start + dx) / snapSec) * snapSec (then max 0)
 * resize: duration = Math.max(snapSec / 2, orig.duration + dx) */
const pointerMoveStart = (orig: MidiRollNote, dx: number) =>
  Math.max(0, Math.round((orig.start + dx) / SNAP) * SNAP);
const pointerResizeDuration = (orig: MidiRollNote, dx: number) =>
  Math.max(SNAP / 2, orig.duration + dx);

describe("noteKeyAction — pitch", () => {
  it("ArrowUp / ArrowDown move one semitone, start untouched", () => {
    expect(noteKeyAction(note(), "ArrowUp", false, SNAP)).toEqual({ type: "move", start: 1, pitch: 61 });
    expect(noteKeyAction(note(), "ArrowDown", false, SNAP)).toEqual({ type: "move", start: 1, pitch: 59 });
  });
  it("pitch clamps to the roll's visible range (C2..C6 = 36..84)", () => {
    expect(noteKeyAction(note({ pitch: 84 }), "ArrowUp", false, SNAP)).toEqual({ type: "move", start: 1, pitch: 84 });
    expect(noteKeyAction(note({ pitch: 36 }), "ArrowDown", false, SNAP)).toEqual({ type: "move", start: 1, pitch: 36 });
  });
});

describe("noteKeyAction — time moves equal one-cell pointer drags", () => {
  it("ArrowRight / ArrowLeft move exactly ±snap, pointer-identical", () => {
    const n = note();
    const right = noteKeyAction(n, "ArrowRight", false, SNAP);
    const left = noteKeyAction(n, "ArrowLeft", false, SNAP);
    expect(right).toEqual({ type: "move", start: pointerMoveStart(n, SNAP), pitch: 60 });
    expect(left).toEqual({ type: "move", start: pointerMoveStart(n, -SNAP), pitch: 60 });
  });
  it("an off-grid (recorded) note re-snaps exactly like a pointer drag", () => {
    const n = note({ start: 0.37 });
    const right = noteKeyAction(n, "ArrowRight", false, SNAP);
    expect(right?.type).toBe("move");
    if (right?.type === "move") expect(right.start).toBeCloseTo(pointerMoveStart(n, SNAP), 10);
  });
  it("start floors at 0", () => {
    expect(noteKeyAction(note({ start: 0 }), "ArrowLeft", false, SNAP)).toEqual({ type: "move", start: 0, pitch: 60 });
  });
  it("fed through moveNote, the transition equals the pointer drag's", () => {
    const notes = [note(), note({ id: "n2", start: 2 })];
    const a = noteKeyAction(notes[0]!, "ArrowRight", false, SNAP);
    if (a?.type !== "move") throw new Error("expected move");
    const viaKeys = moveNote(notes, "n1", a.start, a.pitch);
    const viaPointer = moveNote(notes, "n1", pointerMoveStart(notes[0]!, SNAP), notes[0]!.pitch);
    expect(viaKeys).toEqual(viaPointer);
    expect(viaKeys[1]).toEqual(notes[1]); // other notes untouched
  });
});

describe("noteKeyAction — resize equals the edge drag", () => {
  it("Shift+ArrowRight / Left resize by ±snap through resizeNote", () => {
    const n = note();
    const grow = noteKeyAction(n, "ArrowRight", true, SNAP);
    const shrink = noteKeyAction(n, "ArrowLeft", true, SNAP);
    expect(grow).toEqual({ type: "resize", duration: pointerResizeDuration(n, SNAP) });
    expect(shrink).toEqual({ type: "resize", duration: pointerResizeDuration(n, -SNAP) });
    if (grow?.type === "resize") {
      expect(resizeNote([n], "n1", grow.duration)[0]!.duration).toBeCloseTo(0.75, 10);
    }
  });
  it("resize floors at snapSec / 2, like the drag", () => {
    expect(noteKeyAction(note({ duration: SNAP }), "ArrowLeft", true, SNAP)).toEqual({
      type: "resize", duration: SNAP / 2,
    });
  });
});

describe("noteKeyAction — delete / audition / ignore", () => {
  it("Delete and Backspace delete; Enter and Space audition", () => {
    expect(noteKeyAction(note(), "Delete", false, SNAP)).toEqual({ type: "delete" });
    expect(noteKeyAction(note(), "Backspace", false, SNAP)).toEqual({ type: "delete" });
    expect(noteKeyAction(note(), "Enter", false, SNAP)).toEqual({ type: "audition" });
    expect(noteKeyAction(note(), " ", false, SNAP)).toEqual({ type: "audition" });
  });
  it("unmapped keys are ignored", () => {
    expect(noteKeyAction(note(), "a", false, SNAP)).toBeNull();
    expect(noteKeyAction(note(), "Tab", false, SNAP)).toBeNull();
  });
});

describe("PianoRoll wiring pins", () => {
  const src = readFileSync(new URL("./PianoRoll.tsx", import.meta.url), "utf8");
  it("notes are focusable buttons with a position label", () => {
    expect(src).toContain("tabIndex={0}");
    expect(src).toContain('role="button"');
    expect(src).toContain("aria-label={`${pitchLabel(note.pitch)} note, beat");
    expect(src).toContain("onFocus={() => setSelectedId(note.id)}");
  });
  it("the key handler routes through noteKeyAction into the pointer's state functions", () => {
    expect(src).toContain("const action = noteKeyAction(note, e.key, e.shiftKey, snapSec);");
    expect(src).toContain("notes: moveNote(notes, note.id, action.start, action.pitch)");
    expect(src).toContain("notes: resizeNote(notes, note.id, action.duration)");
  });
  it("one deleteNote serves the button, the context menu and the keyboard", () => {
    expect(src.match(/deleteNote\(/g)?.length).toBeGreaterThanOrEqual(4); // def + 3 call sites
    expect(src).toContain("onClick={() => deleteNote(selected.id)}");
  });
  it("moves are announced on a polite live region and the hint teaches the keys", () => {
    expect(src).toContain('aria-live="polite"');
    expect(src).toContain("Shift+arrows resize it, Delete removes it, Enter plays it");
  });
});
