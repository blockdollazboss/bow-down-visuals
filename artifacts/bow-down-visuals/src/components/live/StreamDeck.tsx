/**
 * StreamDeck — the Stream Controller's button grid. ONE component,
 * two homes: docked inside the Broadcast studio (drives the studio's
 * own state directly) and on the phone remote page (drives it over
 * the relay). Buttons render CONFIRMED state only — a press lights a
 * pending beat until the studio's state confirms it; nothing fakes.
 *
 * data-dark-lock: the deck is a control surface with its own dark
 * styling in both themes (same call as the chat panel).
 */
import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Circle,
  Loader2,
  Mic,
  MicOff,
  Radio,
  Scissors,
  Square,
  Wand2,
} from "lucide-react";
import { micReadout, type ControllerCommand, type ControllerState } from "@/lib/stream-controller";

export interface StreamDeckProps {
  /** Confirmed studio state; null = no studio state yet. */
  state: ControllerState | null;
  /** Commands can actually be delivered right now. */
  canControl: boolean;
  /** Why not — shown over the disabled deck (honest empty state). */
  unavailableNote?: string | null;
  /** A command is waiting on its confirm (remote ack beat). */
  isPending?: (command: ControllerCommand, sceneId?: string) => boolean;
  /** Transient honest notice ("didn't go through…"). */
  notice?: string | null;
  onCommand: (command: ControllerCommand, args?: Record<string, unknown>) => void;
}

const HOLD_MS = 900;

export default function StreamDeck({ state, canControl, unavailableNote, isPending, notice, onCommand }: StreamDeckProps) {
  const disabled = !canControl || !state;
  const pending = (cmd: ControllerCommand, sceneId?: string) => !!isPending?.(cmd, sceneId);
  /* Mic truth: no real mic input in the state ⇒ "Off". Only a
     present, unmuted mic may read "Live" (micReadout's law). */
  const mic = micReadout(state);

  /* End Stream is press-and-hold — ending a broadcast is the one
     button a stray tap must never fire. */
  const [holdPct, setHoldPct] = useState(0);
  const holdTimer = useRef<number | null>(null);
  const holdStart = useRef(0);

  const stopHold = () => {
    if (holdTimer.current) window.clearInterval(holdTimer.current);
    holdTimer.current = null;
    setHoldPct(0);
  };
  const startHold = () => {
    if (disabled || !state?.live) return;
    holdStart.current = Date.now();
    holdTimer.current = window.setInterval(() => {
      const pct = Math.min(1, (Date.now() - holdStart.current) / HOLD_MS);
      setHoldPct(pct);
      if (pct >= 1) {
        stopHold();
        onCommand("stream.end");
      }
    }, 30);
  };
  useEffect(() => stopHold, []);

  const tile =
    "relative flex min-h-[76px] flex-col items-center justify-center gap-1.5 overflow-hidden rounded-2xl border px-2 py-3 text-center transition-colors select-none touch-manipulation";
  const tileIdle = "border-white/10 bg-white/[0.04] text-white/80 active:bg-white/[0.09]";
  const tileOff = "cursor-not-allowed opacity-40";

  return (
    <div className="w-full" data-dark-lock>
      {notice && (
        <p className="mb-3 rounded-lg border border-red-300/25 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200" role="status">
          {notice}
        </p>
      )}

      {/* Scenes */}
      <p className="text-[11px] font-black uppercase tracking-widest text-[#fbbf24]/80">Scenes</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {(state?.scenes ?? []).map((scene) => {
          const isProgram = state?.activeSceneId === scene.id;
          const isPreview = state?.previewSceneId === scene.id && !isProgram;
          const isP = pending("scene.select", scene.id);
          return (
            <button
              key={scene.id}
              type="button"
              disabled={disabled}
              onClick={() => onCommand("scene.select", { sceneId: scene.id })}
              data-testid={`deck-scene-${scene.id}`}
              className={`${tile} ${disabled ? tileOff : ""} ${
                isProgram
                  ? "border-[#fbbf24] bg-gradient-to-b from-[#fbbf24]/25 to-[#fbbf24]/10 text-[#fde68a]"
                  : isPreview
                    ? "border-emerald-300/50 text-emerald-200"
                    : tileIdle
              }`}
            >
              <span className="line-clamp-2 text-sm font-bold leading-tight">{scene.name}</span>
              <span className="text-[10px] font-black uppercase tracking-widest opacity-70">
                {isP ? "Sending…" : isProgram ? "On air" : isPreview ? "Preview" : "Tap to air"}
              </span>
              {isP && <Loader2 className="absolute right-2 top-2 h-3.5 w-3.5 animate-spin" />}
            </button>
          );
        })}
        {state && state.scenes.length === 0 && (
          <p className="col-span-full text-xs text-white/40">No scenes in the studio yet.</p>
        )}
        {!state && <p className="col-span-full text-xs text-white/40">Waiting for the studio…</p>}
      </div>

      {/* Transitions */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onCommand("transition.cut")}
          data-testid="deck-cut"
          className={`${tile} ${disabled ? tileOff : tileIdle}`}
        >
          <Scissors className="h-5 w-5" />
          <span className="text-sm font-bold">Cut</span>
          <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Preview → air</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onCommand("transition.fade")}
          data-testid="deck-fade"
          className={`${tile} ${disabled ? tileOff : tileIdle}`}
        >
          <Wand2 className="h-5 w-5" />
          <span className="text-sm font-bold">Fade</span>
          <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Preview → air</span>
        </button>
      </div>

      {/* Toggles */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onCommand("mic.toggle")}
          data-testid="deck-mic"
          aria-pressed={mic === "muted"}
          className={`${tile} ${disabled ? tileOff : ""} ${
            mic === "muted" ? "border-red-300/40 bg-red-500/10 text-red-200" : tileIdle
          }`}
        >
          {pending("mic.toggle") ? <Loader2 className="h-5 w-5 animate-spin" /> : mic === "live" ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
          <span className="text-xs font-bold">Mic</span>
          <span className="text-[10px] font-black uppercase tracking-widest opacity-60">{mic === "muted" ? "Muted" : mic === "live" ? "Live" : "Off"}</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onCommand("camera.toggle")}
          data-testid="deck-camera"
          aria-pressed={!!state?.cameraOn}
          className={`${tile} ${disabled ? tileOff : tileIdle}`}
        >
          {pending("camera.toggle") ? <Loader2 className="h-5 w-5 animate-spin" /> : state?.cameraOn ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
          <span className="text-xs font-bold">Camera</span>
          <span className="text-[10px] font-black uppercase tracking-widest opacity-60">{state?.cameraOn ? "On" : "Off"}</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onCommand("record.toggle")}
          data-testid="deck-record"
          aria-pressed={!!state?.recording}
          className={`${tile} ${disabled ? tileOff : ""} ${
            state?.recording ? "border-red-300/40 bg-red-500/10 text-red-200" : tileIdle
          }`}
        >
          {pending("record.toggle") ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Circle className={`h-5 w-5 ${state?.recording ? "fill-red-500 text-red-500" : ""}`} />
          )}
          <span className="text-xs font-bold">Record</span>
          <span className="text-[10px] font-black uppercase tracking-widest opacity-60">{state?.recording ? "Recording" : "Off"}</span>
        </button>
      </div>

      {/* Stream power */}
      <div className="mt-3">
        {state?.live ? (
          <button
            type="button"
            disabled={disabled}
            onPointerDown={startHold}
            onPointerUp={stopHold}
            onPointerLeave={stopHold}
            onContextMenu={(e) => e.preventDefault()}
            data-testid="deck-end"
            className={`relative flex min-h-[64px] w-full items-center justify-center gap-2 overflow-hidden rounded-2xl border border-red-400/50 bg-red-500/10 font-black text-red-200 ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
          >
            <span className="absolute inset-y-0 left-0 bg-red-500/30" style={{ width: `${holdPct * 100}%` }} aria-hidden />
            {pending("stream.end") ? <Loader2 className="h-5 w-5 animate-spin" /> : <Square className="h-5 w-5" />}
            <span className="relative">{holdPct > 0 ? "Keep holding…" : "End Stream — press and hold"}</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onCommand("stream.start")}
            data-testid="deck-go-live"
            className={`flex min-h-[64px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#fbbf24] to-[#d4a017] font-black text-black ${disabled ? "cursor-not-allowed opacity-40" : "hover:brightness-110"}`}
          >
            {pending("stream.start") ? <Loader2 className="h-5 w-5 animate-spin" /> : <Radio className="h-5 w-5" />}
            Go Live
          </button>
        )}
      </div>

      {unavailableNote && (
        <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-xs text-white/50" role="status">
          {unavailableNote}
        </p>
      )}
    </div>
  );
}
