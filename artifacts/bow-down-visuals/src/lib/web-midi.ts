/* ── WebMIDI input (Stack 6 #7) ─────────────────────────────────────────
 * Optional hardware input for the piano roll. Support is genuinely uneven
 * (Chromium yes; Safari/Firefox mostly no), so the surface reports an
 * honest absence state instead of pretending. This module never throws:
 * callers get a status object. */

export interface WebMidiNoteEvent {
  pitch: number;
  velocity: number;
  /** performance.now() timestamp of the event. */
  timeMs: number;
  kind: "on" | "off";
}

export interface WebMidiSession {
  /** Names of connected input devices. */
  inputs: string[];
  /** Stop listening and release the access object. */
  close: () => void;
}

export function webMidiSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";
}

export async function openWebMidi(
  onEvent: (e: WebMidiNoteEvent) => void,
): Promise<WebMidiSession | null> {
  if (!webMidiSupported()) return null;
  try {
    const access = await navigator.requestMIDIAccess();
    const inputs: string[] = [];
    const handler = (e: MIDIMessageEvent) => {
      const data = e.data;
      if (!data || data.length < 3) return;
      const status = data[0]! & 0xf0;
      const pitch = data[1]!;
      const velocity = data[2]!;
      if (status === 0x90 && velocity > 0) {
        onEvent({ pitch, velocity, timeMs: performance.now(), kind: "on" });
      } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
        onEvent({ pitch, velocity: 0, timeMs: performance.now(), kind: "off" });
      }
    };
    access.inputs.forEach((input) => {
      inputs.push(input.name ?? "MIDI device");
      input.onmidimessage = handler;
    });
    return {
      inputs,
      close: () => {
        access.inputs.forEach((input) => {
          input.onmidimessage = null;
        });
      },
    };
  } catch {
    return null;
  }
}

/** Pair note on/off events into recorded notes (seconds, record-relative). */
export function pairRecordedNotes(
  events: WebMidiNoteEvent[],
  recordStartMs: number,
): Array<{ pitch: number; start: number; duration: number; velocity: number }> {
  const open = new Map<number, { start: number; velocity: number }>();
  const out: Array<{ pitch: number; start: number; duration: number; velocity: number }> = [];
  const sorted = [...events].sort((a, b) => a.timeMs - b.timeMs);
  for (const e of sorted) {
    const t = Math.max(0, (e.timeMs - recordStartMs) / 1000);
    if (e.kind === "on") {
      open.set(e.pitch, { start: t, velocity: e.velocity });
    } else {
      const started = open.get(e.pitch);
      if (started) {
        out.push({
          pitch: e.pitch,
          start: Math.round(started.start * 1000) / 1000,
          duration: Math.max(0.05, Math.round((t - started.start) * 1000) / 1000),
          velocity: started.velocity,
        });
        open.delete(e.pitch);
      }
    }
  }
  /* Notes still held when recording stops get a default bar length. */
  for (const [pitch, started] of open.entries()) {
    out.push({
      pitch,
      start: Math.round(started.start * 1000) / 1000,
      duration: 0.5,
      velocity: started.velocity,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}
