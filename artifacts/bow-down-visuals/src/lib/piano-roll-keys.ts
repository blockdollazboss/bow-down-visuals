/* ── Piano roll keyboard editing (stack1000 M5) ──────────────────────────
 * The key → target mapping for a focused roll note. The component feeds
 * the returned targets through the SAME state functions its pointer path
 * calls (moveNote / resizeNote / the shared delete), and every target is
 * computed with the pointer formulas verbatim: a time move rounds
 * (start ± snap) back onto the grid just like a one-cell drag, a resize
 * floors at snapSec / 2 just like the edge drag. The one deliberate
 * difference: pitch clamps to the roll's own visible range (C2..C6) —
 * a keyboard move can never push a note off the grid the way a long
 * pointer drag can. */

import type { MidiRollNote } from "@/lib/arrangement";

/** The roll's visible pitch range (mirrors PianoRoll's row bounds). */
const ROLL_LOW_PITCH = 36; // C2
const ROLL_HIGH_PITCH = 84; // C6

type NoteKeyAction =
  | { type: "move"; start: number; pitch: number }
  | { type: "resize"; duration: number }
  | { type: "delete" }
  | { type: "audition" }
  | null;

export function noteKeyAction(
  note: MidiRollNote,
  key: string,
  shiftKey: boolean,
  snapSec: number,
): NoteKeyAction {
  switch (key) {
    case "ArrowUp":
      return { type: "move", start: note.start, pitch: Math.min(ROLL_HIGH_PITCH, note.pitch + 1) };
    case "ArrowDown":
      return { type: "move", start: note.start, pitch: Math.max(ROLL_LOW_PITCH, note.pitch - 1) };
    case "ArrowLeft":
      if (shiftKey) return { type: "resize", duration: Math.max(snapSec / 2, note.duration - snapSec) };
      return { type: "move", start: Math.max(0, Math.round((note.start - snapSec) / snapSec) * snapSec), pitch: note.pitch };
    case "ArrowRight":
      if (shiftKey) return { type: "resize", duration: Math.max(snapSec / 2, note.duration + snapSec) };
      return { type: "move", start: Math.max(0, Math.round((note.start + snapSec) / snapSec) * snapSec), pitch: note.pitch };
    case "Delete":
    case "Backspace":
      return { type: "delete" };
    case "Enter":
    case " ":
      return { type: "audition" };
    default:
      return null;
  }
}
