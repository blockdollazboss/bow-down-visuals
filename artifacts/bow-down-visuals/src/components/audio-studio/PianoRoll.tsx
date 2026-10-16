/* ── Piano roll v1 (Stack 6 #7) ──────────────────────────────────────────
 * Place / move / resize / delete notes for one MIDI track, audition them
 * through the bundled synth voices, record from a WebMIDI keyboard where
 * the browser offers one (honest absence state where it doesn't), and
 * export the part as a .mid. Playback inside the arrangement runs through
 * the same synth via an offline bounce — what you hear is what exports. */

import { useEffect, useRef, useState } from "react";
import { Circle, Download, KeyboardMusic, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  MIDI_INSTRUMENTS,
  arrangementUid,
  clampNote,
  moveNote,
  resizeNote,
  type ArrangementTrack,
  type MidiRollNote,
} from "@/lib/arrangement";
import { auditionNote } from "@/lib/midi-synth";
import { downloadMidiPolyphonic } from "@/lib/midi-export";
import { openWebMidi, pairRecordedNotes, webMidiSupported, type WebMidiNoteEvent, type WebMidiSession } from "@/lib/web-midi";

const HIGH_PITCH = 84; // C6
const LOW_PITCH = 36; // C2
const ROW_H = 14;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function pitchLabel(pitch: number): string {
  return `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

interface PianoRollProps {
  track: ArrangementTrack;
  bpm: number;
  pxPerSec: number;
  durationSec: number;
  onChange: (track: ArrangementTrack) => void;
}

export function PianoRoll({ track, bpm, pxPerSec, durationSec, onChange }: PianoRollProps) {
  const notes = track.notes ?? [];
  const instrument = track.instrument ?? "keys";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordedCount, setRecordedCount] = useState(0);
  const [midiState, setMidiState] = useState<"idle" | "unavailable" | "ready">("idle");
  const gridRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<WebMidiSession | null>(null);
  const eventsRef = useRef<WebMidiNoteEvent[]>([]);
  const recordStartRef = useRef(0);
  const dragRef = useRef<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    orig: MidiRollNote;
    moved: boolean;
  } | null>(null);

  const beatSec = 60 / Math.max(30, bpm);
  const snapSec = beatSec / 2;
  const width = Math.max(600, durationSec * pxPerSec);
  const selected = notes.find((n) => n.id === selectedId) ?? null;
  const supported = webMidiSupported();

  useEffect(() => {
    return () => sessionRef.current?.close();
  }, []);

  function gridPos(e: React.PointerEvent): { time: number; pitch: number } {
    const rect = gridRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return {
      time: Math.max(0, x / pxPerSec),
      pitch: Math.min(HIGH_PITCH, Math.max(LOW_PITCH, HIGH_PITCH - Math.floor(y / ROW_H))),
    };
  }

  function addNoteAt(time: number, pitch: number) {
    const start = Math.round(time / snapSec) * snapSec;
    const note = clampNote({
      id: arrangementUid("note"),
      pitch,
      start,
      duration: snapSec * 2,
      velocity: 100,
    });
    onChange({ ...track, notes: [...notes, note] });
    setSelectedId(note.id);
    auditionNote(instrument, note.pitch, note.velocity);
  }

  function handleGridPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const { time, pitch } = gridPos(e);
    addNoteAt(time, pitch);
  }

  function handleNotePointerDown(e: React.PointerEvent, note: MidiRollNote) {
    e.stopPropagation();
    if (e.button === 2) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const onEdge = e.clientX > rect.right - 7;
    dragRef.current = {
      id: note.id,
      mode: onEdge ? "resize" : "move",
      startX: e.clientX,
      startY: e.clientY,
      orig: note,
      moved: false,
    };
    setSelectedId(note.id);
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }

  function handleNotePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / pxPerSec;
    const dy = Math.round((drag.startY - e.clientY) / ROW_H);
    if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 3) drag.moved = true;
    if (!drag.moved) return;
    if (drag.mode === "move") {
      const start = Math.round((drag.orig.start + dx) / snapSec) * snapSec;
      onChange({ ...track, notes: moveNote(notes, drag.id, Math.max(0, start), drag.orig.pitch + dy) });
    } else {
      onChange({ ...track, notes: resizeNote(notes, drag.id, Math.max(snapSec / 2, drag.orig.duration + dx)) });
    }
  }

  function handleNotePointerUp(e: React.PointerEvent) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && !drag.moved) {
      const note = notes.find((n) => n.id === drag.id);
      if (note) auditionNote(instrument, note.pitch, note.velocity);
    }
    void e;
  }

  async function toggleRecord() {
    if (recording) {
      sessionRef.current?.close();
      sessionRef.current = null;
      setRecording(false);
      const paired = pairRecordedNotes(eventsRef.current, recordStartRef.current);
      if (paired.length > 0) {
        const fresh = paired.map((p) => clampNote({ id: arrangementUid("note"), ...p }));
        onChange({ ...track, notes: [...notes, ...fresh] });
      }
      eventsRef.current = [];
      setRecordedCount(0);
      return;
    }
    if (!supported) {
      setMidiState("unavailable");
      return;
    }
    const session = await openWebMidi((ev) => {
      eventsRef.current.push(ev);
      if (ev.kind === "on") {
        setRecordedCount((c) => c + 1);
        auditionNote(instrument, ev.pitch, ev.velocity);
      }
    });
    if (!session) {
      setMidiState("unavailable");
      return;
    }
    sessionRef.current = session;
    setMidiState("ready");
    eventsRef.current = [];
    recordStartRef.current = performance.now();
    setRecording(true);
  }

  function exportMidi() {
    downloadMidiPolyphonic(
      notes.map((n) => ({ midi: n.pitch, startSec: n.start, durationSec: n.duration, velocity: n.velocity })),
      bpm,
      track.name,
    );
  }

  const rows = [];
  for (let p = HIGH_PITCH; p >= LOW_PITCH; p--) rows.push(p);
  const beats = Math.ceil(durationSec / beatSec);

  return (
    <div className="space-y-3" data-testid="piano-roll">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {MIDI_INSTRUMENTS.map((inst) => (
            <button
              key={inst.id}
              type="button"
              onClick={() => onChange({ ...track, instrument: inst.id })}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                instrument === inst.id ? "bg-primary text-black" : "bg-white/[0.04] text-white/55 hover:text-white"
              }`}
              data-testid={`roll-instrument-${inst.id}`}
            >
              {inst.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={toggleRecord}
            className={`h-8 text-[11px] font-bold border-white/12 bg-white/[0.03] ${recording ? "text-red-300 border-red-400/40" : "text-white/75"}`}
            data-testid="btn-midi-record"
          >
            {recording ? <Square className="h-3.5 w-3.5 mr-1.5" /> : <Circle className="h-3.5 w-3.5 mr-1.5" />}
            {recording ? `Recording… ${recordedCount} notes` : "Record MIDI"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={exportMidi}
            disabled={notes.length === 0}
            className="h-8 text-[11px] font-bold border-white/12 bg-white/[0.03] text-white/75"
            data-testid="btn-midi-export"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" /> Export .mid
          </Button>
        </div>
      </div>

      {!supported || midiState === "unavailable" ? (
        <p className="flex items-start gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10 text-[11px] text-white/50 leading-relaxed" data-testid="midi-absence">
          <KeyboardMusic className="h-3.5 w-3.5 text-white/40 shrink-0 mt-0.5" />
          {supported
            ? "No MIDI keyboard answered — check the connection and try Record again. You can still write notes by hand below."
            : "MIDI keyboard input isn't available in this browser, so hardware recording is off. You can still write every note by hand below — click the grid to place a note."}
        </p>
      ) : null}

      <div className="flex gap-0 overflow-auto rounded-xl border border-white/[0.08] max-h-[340px]" data-testid="roll-scroll">
        {/* Pitch labels */}
        <div className="sticky left-0 z-10 shrink-0 w-10 bg-[#171208]">
          {rows.map((p) => (
            <div
              key={p}
              className={`flex items-center justify-end pr-1.5 text-[9px] font-mono ${p % 12 === 0 ? "text-amber-300/90" : "text-white/30"}`}
              style={{ height: ROW_H }}
            >
              {p % 12 === 0 ? pitchLabel(p) : ""}
            </div>
          ))}
        </div>
        {/* Grid */}
        <div
          ref={gridRef}
          className="relative shrink-0 cursor-crosshair"
          style={{ width, height: rows.length * ROW_H }}
          onPointerDown={handleGridPointerDown}
          data-testid="roll-grid"
        >
          {/* beat + bar lines and row shading */}
          {rows.map((p) => (
            <div
              key={p}
              className={`absolute left-0 right-0 border-b border-white/[0.04] ${[1, 3, 6, 8, 10].includes(p % 12) ? "bg-black/40" : ""}`}
              style={{ top: (HIGH_PITCH - p) * ROW_H, height: ROW_H }}
            />
          ))}
          {Array.from({ length: beats + 1 }, (_, i) => (
            <div
              key={i}
              className={`absolute top-0 bottom-0 ${i % 4 === 0 ? "bg-white/[0.14]" : "bg-white/[0.05]"}`}
              style={{ left: i * beatSec * pxPerSec, width: 1 }}
            />
          ))}
          {notes.map((note) => {
            const top = (HIGH_PITCH - note.pitch) * ROW_H + 1;
            const left = note.start * pxPerSec;
            const w = Math.max(6, note.duration * pxPerSec - 1);
            const isSel = note.id === selectedId;
            return (
              <div
                key={note.id}
                className={`absolute rounded-[3px] cursor-grab active:cursor-grabbing ${isSel ? "bg-amber-300 ring-1 ring-amber-100" : "bg-primary/85 hover:bg-primary"}`}
                style={{ top, left, width: w, height: ROW_H - 2, opacity: 0.45 + (note.velocity / 127) * 0.55 }}
                onPointerDown={(e) => handleNotePointerDown(e, note)}
                onPointerMove={handleNotePointerMove}
                onPointerUp={handleNotePointerUp}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onChange({ ...track, notes: notes.filter((n) => n.id !== note.id) });
                  if (selectedId === note.id) setSelectedId(null);
                }}
                data-testid={`roll-note-${note.id}`}
                title={`${pitchLabel(note.pitch)} · right-click deletes`}
              >
                <div className="absolute right-0 top-0 bottom-0 w-[6px] cursor-ew-resize" />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <p className="text-[11px] text-white/40">
          Click the grid to place a note · drag to move · drag the right edge to resize · right-click a note to delete it.
          Notes play through the {MIDI_INSTRUMENTS.find((i) => i.id === instrument)?.label} voice — synthesized in your browser, no samples.
        </p>
        {selected && (
          <div className="flex items-center gap-3 ml-auto">
            <span className="text-[11px] font-bold text-white/70">{pitchLabel(selected.pitch)}</span>
            <span className="text-[10px] text-white/40">Velocity {selected.velocity}</span>
            <div className="w-28">
              <Slider
                value={[selected.velocity]}
                min={1}
                max={127}
                step={1}
                onValueChange={([v]) =>
                  onChange({ ...track, notes: notes.map((n) => (n.id === selected.id ? clampNote({ ...n, velocity: v ?? 100 }) : n)) })
                }
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onChange({ ...track, notes: notes.filter((n) => n.id !== selected.id) });
                setSelectedId(null);
              }}
              className="h-8 text-[11px] font-bold border-white/12 bg-white/[0.03] text-red-300"
              data-testid="btn-note-delete"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete note
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
