/* ── Beat Studio melodic piano roll (W1-L2) ──────────────────────────────
 * The sequencer's melodic editor: place / move / resize / delete notes on
 * a 16-step grid for the Keys, Pluck and Pad voices. Interaction patterns
 * follow the Audio Studio piano roll (components/audio-studio/PianoRoll):
 * click the grid to place, drag to move, drag the right edge to resize,
 * right-click deletes, velocity is shown as note opacity and adjusted on
 * the selected note, and a full keyboard path mirrors the pointer path.
 * Notes are step-based (lib/beat-melody) and sound through the same
 * midi-synth voices the arrangement roll uses — no second note engine. */

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { pitchLabel } from "@/components/audio-studio/PianoRoll";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { auditionNote } from "@/lib/midi-synth";
import {
  BEAT_MELODIC_VOICES,
  BEAT_MELODY_HI,
  BEAT_MELODY_LO,
  BEAT_MELODY_STEPS,
  addBeatNote,
  beatMelodyUid,
  moveBeatNote,
  removeBeatNote,
  resizeBeatNote,
  setBeatNoteVelocity,
  withBeatLane,
  type BeatMelodicVoiceId,
  type BeatMelodyLanes,
  type BeatMelodyNote,
} from "@/lib/beat-melody";
import {
  BEAT_QUANTIZE_GRIDS,
  BEAT_QUANTIZE_STRENGTHS,
  quantizeBeatNotes,
  type BeatQuantizeGridId,
} from "@/lib/beat-feel";

const ROW_H = 14;
const STEP_W = 36;
const VOICE_FILL: Record<BeatMelodicVoiceId, string> = {
  keys: "bg-amber-400",
  pluck: "bg-sky-400",
  pad: "bg-violet-400",
};
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

interface BeatMelodyRollProps {
  melody: BeatMelodyLanes;
  onChange: (melody: BeatMelodyLanes) => void;
  /** Transport highlight: current step while playing, -1 when stopped. */
  currentStep: number;
  playing: boolean;
}

export function BeatMelodyRoll({ melody, onChange, currentStep, playing }: BeatMelodyRollProps) {
  const isLight = useIsLightTheme();
  const [voice, setVoice] = useState<BeatMelodicVoiceId>("keys");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  /* Quantize (stack1500): grid + pull strength for the Apply action
   * below — an ordinary edit through onChange, so the page's save
   * flow persists it like any note move (lib/beat-feel). */
  const [qGrid, setQGrid] = useState<BeatQuantizeGridId>("16");
  const [qStrength, setQStrength] = useState<number>(1);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    orig: BeatMelodyNote;
    moved: boolean;
  } | null>(null);

  const notes = melody[voice];
  const selected = notes.find((n) => n.id === selectedId) ?? null;
  const width = BEAT_MELODY_STEPS * STEP_W;
  const rows: number[] = [];
  for (let p = BEAT_MELODY_HI; p >= BEAT_MELODY_LO; p--) rows.push(p);

  const setLane = (next: BeatMelodyNote[]) => onChange(withBeatLane(melody, voice, next));

  function gridPos(e: React.PointerEvent): { step: number; pitch: number } {
    const rect = gridRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return {
      step: Math.min(15.5, Math.max(0, Math.round((x / STEP_W) * 2) / 2)),
      pitch: Math.min(BEAT_MELODY_HI, Math.max(BEAT_MELODY_LO, BEAT_MELODY_HI - Math.floor(y / ROW_H))),
    };
  }

  function addNoteAt(step: number, pitch: number) {
    const note: BeatMelodyNote = {
      id: beatMelodyUid(),
      pitch,
      startStep: step,
      lengthSteps: 1,
      velocity: 100,
    };
    setLane(addBeatNote(notes, note));
    setSelectedId(note.id);
    setAnnounce(`${pitchLabel(pitch)} placed at step ${step + 1}`);
    auditionNote(voice, pitch, note.velocity);
  }

  function deleteNote(id: string) {
    setLane(removeBeatNote(notes, id));
    if (selectedId === id) setSelectedId(null);
  }

  /* Quantize applies to the selected note when one is selected, else
   * to every note in the current voice — the scope line under the
   * controls says which, before the click. Starts only. */
  function applyQuantize() {
    const grid = BEAT_QUANTIZE_GRIDS.find((g) => g.id === qGrid) ?? BEAT_QUANTIZE_GRIDS[0]!;
    setLane(
      quantizeBeatNotes(notes, {
        gridSteps: grid.steps,
        strength: qStrength,
        onlyIds: selected ? [selected.id] : null,
      }),
    );
    setAnnounce(
      selected
        ? `Quantized the selected note toward the ${grid.label} grid`
        : `Quantized the ${voice} notes toward the ${grid.label} grid`,
    );
  }

  function handleGridPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const { step, pitch } = gridPos(e);
    addNoteAt(step, pitch);
  }

  function handleNotePointerDown(e: React.PointerEvent, note: BeatMelodyNote) {
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
    if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 3) drag.moved = true;
    if (!drag.moved) return;
    if (drag.mode === "move") {
      const dSteps = Math.round(((e.clientX - drag.startX) / STEP_W) * 2) / 2;
      const dPitch = Math.round((drag.startY - e.clientY) / ROW_H);
      setLane(moveBeatNote(notes, drag.id, drag.orig.startStep + dSteps, drag.orig.pitch + dPitch));
    } else {
      const dSteps = Math.round(((e.clientX - drag.startX) / STEP_W) * 2) / 2;
      setLane(resizeBeatNote(notes, drag.id, drag.orig.lengthSteps + dSteps));
    }
  }

  function handleNotePointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && !drag.moved) {
      const note = notes.find((n) => n.id === drag.id);
      if (note) auditionNote(voice, note.pitch, note.velocity);
    }
  }

  /* Keyboard path — same lib ops as the pointer handlers. Arrows move,
   * Shift+arrows resize, Delete removes, Enter plays. */
  function handleNoteKeyDown(e: React.KeyboardEvent, note: BeatMelodyNote) {
    const stepBy = e.shiftKey ? 0 : e.key === "ArrowRight" ? 0.5 : e.key === "ArrowLeft" ? -0.5 : 0;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteNote(note.id);
      setAnnounce(`${pitchLabel(note.pitch)} note deleted`);
    } else if (e.key === "Enter") {
      e.preventDefault();
      auditionNote(voice, note.pitch, note.velocity);
    } else if (e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      const len = note.lengthSteps + (e.key === "ArrowRight" ? 0.5 : -0.5);
      setLane(resizeBeatNote(notes, note.id, len));
      setAnnounce(`${pitchLabel(note.pitch)}, length ${len} steps`);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const pitch = note.pitch + (e.key === "ArrowUp" ? 1 : -1);
      setLane(moveBeatNote(notes, note.id, note.startStep, pitch));
      auditionNote(voice, Math.min(BEAT_MELODY_HI, Math.max(BEAT_MELODY_LO, pitch)), note.velocity);
      setAnnounce(pitchLabel(Math.min(BEAT_MELODY_HI, Math.max(BEAT_MELODY_LO, pitch))));
    } else if (stepBy !== 0) {
      e.preventDefault();
      setLane(moveBeatNote(notes, note.id, note.startStep + stepBy, note.pitch));
      setAnnounce(`${pitchLabel(note.pitch)}, step ${note.startStep + stepBy + 1}`);
    }
  }

  const panel = isLight
    ? "border-[#c9a84c]/25 bg-[#8a6d2f]/[0.04]"
    : "border-white/10 bg-black/30";
  const labelCls = isLight ? "text-[#4A3B22]/70" : "text-white/60";
  const dimCls = isLight ? "text-[#4A3B22]/50" : "text-white/40";
  const tabOff = isLight
    ? "border-[#c9a84c]/30 text-[#4A3B22] hover:border-[#c9a84c]/60"
    : "border-white/15 text-white/60 hover:border-white/30 hover:text-white";

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${panel}`} data-testid="beat-melody-roll">
      <div className="flex flex-wrap items-center gap-2">
        <p className={`text-xs font-black uppercase tracking-wider ${labelCls}`}>
          Melody
          <span className={`ml-2 font-medium normal-case ${dimCls}`}>
            Pick a voice, click the grid to write notes — they play with the beat and export in the WAV.
          </span>
        </p>
        <div className="ml-auto flex items-center gap-1.5">
          {BEAT_MELODIC_VOICES.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => { setVoice(v.id); setSelectedId(null); }}
              className={`px-3 py-1.5 rounded-full text-xs border font-bold transition-colors ${
                voice === v.id ? "bg-primary text-black border-transparent" : tabOff
              }`}
              data-testid={`beat-melody-voice-${v.id}`}
              aria-pressed={voice === v.id}
            >
              {v.label}
              {melody[v.id].length > 0 && <span className="ml-1.5 tabular-nums opacity-70">{melody[v.id].length}</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setLane([]); setSelectedId(null); }}
            disabled={notes.length === 0}
            className={`px-3 py-1.5 rounded-full text-xs border flex items-center gap-1.5 transition-colors disabled:opacity-40 ${tabOff}`}
            data-testid="btn-beat-melody-clear-lane"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear voice
          </button>
        </div>
      </div>

      <div
        className={`flex gap-0 overflow-auto rounded-xl max-h-[300px] ${isLight ? "border border-[#c9a84c]/25" : "border border-white/[0.08]"}`}
        data-testid="beat-melody-scroll"
      >
        {/* Pitch labels */}
        <div className={`sticky left-0 z-10 shrink-0 w-10 ${isLight ? "bg-[#F7F1E3]" : "bg-[#171208]"}`}>
          {rows.map((p) => (
            <div
              key={p}
              className={`flex items-center justify-end pr-1.5 text-[9px] font-mono ${
                p % 12 === 0 ? "text-[#C9A84C] font-bold" : isLight ? "text-[#4A3B22]/40" : "text-white/30"
              }`}
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
          data-testid="beat-melody-grid"
        >
          {rows.map((p) => (
            <div
              key={p}
              className={`absolute left-0 right-0 border-b ${
                isLight
                  ? `border-[#8a6d2f]/10 ${BLACK_KEYS.has(p % 12) ? "bg-[#2A2118]/[0.05]" : ""}`
                  : `border-white/[0.04] ${BLACK_KEYS.has(p % 12) ? "bg-black/40" : ""}`
              }`}
              style={{ top: (BEAT_MELODY_HI - p) * ROW_H, height: ROW_H }}
            />
          ))}
          {Array.from({ length: BEAT_MELODY_STEPS + 1 }, (_, i) => (
            <div
              key={i}
              className={`absolute top-0 bottom-0 ${
                playing && currentStep === i
                  ? "bg-[#C9A84C]/70"
                  : i % 4 === 0
                    ? isLight ? "bg-[#8a6d2f]/25" : "bg-white/[0.14]"
                    : isLight ? "bg-[#8a6d2f]/10" : "bg-white/[0.05]"
              }`}
              style={{ left: i * STEP_W, width: 1 }}
            />
          ))}
          {notes.map((note) => {
            const top = (BEAT_MELODY_HI - note.pitch) * ROW_H + 1;
            const left = note.startStep * STEP_W;
            const w = Math.max(8, note.lengthSteps * STEP_W - 1);
            const isSel = note.id === selectedId;
            return (
              <div
                key={note.id}
                className={`absolute rounded-[3px] cursor-grab active:cursor-grabbing ${VOICE_FILL[voice]} ${
                  isSel ? "ring-2 ring-[#C9A84C] ring-offset-0 z-10" : ""
                }`}
                style={{ top, left, width: w, height: ROW_H - 2, opacity: 0.45 + (note.velocity / 127) * 0.55 }}
                onPointerDown={(e) => handleNotePointerDown(e, note)}
                onPointerMove={handleNotePointerMove}
                onPointerUp={handleNotePointerUp}
                onContextMenu={(e) => { e.preventDefault(); deleteNote(note.id); }}
                tabIndex={0}
                role="button"
                aria-label={`${pitchLabel(note.pitch)} note, step ${note.startStep + 1}, length ${note.lengthSteps} steps, velocity ${note.velocity}`}
                onFocus={() => setSelectedId(note.id)}
                onKeyDown={(e) => handleNoteKeyDown(e, note)}
                data-testid={`beat-melody-note-${note.id}`}
                title={`${pitchLabel(note.pitch)} · velocity ${note.velocity} · right-click deletes`}
              >
                <div className="absolute right-0 top-0 bottom-0 w-[6px] cursor-ew-resize" />
              </div>
            );
          })}
        </div>
      </div>

      {/* Quantize row (stack1500): pick a grid + how hard to pull, then
          Apply. Melody notes are the sequencer's only sub-step events,
          so this is where quantize lives; it moves note starts only. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="beat-melody-quantize">
        <span className={`text-[11px] font-bold uppercase tracking-wider ${labelCls}`}>Quantize</span>
        <div className="flex items-center gap-1.5">
          {BEAT_QUANTIZE_GRIDS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setQGrid(g.id)}
              aria-pressed={qGrid === g.id}
              data-testid={`beat-quantize-grid-${g.id}`}
              className={`px-2.5 py-1 rounded-full text-[11px] border font-bold transition-colors ${
                qGrid === g.id ? "bg-primary text-black border-transparent" : tabOff
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {BEAT_QUANTIZE_STRENGTHS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setQStrength(s)}
              aria-pressed={qStrength === s}
              data-testid={`beat-quantize-strength-${Math.round(s * 100)}`}
              className={`px-2.5 py-1 rounded-full text-[11px] border font-bold transition-colors ${
                qStrength === s ? "bg-primary text-black border-transparent" : tabOff
              }`}
            >
              {Math.round(s * 100)}%
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={applyQuantize}
          disabled={notes.length === 0}
          data-testid="btn-beat-quantize-apply"
          className="px-3 py-1.5 rounded-full text-xs border font-bold transition-colors bg-primary text-black border-transparent disabled:opacity-40"
          title="Pull note starts toward the grid — lengths stay as written"
        >
          Apply
        </button>
        <span className={`text-[10px] ${dimCls}`}>
          {selected
            ? "Applies to the selected note · starts only"
            : `Applies to all ${voice} notes · starts only`}
        </span>
      </div>

      <div aria-live="polite" className="sr-only">{announce}</div>

      <div className="flex flex-wrap items-center gap-4">
        <p className={`text-[11px] ${dimCls}`}>
          Click the grid to place a note · drag to move · drag the right edge to resize · right-click a note to delete it.
          Keyboard: focus a note, then arrow keys move it, Shift+arrows resize it, Delete removes it, Enter plays it.
        </p>
        {selected && (
          <div className="flex items-center gap-3 ml-auto">
            <span className={`text-[11px] font-bold ${labelCls}`}>{pitchLabel(selected.pitch)}</span>
            <span className={`text-[10px] ${dimCls}`}>Velocity {selected.velocity}</span>
            <input
              type="range"
              min={1}
              max={127}
              step={1}
              value={selected.velocity}
              onChange={(e) => setLane(setBeatNoteVelocity(notes, selected.id, Number(e.target.value)))}
              className="w-28 accent-[#C9A84C]"
              aria-label="Note velocity"
              data-testid="beat-melody-velocity"
            />
            <button
              type="button"
              onClick={() => deleteNote(selected.id)}
              className={`px-3 py-1.5 rounded-full text-xs border flex items-center gap-1.5 transition-colors ${tabOff} hover:!border-red-400/60`}
              data-testid="btn-beat-melody-note-delete"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete note
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
