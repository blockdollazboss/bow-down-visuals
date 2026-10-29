import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Radio, Square, Loader2, AlertTriangle, Camera, Mic, Users, Clock,
  Megaphone, Video, CheckCircle2, RotateCcw, MonitorPlay, Wand2,
  Circle, Download, Keyboard, Save, ImagePlus,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { Button } from "@/components/ui/button";
import LiveChatPanel from "@/components/live/LiveChatPanel";
import ChannelModerators from "@/components/live/ChannelModerators";
import StreamAlertOverlay from "@/components/live/StreamAlertOverlay";
import StreamWidgetsPanel from "@/components/live/StreamWidgetsPanel";
import LiveCaptionsStudioPanel from "@/components/live/LiveCaptionsStudioPanel";
import StreamDeck from "@/components/live/StreamDeck";
import {
  ControllerStageClient,
  controllerSocketUrl,
  type ControllerCommand,
  type ControllerSocketLike,
  type ControllerState,
} from "@/lib/stream-controller";
import {
  BackgroundChanger,
  BackgroundChangerError,
  CAMERA_EFFECTS,
  type BackgroundEngineKind,
  type BackgroundMode,
  type BackgroundQuality,
  type EngineStatusDetail,
} from "@/lib/stream-kit/background-changer";
import { VOICE_EFFECTS, type NoiseCancellationLevel } from "@/lib/stream-kit/voice-isolator";
import { BACKDROPS } from "@/lib/stream-kit/backdrops";
import {
  loadGreenScreenFineTune,
  saveGreenScreenFineTune,
  GREENSCREEN_FINETUNE_DEFAULTS,
  type GreenScreenFineTune,
} from "@/lib/stream-kit/greenscreen-finetune";
import {
  backdropSelectionSource,
  greenScreenCueVisible,
  isSelectionActive,
  selectionAfterUpload,
  validateBackdropUpload,
  BACKDROP_UPLOAD_ACCEPT,
  DEFAULT_BACKDROP_SELECTION,
  type BackdropSelection,
} from "@/lib/stream-kit/backdrop-selection";
import {
  WhipTransport,
  OwnServerTransport,
  createStreamTransport,
  TransportError,
  SITE_DESTINATION,
  DESTINATION_PLATFORMS,
  summarizeRtcStats,
  type RtcStatSample,
  type RtcSummary,
  type StreamTransport,
  type TransportState,
} from "@/lib/stream-kit/transport";
import { StreamRecorder } from "@/lib/stream-kit/stream-recorder";
import { Stage, PreviewStage } from "@/lib/stream-kit/stage";
import { refreshStageVaultAvatars } from "@/lib/stream-kit/avatar-vault";
import { fetchVaultCharacters } from "@/lib/world/characters";
import { AudioMixer } from "@/lib/stream-kit/audio-mixer";
import { guestFeeds } from "@/lib/go-live/guest-feeds";
import { registerStudioStage, clearStudioStage, registerStudioMixer, clearStudioMixer } from "@/lib/go-live/studio-bridge";
import type { SceneSource } from "@/lib/stream-kit/scenes";
import ScenesPanel from "./studio/ScenesPanel";
import SourcesPanel from "./studio/SourcesPanel";
import { ClipContextMenu } from "@/components/editor/ClipContextMenu";
import { buildSourceContextItems } from "@/lib/studio-context-menu";
import MixerPanel from "./studio/MixerPanel";

/* ─── Broadcast Studio — the "Broadcast" tab of the /go-live hub ──────────
   Our OBS, in the browser, no downloads:

   - Scenes & sources: a scene list (create/rename/duplicate/delete); each
     scene is a stack of sources — the Live Camera kit (backdrops,
     segmentation, effects, or a real green-screen chroma key), screen /
     window share, image, styled text, color/gradient, a direct media
     URL — each with position/size/opacity/fit/visibility/lock.
   - Studio mode: a Preview canvas to frame the next scene (drag sources
     right on it) and the Program canvas that is actually published,
     with Cut / Fade transitions.
   - Publish runs through a StreamTransport (transport.ts), chosen by
     the server's /status selection: the site's own stage by default
     (chunked publish; the server keeps the replay itself), WHIP when
     the server selects it. The destinations model rides along — v1
     broadcasts to the creator's profile only, and says so.
   - While live on a transport that doesn't keep its own recording, the
     browser records the Program feed (StreamRecorder); on End Stream it
     uploads through the site's storage path and registers on the
     stream — landing in the creator's clips. On the site's own stage
     the published feed IS the recording, so the studio just watches
     for the replay to register. If the recording fails, the stream
     still ends cleanly and the UI says the recording didn't save.
     Going live is free (no credit charge). */

type Phase = "off" | "starting" | "preview" | "connecting" | "live" | "ending";

interface LiveStreamOwnerDto {
  id: string;
  title: string;
  status: string;
  started_at: string | null;
  whip_url: string | null;
}

interface WatchDto {
  viewer_count: number;
  status: string;
  /* Ticketed live (#31): the public door facts ride the watch DTO —
     the studio's live poll reads the sold count from here. */
  ticket?: { price_vb: number; sold: number; seats_left: number | null } | null;
  /* The server-written broadcast start (item 98) — adopted by the
     live poll below so the studio clock and every controller deck
     read the rail's truth, not a local reconstruction. */
  started_at?: string | null;
}

function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/* Voice level meter — fed by the isolator's analyser, so what you see is
   the cleaned signal the audience hears. */
function VoiceMeter({ getAnalyser }: { getAnalyser: () => AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dbRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const data = new Uint8Array(1024);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(201,168,76,.12)";
      ctx.fillRect(0, 0, W, H);
      const analyser = getAnalyser();
      if (!analyser) {
        if (dbRef.current) dbRef.current.textContent = "— dB";
        return;
      }
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i]! - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const db = rms > 0.0001 ? 20 * Math.log10(rms) : -80;
      const frac = Math.max(0, Math.min(1, (db + 60) / 60));
      ctx.fillStyle = "#C9A84C";
      ctx.fillRect(0, 0, W * frac, H);
      if (dbRef.current) dbRef.current.textContent = `${db <= -79 ? "−∞" : db.toFixed(0)} dB`;
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [getAnalyser]);
  return (
    <div className="flex items-center gap-3">
      <canvas ref={canvasRef} width={600} height={14} className="h-3.5 flex-1 rounded-md border border-[#C9A84C]/30 bg-black/50" aria-label="Voice level meter" />
      <span ref={dbRef} className="min-w-[64px] text-right text-xs tabular-nums opacity-60">— dB</span>
    </div>
  );
}

/* The Fine-tune sliders (greenscreen-finetune.ts): every row
   drives ONE real pipeline parameter, live — the module header
   there carries the census of what each one honestly moves.
   `modes` gates the backdrop-specific rows (blur radius exists
   only in Blur mode, backdrop dim only behind a photo). */
const FINE_TUNE_SLIDERS: Array<{
  key: keyof GreenScreenFineTune;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  modes: BackgroundMode[];
  format: (v: number) => string;
}> = [
  {
    key: "sensitivity",
    label: "Cut sensitivity",
    hint: "Up: faint edges stop counting as you. Down: wispy hair and soft edges survive.",
    min: -50,
    max: 50,
    step: 1,
    modes: ["green", "blur", "image"],
    format: (v) => (v > 0 ? `+${v}` : `${v}`),
  },
  {
    key: "edgeShift",
    label: "Edge size",
    hint: "Shrink pulls the cut in — it kills the colour halo. Grow pushes it out — it fills gaps.",
    min: -3,
    max: 3,
    step: 1,
    modes: ["green", "blur", "image"],
    format: (v) => (v > 0 ? `+${v}` : `${v}`),
  },
  {
    key: "softness",
    label: "Edge softness",
    hint: "More softens the rim between you and the background; less makes it crisper.",
    min: -2,
    max: 3,
    step: 1,
    modes: ["green", "blur", "image"],
    format: (v) => (v > 0 ? `+${v}` : `${v}`),
  },
  {
    key: "smoothing",
    label: "Motion smoothing",
    hint: "Up calms edge flicker while you sit still. Down follows fast moves tighter.",
    min: 0,
    max: 100,
    step: 1,
    modes: ["green", "blur", "image"],
    format: (v) => `${v}%`,
  },
  {
    key: "spill",
    label: "Green spill cleanup",
    hint: "Pulls the green fringe off your edges — from the green screen or the room light.",
    min: 0,
    max: 100,
    step: 1,
    modes: ["green", "blur", "image"],
    format: (v) => `${v}%`,
  },
  {
    key: "blur",
    label: "Background blur",
    hint: "How soft the room behind you melts.",
    min: 0,
    max: 40,
    step: 1,
    modes: ["blur"],
    format: (v) => `${v}px`,
  },
  {
    key: "dim",
    label: "Backdrop dim",
    hint: "Darkens the photo behind you so you stand out against it.",
    min: 0,
    max: 85,
    step: 1,
    modes: ["image"],
    format: (v) => `${v}%`,
  },
];

export default function BroadcastStudio() {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("off");
  const [title, setTitle] = useState("");
  /* Ticketed live (Wave 4 #31): the pay-per-view door, set here at
     Go Live setup and fixed for the show — the price and seat cap
     ride the create call and can't change mid-stream. */
  const [ticketed, setTicketed] = useState(false);
  const [ticketPrice, setTicketPrice] = useState("");
  const [ticketCapacity, setTicketCapacity] = useState("");
  /* Creator Classes (#153): a ticketed show can run as a class — the
     ticket IS the enrollment, and the replay is listed as a course
     (draft) when the session's recording lands. */
  const [isClass, setIsClass] = useState(false);
  const [liveTicketsSold, setLiveTicketsSold] = useState(0);
  const [cameras, setCameras] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [mics, setMics] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [cameraId, setCameraId] = useState("");
  const [micId, setMicId] = useState("");
  /* Fresh sessions start on Original (raw): backdrop effects are
     opt-in, so the engine path is never the default path. */
  const [mode, setMode] = useState<BackgroundMode>("none");
  /* True when no background engine could load: the camera runs
     plain and only the AI backdrop modes disable (one inline notice). */
  const [engineDown, setEngineDown] = useState(false);
  /* Background quality the creator picked, and whether the engine
     is actually live — the status line reports the LIVE state, so
     a stalled or failed engine reads Off, never dressed up. */
  const [quality, setQualityState] = useState<BackgroundQuality>("auto");
  const [engineKind, setEngineKind] = useState<BackgroundEngineKind>("off");
  /* The full engine truth from the kit (Stack-100 #3 Lane C): the
     engine ACTUALLY live, whether it is a fallback from the wanted
     Pro engine, and why — rendered verbatim below so a fallback
     reads as a fallback, never as a dressed-up "On". */
  const [engineDetail, setEngineDetail] = useState<EngineStatusDetail | null>(null);
  /* Green-screen fine-tune (owner directive, Oct 29, 2026): the
     creator's own adjustments to the cutout — sensitivity, edge
     size/softness, motion smoothing, spill cleanup, backdrop
     blur/dim. Loaded from the house localStorage prefs, saved on
     every move, applied live to the running changer, and handed
     to the kit at construction so a camera restart keeps them.
     At the defaults the picture is the shipped one exactly. */
  const [fineTune, setFineTuneState] = useState<GreenScreenFineTune>(() => loadGreenScreenFineTune());
  const fineTuneRef = useRef<GreenScreenFineTune>(fineTune);
  const applyFineTune = useCallback((patch: Partial<GreenScreenFineTune>) => {
    const next = { ...fineTuneRef.current, ...patch };
    fineTuneRef.current = next;
    setFineTuneState(next);
    saveGreenScreenFineTune(next);
    changerRef.current?.setFineTune(next);
  }, []);
  const resetFineTune = useCallback(() => {
    const next = { ...GREENSCREEN_FINETUNE_DEFAULTS };
    fineTuneRef.current = next;
    saveGreenScreenFineTune(next);
    setFineTuneState(next);
    changerRef.current?.setFineTune(next);
  }, []);
  /* The ONE background choice (backdrop-selection.ts): a built-in
     scene, or the creator's own photo — an uploaded file or a pasted
     image URL, held here so the pick survives camera stop/start and
     engine A/B switches. Before this, only a built-in id was held
     and an uploaded photo lived nowhere: the upload control dropped
     it silently whenever the camera was off. */
  const [backdropSel, setBackdropSel] = useState<BackdropSelection>(DEFAULT_BACKDROP_SELECTION);
  const [customBackdrop, setCustomBackdrop] = useState<{ source: File | string; thumb: string; name: string } | null>(null);
  const backdropSelRef = useRef<BackdropSelection>(DEFAULT_BACKDROP_SELECTION);
  const customBackdropRef = useRef<{ source: File | string; thumb: string; name: string } | null>(null);
  const chooseBackdrop = useCallback((sel: BackdropSelection) => {
    backdropSelRef.current = sel;
    setBackdropSel(sel);
  }, []);
  const holdCustomBackdrop = useCallback((held: { source: File | string; thumb: string; name: string } | null) => {
    const prev = customBackdropRef.current;
    if (prev && prev.thumb.startsWith("blob:") && prev.thumb !== held?.thumb) URL.revokeObjectURL(prev.thumb);
    customBackdropRef.current = held;
    setCustomBackdrop(held);
  }, []);
  const [camFx, setCamFx] = useState("none");
  const [nc, setNc] = useState<NoiseCancellationLevel>("on");
  const [fx, setFx] = useState("none");
  const [mirror, setMirror] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Camera is off. Start it to check your picture and sound before you go live.");
  const [ncMsg, setNcMsg] = useState("Noise cancellation starts with the camera.");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [transportKind, setTransportKind] = useState<"own" | "cloudflare">("own");
  const [leftover, setLeftover] = useState<LiveStreamOwnerDto | null>(null);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [liveSince, setLiveSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [viewerCount, setViewerCount] = useState(0);
  const [recordNote, setRecordNote] = useState<"saved" | "failed" | null>(null);
  const [recordWarning, setRecordWarning] = useState<string | null>(null);
  const [discordReady, setDiscordReady] = useState(false);
  const [announcedLive, setAnnouncedLive] = useState(false);
  const [announcedEnd, setAnnouncedEnd] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const [lastVodUrl, setLastVodUrl] = useState<string | null>(null);

  /* stage (scenes/sources) ui state */
  const [, setUiTick] = useState(0);
  const bump = useCallback(() => setUiTick((t) => t + 1), []);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [previewMenu, setPreviewMenu] = useState<{ x: number; y: number; sourceId: string } | null>(null);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenHasAudio, setScreenHasAudio] = useState(false);
  const [hotkeysOn, setHotkeysOn] = useState(true);
  const [health, setHealth] = useState<RtcSummary | null>(null);

  /* standalone recording (independent of going live) */
  const [recPhase, setRecPhase] = useState<"idle" | "recording" | "saving" | "saved" | "failed">("idle");
  const [recSecs, setRecSecs] = useState(0);
  const [recError, setRecError] = useState<string | null>(null);
  const [recResult, setRecResult] = useState<{ blob: Blob; mimeType: string; storage: "opfs" | "memory" } | null>(null);
  const [recSavingLib, setRecSavingLib] = useState(false);
  const [recSavedLib, setRecSavedLib] = useState(false);

  const getAnalyser = useCallback(() => changerRef.current?.getAnalyser() ?? null, []);

  const changerRef = useRef<BackgroundChanger | null>(null);
  const transportRef = useRef<StreamTransport | null>(null);
  const recorderRef = useRef<StreamRecorder | null>(null);
  const mixerRef = useRef<AudioMixer | null>(null);
  const recRecorderRef = useRef<StreamRecorder | null>(null);
  const healthPrevRef = useRef<RtcStatSample | null>(null);
  const stageRef = useRef<Stage | null>(null);
  const previewStageRef = useRef<PreviewStage | null>(null);

  /* ── Stream Controller: this studio is a "stage" on its account's
     control channel. The phone remote and the docked deck below run
     commands through the SAME handlers as the studio's own buttons
     (wired at the bottom of the component, where the live state
     lives); the refs here keep the socket client stable. ── */
  const controllerStageIdRef = useRef<string>("");
  if (!controllerStageIdRef.current) {
    controllerStageIdRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `stage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
  const controllerBuildRef = useRef<() => ControllerState>(() => ({
    stageId: controllerStageIdRef.current,
    label: "Your studio",
    live: false,
    title: "",
    scenes: [],
    activeSceneId: null,
    previewSceneId: null,
    micMuted: false,
    micPresent: false,
    cameraOn: false,
    recording: false,
    liveSince: null,
  }));
  const controllerExecRef = useRef<
    (command: ControllerCommand, args: Record<string, unknown>) => Promise<void>
  >(async () => undefined);
  const controllerClientRef = useRef<ControllerStageClient | null>(null);
  const [controllerLinkUp, setControllerLinkUp] = useState(false);
  const [controllerLinkDown, setControllerLinkDown] = useState(false);

  useEffect(() => {
    if (!user) return;
    const client = new ControllerStageClient(
      {
        getAccessToken,
        socketUrl: controllerSocketUrl(window.location, "stage"),
        openSocket: (url) => new WebSocket(url) as unknown as ControllerSocketLike,
      },
      (command, args) => controllerExecRef.current(command, args),
      () => controllerBuildRef.current(),
      () => {
        setControllerLinkUp(client.socketUp);
        setControllerLinkDown(client.linkUnavailable);
      },
    );
    controllerClientRef.current = client;
    void client.start();
    return () => {
      client.stop();
      if (controllerClientRef.current === client) controllerClientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /* Remotes mirror CONFIRMED state — republish on every render (the
     studio already re-renders on every stage/phase/timer change). */
  useEffect(() => {
    controllerClientRef.current?.publish();
  });
  const programCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    mode: "move" | "resize";
    startNx: number;
    startNy: number;
    orig: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const phaseRef = useRef<Phase>("off");
  phaseRef.current = phase;
  const liveRef = useRef(false);
  liveRef.current = phase === "live" || phase === "ending" || phase === "connecting";

  const panel = isLight
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const inputCls = isLight
    ? "w-full rounded-xl border border-[#C9A84C]/40 bg-white/70 px-4 py-2.5 text-sm text-[#2A1E07] placeholder:text-[#6B5B36]/70 focus:outline-none focus:border-[#C9A84C] focus-visible:ring-2 focus-visible:ring-[#C9A84C]/60"
    : "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm placeholder:text-white/50 focus:outline-none focus:border-amber-400/60 focus-visible:ring-2 focus-visible:ring-amber-400/60";
  const pillBtn = (active: boolean) =>
    `rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
      active
        ? "border-transparent bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] text-black"
        : isLight
          ? "border-[#C9A84C]/40 text-[#6B5B36] hover:border-[#C9A84C]"
          : "border-white/10 text-white/60 hover:text-white hover:border-white/30"
    }`;

  const authed = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  /* ── Pre-flight: is broadcasting switched on? Is a stream already
        marked live (e.g. the tab closed mid-stream)? Is Discord linked? */
  const loadStatus = useCallback(async () => {
    try {
      const headers = await authed();
      const res = await fetch("/api/live-streams/status", { headers });
      if (res.ok) {
        const d = (await res.json()) as {
          configured: boolean;
          transport?: string;
          live_stream: LiveStreamOwnerDto | null;
        };
        setConfigured(d.configured);
        if (d.transport === "cloudflare" || d.transport === "own") setTransportKind(d.transport);
        setLeftover(d.live_stream);
      }
      const dRes = await fetch("/api/discord/status", { headers });
      if (dRes.ok) {
        const d = (await dRes.json()) as { configured: boolean };
        setDiscordReady(d.configured);
      }
    } catch {
      /* pre-flight is best-effort; Go Live reports its own errors */
    }
  }, [authed]);

  useEffect(() => {
    WhipTransport.api.getAccessToken = getAccessToken;
    OwnServerTransport.api.getAccessToken = getAccessToken;
    void loadStatus();
  }, [getAccessToken, loadStatus]);

  /* ── Stage lifecycle: the compositing stage + preview renderer. The
        pool's camera providers read the changer lazily, so scene camera
        sources light up the moment the kit starts. */
  useEffect(() => {
    const programCanvas = programCanvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (!programCanvas || !previewCanvas || stageRef.current) return;
    const stage = new Stage(programCanvas);
    stage.pool.cameraCanvas = () => {
      const changer = changerRef.current;
      return changer && changer.running ? changer.canvas : null;
    };
    stage.pool.rawCameraVideo = () => changerRef.current?.getSourceVideo() ?? null;
    /* Avatar sources: tracking reads the raw camera (never composited)
       and the mic channel's analyser for voice drive. */
    stage.pool.avatarVideo = () => changerRef.current?.getSourceVideo() ?? null;
    stage.pool.avatarAnalyser = () =>
      mixerRef.current?.getAnalyser("mic") ?? changerRef.current?.getAnalyser() ?? null;
    /* Guest sources (0202): tiles resolve their live feed from the
       backstage registry, and the GuestPanel reaches this stage
       through the studio bridge (promote = source on air). */
    stage.pool.guestVideoFor = (sessionId) => guestFeeds.videoFor(sessionId);
    registerStudioStage(stage);
    stage.onChange = bump;
    stageRef.current = stage;
    /* Vault-linked avatars re-resolve at studio load: a portrait
       edited in the Creative Vault since a scene was built reaches
       the stream without re-picking the character. */
    void fetchVaultCharacters(getAccessToken)
      .then((characters) => {
        if (characters.length) refreshStageVaultAvatars(stage, characters);
      })
      .catch(() => undefined);
    const preview = new PreviewStage(previewCanvas, stage);
    previewStageRef.current = preview;
    stage.start();
    preview.start();
    bump();
    return () => {
      preview.stop();
      stage.stop();
      clearStudioStage(stage);
      if (!liveRef.current) {
        void changerRef.current?.stop().catch(() => undefined);
        changerRef.current = null;
        if (mixerRef.current) clearStudioMixer(mixerRef.current);
        void mixerRef.current?.close().catch(() => undefined);
        mixerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Live clock + viewer count while broadcasting. */
  useEffect(() => {
    if (phase !== "live" || !liveId) return;
    const startedAt = liveSince ?? Date.now();
    const tick = setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))), 1000);
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/live-streams/${liveId}`);
        if (res.ok) {
          const d = (await res.json()) as { stream: WatchDto };
          setViewerCount(d.stream.viewer_count);
          if (d.stream.ticket) setLiveTicketsSold(d.stream.ticket.sold);
          /* Item 98: adopt the server-written start (goLiveStartedAt)
             as the clock's source the moment the rail reports it —
             the local Date.now() taken in goLive() is only the
             bridge until the rail's value lands. */
          const serverStart = d.stream.started_at ? Date.parse(d.stream.started_at) : NaN;
          if (!Number.isNaN(serverStart)) {
            setLiveSince((prev) => (prev === serverStart ? prev : serverStart));
          }
        }
      } catch {
        /* the next poll retries */
      }
    }, 10_000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [phase, liveId, liveSince]);


  const describeError = (err: unknown): string => {
    if (err instanceof BackgroundChangerError) return err.message;
    if (err instanceof Error) return err.message;
    return "Something went wrong. Try again.";
  };

  /* Apply the held background choice to a changer. Resolves the ONE
     selection (built-in or the creator's own photo) the same way at
     every call site — mode pick, camera start, engine landing — so
     the photo picked in the panel is the photo behind the creator,
     whichever engine is live. Returns false when the source could
     not be loaded (the changer keeps its previous backdrop). */
  const applyBackdropSelection = useCallback(async (changer: BackgroundChanger): Promise<boolean> => {
    const source = backdropSelectionSource(backdropSelRef.current, customBackdropRef.current?.source ?? null);
    if (source === null) return false;
    try {
      await changer.setImage(source);
      return true;
    } catch {
      return false;
    }
  }, []);

  /* Pick a background tile in the panel. The choice is held first,
     then applied to the live changer; a source that fails to load
     restores the previous choice — a bad pick never costs the
     creator the background they already had. */
  const pickBackdrop = useCallback(
    async (sel: BackdropSelection) => {
      const previous = backdropSelRef.current;
      chooseBackdrop(sel);
      setMode("image");
      const changer = changerRef.current;
      if (!changer) {
        setStatusMsg("Start the camera, then your backdrop applies.");
        return;
      }
      changer.setMode("image");
      const applied = await applyBackdropSelection(changer);
      if (!applied) {
        chooseBackdrop(previous);
        setStatusMsg("That backdrop image could not be loaded.");
      }
    },
    [applyBackdropSelection, chooseBackdrop],
  );

  /* Upload your own photo as the background — a first-class tile in
     the same picker, not a separate surface. Validated by the app's
     image rules; a refused or unreadable file is announced and the
     previous background stays. With the camera off the photo is
     HELD and applied the moment the camera starts. */
  const handleBackdropUpload = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      const refusal = validateBackdropUpload(file);
      if (refusal) {
        setStatusMsg(refusal);
        return;
      }
      const changer = changerRef.current;
      if (changer) {
        changer.setMode("image");
        try {
          await changer.setImage(file);
        } catch (err) {
          setStatusMsg(describeError(err));
          return;
        }
      }
      holdCustomBackdrop({ source: file, thumb: URL.createObjectURL(file), name: file.name });
      chooseBackdrop(selectionAfterUpload(backdropSelRef.current, { ok: true, name: file.name }));
      setMode("image");
      if (!changer) setStatusMsg("Got it — your photo goes behind you when the camera starts.");
    },
    [chooseBackdrop, holdCustomBackdrop],
  );

  /* A pasted image link is the same custom choice, held the same way. */
  const handleBackdropUrl = useCallback(
    async (url: string) => {
      const changer = changerRef.current;
      if (changer) {
        changer.setMode("image");
        try {
          await changer.setImage(url);
        } catch (err) {
          setStatusMsg(describeError(err));
          return;
        }
      }
      holdCustomBackdrop({ source: url, thumb: url, name: "Pasted image link" });
      chooseBackdrop(selectionAfterUpload(backdropSelRef.current, { ok: true, name: "Pasted image link" }));
      setMode("image");
      if (!changer) setStatusMsg("Got it — that image goes behind you when the camera starts.");
    },
    [chooseBackdrop, holdCustomBackdrop],
  );

  async function refreshDevices() {
    try {
      const [cams, microphones] = await Promise.all([
        BackgroundChanger.listCameras(),
        BackgroundChanger.listMicrophones(),
      ]);
      setCameras(cams);
      setMics(microphones);
      const changer = changerRef.current;
      if (changer?.deviceId) setCameraId(changer.deviceId);
    } catch {
      /* device listing is best-effort */
    }
  }

  /* The mixer's mic channel follows the kit's output stream — the kit
     swaps its audio track when the mic device or NC level changes, so
     every audio-affecting kit action re-wires the channel. */
  const wireMicIntoMixer = useCallback(() => {
    const mixer = mixerRef.current;
    const stream = changerRef.current?.getStream();
    if (mixer && stream) mixer.setInputStream("mic", stream);
  }, []);

  async function startCamera() {
    setPhase("starting");
    setStatusMsg("Starting the camera and loading the effects engine…");
    try {
      if (!changerRef.current) {
        changerRef.current = new BackgroundChanger({
          mode,
          quality,
          fineTune,
          audio: true,
          noiseCancellation: nc,
          voiceEffect: fx,
          cameraEffect: camFx,
          mirror,
          onNoiseStatus: (s) => setNcMsg(s.message),
          onEngineStatus: (kind) => {
            setEngineKind(kind);
            /* "Off" is only a FAILURE when a backdrop mode is in
               play and the kit is carrying an engine error. An
               engine that is off because the creator is on
               Original (raw by choice, no error) must not read as
               "couldn't load" or lock the backdrop pills. */
            const c = changerRef.current;
            setEngineDown(kind === "off" && !(c && c.mode === "none" && !c.engineError));
            /* Raw-first: when the engine lands after a backdrop was
               already picked, load the chosen backdrop now — the
               held selection, built-in or the creator's own photo. */
            if (kind !== "off" && mode === "image" && c && !c.hasBackdrop()) {
              void applyBackdropSelection(c);
            }
          },
          onEngineStatusDetail: (detail) => setEngineDetail(detail),
        });
      }
      const changer = changerRef.current;
      await changer.start(cameraId || undefined);
      /* Raw-first: start() resolves with the camera live; the engine
         settles in the background and reports through onEngineStatus.
         An engine error already on the kit is the only engine-down
         truth at this point — a still-warming engine is NOT down,
         and a raw (Original) session is not a failure either. */
      const backdropWanted = mode !== "none";
      setEngineDown(backdropWanted && !!changer.engineError);
      setEngineKind(changer.getEngineKind());
      setEngineDetail(changer.getEngineStatusDetail());
      if (changer.segmentationAvailable && mode === "image" && !changer.hasBackdrop()) {
        /* A held photo that can't load must not take the camera down
           with it: fall back to the default built-in, say so, and
           keep the creator's pick held for the next try. */
        const applied = await applyBackdropSelection(changer);
        if (!applied) {
          chooseBackdrop(DEFAULT_BACKDROP_SELECTION);
          await changer.setImage(backdropSelectionSource(DEFAULT_BACKDROP_SELECTION, null)).catch(() => undefined);
          setStatusMsg("That background couldn't be loaded — the Gold Stage is behind you instead. Your pick is still saved in the panel.");
        }
      }
      if (!mixerRef.current) {
        const mixer = new AudioMixer();
        mixer.addInput("mic");
        mixer.addInput("screen");
        mixerRef.current = mixer;
        registerStudioMixer(mixer);
      }
      await mixerRef.current.resume();
      wireMicIntoMixer();
      const shareStream = stageRef.current?.pool.screenStream;
      if (shareStream) mixerRef.current.setInputStream("screen", shareStream);
      setPhase("preview");
      setStatusMsg(
        !backdropWanted || !changer.engineError
          ? "That's your feed in the Camera source — frame it in a scene, pick a title, and go live when you're ready."
          : "Background effects couldn't load — your camera is running plain. Scenes, sound, recording and the green-screen key all still work.",
      );
      bump();
      await refreshDevices();
    } catch (err) {
      setPhase("off");
      setStatusMsg(describeError(err));
      /* Engine errors get ONE surface — the inline status above. (The
         failure used to show twice: inline AND as a red toast.) */
      const isEngineError = err instanceof BackgroundChangerError && err.code === "CDN_LOAD_FAILED";
      if (!isEngineError) {
        toast({ title: "Camera didn't start", description: describeError(err), variant: "destructive" });
      }
    }
  }

  async function stopCamera() {
    if (phase === "live" || phase === "connecting" || phase === "ending") return;
    await changerRef.current?.stop();
    changerRef.current = null;
    mixerRef.current?.setInputStream("mic", null);
    setEngineDown(false);
    setPhase("off");
    setStatusMsg("Camera is off.");
    bump();
  }

  /* ── Screen share (a source type + its own mixer channel later) ────── */
  const startScreenShare = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;
    try {
      const stream = await stage.pool.attachScreen();
      setScreenSharing(true);
      setScreenHasAudio(stream.getAudioTracks().length > 0);
      mixerRef.current?.setInputStream("screen", stream);
      const track = stream.getVideoTracks()[0];
      track?.addEventListener("ended", () => {
        setScreenSharing(false);
        setScreenHasAudio(false);
        mixerRef.current?.setInputStream("screen", null);
        bump();
      });
      setStatusMsg("Screen share is on — it's live in any scene with a Screen source.");
      bump();
    } catch {
      setStatusMsg("Screen share was cancelled — nothing is sharing.");
    }
  }, [bump]);

  const stopScreenShare = useCallback(() => {
    stageRef.current?.pool.detachScreen();
    mixerRef.current?.setInputStream("screen", null);
    setScreenSharing(false);
    setScreenHasAudio(false);
    bump();
  }, [bump]);

  /* ── The published feed: Program video + the mixer's mixed audio
        (mic through the voice chain + screen audio + master bus). Until
        the mixer exists (camera never started) it falls back to the
        kit's own audio track. */
  const assembleStream = useCallback((): MediaStream | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const videoTracks = stage.getStream(30).getVideoTracks();
    const mixerTrack = mixerRef.current?.getOutputTrack();
    const audioTracks = mixerTrack
      ? [mixerTrack]
      : (changerRef.current?.getStream()?.getAudioTracks() ?? []);
    return new MediaStream([...videoTracks, ...audioTracks]);
  }, []);

  async function goLive() {
    const changer = changerRef.current;
    const cameraRunning = !!changer?.running;
    if (!cameraRunning && !screenSharing) {
      toast({
        title: "Nothing to broadcast yet",
        description: "Start your camera or share a screen — that's the feed your scenes are built from.",
        variant: "destructive",
      });
      return;
    }
    if (!title.trim()) {
      toast({ title: "Give your stream a title", description: "Viewers find you by it in the Live rail.", variant: "destructive" });
      return;
    }
    /* The ticket door, validated here so a bad price never starts a
       broadcast the server would refuse (it enforces the same floor). */
    let ticket: { priceVb: number; capacity?: number | null } | undefined;
    if (ticketed) {
      const price = Number(ticketPrice);
      if (!Number.isInteger(price) || price < 100) {
        toast({
          title: "Set a ticket price of 100 VB or more",
          description: "Tickets start at 100 Visual Bucs. You keep 95% of every ticket — the house takes 5%.",
          variant: "destructive",
        });
        return;
      }
      const cap = ticketCapacity.trim() === "" ? null : Number(ticketCapacity);
      if (cap !== null && (!Number.isInteger(cap) || cap < 1)) {
        toast({ title: "Seat limit needs a whole number", description: "Leave it blank for no limit.", variant: "destructive" });
        return;
      }
      ticket = { priceVb: price, capacity: cap, ...(isClass ? { isClass: true } : {}) };
    }
    const stream = assembleStream();
    if (!stream) return;
    setRecordNote(null);
    setLastVodUrl(null);
    setAnnouncedLive(false);
    setAnnouncedEnd(false);
    setPhase("connecting");
    const transport = createStreamTransport(transportKind);
    transportRef.current = transport;
    transport.onStateChange((s: TransportState) => {
      if (s === "failed" && phaseRef.current === "connecting") setPhase("preview");
    });
    try {
      await transport.start(stream, { title: title.trim(), destinations: [{ ...SITE_DESTINATION }], ...(ticket ? { ticket } : {}) });
      const id = transport.streamId;
      setLiveId(id ?? null);
      setLiveSince(Date.now());
      setElapsed(0);
      setViewerCount(0);
      healthPrevRef.current = null;
      setHealth(null);
      setPhase("live");
      setStatusMsg("You're live — the Program feed is on your profile and in the Live rail on Explore.");
      // Record the same Program feed for the VOD — unless the transport
      // keeps the recording itself (the site's own stage: the published
      // feed IS the replay master). A recorder failure never touches
      // the broadcast — it just means no replay.
      if (!transport.serverRecording) {
        try {
          const recorder = new StreamRecorder({
            onWarning: (m) => setRecordWarning(m),
            onError: () => setRecordNote("failed"),
          });
          recorderRef.current = recorder;
          await recorder.start(stream);
        } catch {
          recorderRef.current = null;
          setRecordNote("failed");
        }
      }
    } catch (err) {
      setPhase("preview");
      const msg =
        err instanceof TransportError && (err.code === "NOT_CONFIGURED" || err.code === "STREAM_NOT_CONFIGURED")
          ? "Live streaming isn't switched on yet on this site. Your studio works — broadcasting turns on the moment the owner enables it."
          : describeError(err);
      setStatusMsg(msg);
      toast({ title: "Couldn't go live", description: msg, variant: "destructive" });
    }
  }

  async function endStream() {
    const transport = transportRef.current;
    if (!transport) return;
    setPhase("ending");
    const serverRecording = transport.serverRecording === true;
    const streamId = transport.streamId ?? liveId;
    // Stop the recorder first (final chunk flush), then end the session.
    const hadRecorder = recorderRef.current !== null;
    let recording: { blob: Blob; mimeType: string } | null = null;
    if (recorderRef.current) {
      recording = await recorderRef.current.stop().catch(() => null);
      recorderRef.current = null;
    }
    await transport.stop();
    transportRef.current = null;
    setPhase("preview");
    setLiveId(null);
    setLiveSince(null);
    setHealth(null);
    setStatusMsg("You're off air. That was the show — post the replay to Discord from the Announce tab if you want the crowd to catch it.");

    if (serverRecording && streamId) {
      // The stage kept this recording: the replay registers on the
      // stream once the server finishes saving it. Watch for the fact
      // (vod_url, or the site destination's recorded vod_state) —
      // never guess either way.
      void (async () => {
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const res = await fetch(`/api/live-streams/${streamId}`);
            if (!res.ok) continue;
            const d = (await res.json()) as {
              stream: {
                vod_url: string | null;
                destinations?: Array<{ platform: string; vod_state: string | null }>;
              };
            };
            if (d.stream.vod_url) {
              setRecordNote("saved");
              setLastVodUrl(d.stream.vod_url);
              return;
            }
            const site = d.stream.destinations?.find((x) => x.platform === "site");
            if (site?.vod_state === "not_saved") {
              setRecordNote("failed");
              return;
            }
          } catch {
            /* keep watching */
          }
        }
      })();
    }

    if (recording && streamId && user) {
      // Upload through the site's own storage path, then register the
      // recording on the stream (it lands in the creator's clips).
      try {
        const headers = await authed();
        const key = `${user.id}/live/${streamId}.webm`;
        const presign = await fetch("/api/r2/presign-upload", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ key, contentType: recording.mimeType || "video/webm" }),
        });
        if (!presign.ok) throw new Error("presign failed");
        const { uploadUrl, publicUrl } = (await presign.json()) as { uploadUrl: string; publicUrl: string };
        const put = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": recording.mimeType || "video/webm" },
          body: recording.blob,
        });
        if (!put.ok) throw new Error("upload failed");
        const reg = await fetch(`/api/live-streams/${streamId}/vod`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ vod_url: publicUrl }),
        });
        if (!reg.ok) throw new Error("register failed");
        setRecordNote("saved");
        setLastVodUrl(publicUrl);
      } catch {
        setRecordNote("failed");
      }
    } else if (hadRecorder) {
      // A recorder was running but produced nothing usable (its writes
      // failed mid-stream) — the stream ended fine; the replay didn't save.
      setRecordNote("failed");
    }
    void loadStatus();
  }

  async function endLeftover() {
    if (!leftover) return;
    try {
      const headers = await authed();
      await fetch(`/api/live-streams/${leftover.id}/end`, { method: "POST", headers });
      setLeftover(null);
      toast({ title: "Stream ended", description: "That leftover live stream is closed out." });
    } catch {
      toast({ title: "Couldn't end it", description: "Try again in a moment.", variant: "destructive" });
    }
  }

  async function announce(kind: "live" | "ended") {
    setAnnouncing(true);
    try {
      const headers = await authed();
      const watchUrl = liveId ? `${window.location.origin}/live/${liveId}` : undefined;
      const res = await fetch("/api/discord/announce", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title: title.trim() || "Live stream",
          ...(kind === "live" && watchUrl ? { video_url: watchUrl } : {}),
          ...(kind === "ended" && lastVodUrl ? { vod_url: lastVodUrl } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Announce failed");
      if (kind === "live") setAnnouncedLive(true);
      else setAnnouncedEnd(true);
      toast({ title: "Posted to Discord", description: kind === "live" ? "Your server knows you're live." : "The wrap-up is posted." });
    } catch (e) {
      toast({ title: "Couldn't announce", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setAnnouncing(false);
    }
  }

  /* Stream health while live: real RTC stats off the publisher's peer
     connection, summarized honestly (nulls render as "unavailable"). */
  useEffect(() => {
    if (phase !== "live") return;
    const transport = transportRef.current;
    if (!transport?.getStats) return;
    const getStats = transport.getStats.bind(transport);
    const id = setInterval(() => {
      void getStats().then((report) => {
        if (!report) return;
        const entries: Record<string, unknown>[] = [];
        report.forEach((s) => entries.push(s as Record<string, unknown>));
        const { summary, sample } = summarizeRtcStats(entries, healthPrevRef.current);
        healthPrevRef.current = sample;
        setHealth(summary);
      });
    }, 2000);
    return () => clearInterval(id);
  }, [phase, liveId]);

  /* ── Standalone recording: the Program feed, without going live ───── */
  useEffect(() => {
    if (recPhase !== "recording") return;
    const started = Date.now() - recSecs * 1000;
    const id = setInterval(() => setRecSecs(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recPhase]);

  const toggleRecord = useCallback(async () => {
    if (recPhase === "recording") {
      const recorder = recRecorderRef.current;
      recRecorderRef.current = null;
      setRecPhase("saving");
      const result = await recorder?.stop().catch(() => null);
      if (result && recorder) {
        setRecResult({ blob: result.blob, mimeType: result.mimeType, storage: recorder.sinkKind ?? "memory" });
        setRecPhase("saved");
        setRecSavedLib(false);
      } else {
        setRecPhase("failed");
        setRecError("The recording didn't save — the studio is fine, but that take is gone.");
      }
      return;
    }
    setRecError(null);
    setRecResult(null);
    const stream = assembleStream();
    if (!stream) return;
    const recorder = new StreamRecorder();
    recRecorderRef.current = recorder;
    try {
      await recorder.start(stream);
      setRecSecs(0);
      setRecPhase("recording");
    } catch {
      setRecPhase("failed");
      setRecError("Recording couldn't start in this browser.");
    }
  }, [recPhase, assembleStream]);

  function downloadRecording() {
    if (!recResult) return;
    const url = URL.createObjectURL(recResult.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title.trim() || "studio-recording").replace(/[^\w-]+/g, "-")}.webm`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function saveRecordingToLibrary() {
    if (!recResult || !user) return;
    setRecSavingLib(true);
    try {
      const headers = await authed();
      const key = `${user.id}/live/rec-${Date.now()}.webm`;
      const presign = await fetch("/api/r2/presign-upload", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ key, contentType: recResult.mimeType || "video/webm" }),
      });
      if (!presign.ok) throw new Error("presign failed");
      const { uploadUrl, publicUrl } = (await presign.json()) as { uploadUrl: string; publicUrl: string };
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": recResult.mimeType || "video/webm" },
        body: recResult.blob,
      });
      if (!put.ok) throw new Error("upload failed");
      const reg = await fetch("/api/generated-clips", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || "Studio recording", videoUrl: publicUrl, status: "completed" }),
      });
      if (!reg.ok) throw new Error("register failed");
      setRecSavedLib(true);
    } catch {
      setRecError("Saving to your clips didn't go through — you can still download the recording below.");
    } finally {
      setRecSavingLib(false);
    }
  }

  /* ── Hotkeys (toggleable; paused while typing in a field) ─────────── */
  useEffect(() => {
    if (!hotkeysOn) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)
      ) {
        return;
      }
      const stage = stageRef.current;
      if (!stage) return;
      if (/^Digit[1-9]$/.test(e.code)) {
        const scene = stage.scenes[Number(e.code.slice(5)) - 1];
        if (scene) {
          stage.cutTo(scene.id);
          e.preventDefault();
        }
      } else if (e.code === "KeyT") {
        stage.transition("fade");
        e.preventDefault();
      } else if (e.code === "KeyC") {
        stage.transition("cut");
        e.preventDefault();
      } else if (e.code === "KeyM") {
        const mixer = mixerRef.current;
        const state = mixer?.getInputState("mic");
        if (mixer && state) {
          mixer.setMuted("mic", !state.muted);
          bump();
          e.preventDefault();
        }
      } else if (e.code === "KeyR") {
        if (!liveRef.current) {
          void toggleRecord();
          e.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeysOn, bump, toggleRecord]);

  /* ── Preview drag editing: move by dragging the source, resize from
        its gold corner handle. Locked sources select but don't drag. */
  const beginDrag = (e: React.PointerEvent, dragMode: "move" | "resize") => {
    const stage = stageRef.current;
    const wrap = previewWrapRef.current;
    if (!stage || !wrap) return;
    const scene = stage.previewScene();
    const rect = wrap.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    let source: SceneSource | undefined;
    if (dragMode === "resize") {
      source = scene.sources.find((s) => s.id === selectedSourceId);
    } else {
      source = [...scene.sources]
        .reverse()
        .find((s) => s.visible && nx >= s.x && nx <= s.x + s.w && ny >= s.y && ny <= s.y + s.h);
    }
    if (!source) {
      if (dragMode === "move") setSelectedSourceId(null);
      return;
    }
    setSelectedSourceId(source.id);
    if (source.locked) return;
    e.preventDefault();
    dragRef.current = {
      id: source.id,
      mode: dragMode,
      startNx: nx,
      startNy: ny,
      orig: { x: source.x, y: source.y, w: source.w, h: source.h },
    };
    const move = (ev: PointerEvent) => {
      const drag = dragRef.current;
      const w = previewWrapRef.current;
      if (!drag || !w) return;
      const r = w.getBoundingClientRect();
      const dx = (ev.clientX - r.left) / r.width - drag.startNx;
      const dy = (ev.clientY - r.top) / r.height - drag.startNy;
      if (drag.mode === "move") {
        stage.updateSource(scene.id, drag.id, {
          x: Math.min(Math.max(drag.orig.x + dx, -drag.orig.w + 0.05), 0.95),
          y: Math.min(Math.max(drag.orig.y + dy, -drag.orig.h + 0.05), 0.95),
        });
      } else {
        stage.updateSource(scene.id, drag.id, {
          w: Math.min(Math.max(drag.orig.w + dx, 0.05), 1 - drag.orig.x),
          h: Math.min(Math.max(drag.orig.h + dy, 0.05), 1 - drag.orig.y),
        });
      }
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ── Preview right-click: same frontmost-visible hit test as the
        drag. A hit selects the source and opens its context menu; a
        miss leaves the browser's own menu alone. */
  const openPreviewContextMenu = (e: React.MouseEvent) => {
    const st = stageRef.current;
    const wrap = previewWrapRef.current;
    if (!st || !wrap) return;
    const scene = st.previewScene();
    const rect = wrap.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const source = [...scene.sources]
      .reverse()
      .find((s) => s.visible && nx >= s.x && nx <= s.x + s.w && ny >= s.y && ny <= s.y + s.h);
    if (!source) return;
    e.preventDefault();
    setSelectedSourceId(source.id);
    setPreviewMenu({ x: e.clientX, y: e.clientY, sourceId: source.id });
  };

  const renamePreviewSource = (source: SceneSource) => {
    const st = stageRef.current;
    if (!st) return;
    const next = window.prompt("Rename source", source.name);
    if (next && next.trim()) {
      st.updateSource(st.previewScene().id, source.id, { name: next.trim().slice(0, 80) });
    }
  };

  const removePreviewSource = (source: SceneSource) => {
    const st = stageRef.current;
    if (!st) return;
    st.removeSource(st.previewScene().id, source.id);
    setSelectedSourceId((cur) => (cur === source.id ? null : cur));
  };

  const stage = stageRef.current;
  const previewScene = stage?.previewScene() ?? null;
  const selectedSource = previewScene?.sources.find((s) => s.id === selectedSourceId) ?? null;
  const isLivePhase = phase === "live" || phase === "ending";
  const watchPath = liveId ? `/live/${liveId}` : null;

  /* Stream Controller: the confirmed-state snapshot the deck and the
     phone remote render, and the executor that runs their commands
     through the studio's OWN handlers — a remote Go Live is this
     page's goLive(), transports, destinations and all. */
  /* The mic readout must come from a REAL input: no mixer (or the
     studio still off) means there is no mic to be live or muted —
     micPresent says so, and the deck reads Off from it. */
  const micInput = phase !== "off" ? (mixerRef.current?.getInputState("mic") ?? null) : null;
  const controllerState: ControllerState = {
    stageId: controllerStageIdRef.current,
    label: isLivePhase ? title.trim() || "Your stream" : "Your studio",
    live: isLivePhase,
    title,
    scenes: (stageRef.current?.scenes ?? []).map((s) => ({ id: s.id, name: s.name })),
    activeSceneId: stageRef.current?.programId ?? null,
    previewSceneId: stageRef.current?.previewId ?? null,
    micMuted: micInput?.muted ?? false,
    micPresent: micInput !== null,
    cameraOn: phase !== "off",
    recording: recPhase === "recording" || isLivePhase,
    /* Item 98: publish the REAL start — the liveSince state, which
       goLive() sets and the live poll then corrects to the
       server-written started_at. (This used to reconstruct
       Date.now() - elapsed*1000 on every render: a drifting
       fabrication the decks presented as the broadcast's start.) */
    liveSince: isLivePhase ? liveSince : null,
  };
  controllerBuildRef.current = () => controllerState;
  controllerExecRef.current = async (command, args) => {
    const st = stageRef.current;
    switch (command) {
      case "scene.select": {
        const sceneId = typeof args.sceneId === "string" ? args.sceneId : null;
        if (st && sceneId && st.sceneById(sceneId)) {
          st.cutTo(sceneId);
          st.setPreview(sceneId);
        }
        break;
      }
      case "transition.cut":
        st?.transition("cut");
        break;
      case "transition.fade":
        st?.transition("fade");
        break;
      case "mic.toggle": {
        const mixer = mixerRef.current;
        const mic = mixer?.getInputState("mic");
        if (mixer && mic) {
          mixer.setMuted("mic", !mic.muted);
          bump();
        }
        break;
      }
      case "camera.toggle":
        if (phase === "off") await startCamera();
        else await stopCamera();
        break;
      case "record.toggle":
        // While live, the broadcast already records its replay.
        if (!isLivePhase) await toggleRecord();
        break;
      case "stream.start":
        if (!isLivePhase) await goLive();
        break;
      case "stream.end":
        if (isLivePhase) await endStream();
        break;
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 md:px-8">
      <div className="mb-6">
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[#d4a017]/40 bg-[#d4a017]/10 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-[#fbbf24]">
          <Radio className="h-3 w-3" aria-hidden="true" /> Broadcast studio
        </p>
        <h2 className="text-2xl font-black tracking-tight md:text-3xl">Your whole studio — no downloads.</h2>
        <p className={`mt-2 max-w-2xl text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          Scenes, sources, a mixer-clean voice and your camera kit, broadcast straight from this page to your profile.
          Build the show in Preview, send it to Program when it's ready — free to stream.
        </p>
      </div>

      {configured === false && (
        <div className={`mb-6 flex items-start gap-3 rounded-xl border p-4 ${panel}`}>
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="text-sm">
            <p className="font-bold">Live streaming isn't switched on yet.</p>
            <p className={isLight ? "text-[#6B5B36]" : "text-white/50"}>
              The studio below fully works — scenes, camera, backdrops, effects, clean voice. Broadcasting turns on
              the moment the site owner enables it; until then, Go Live will tell you the same thing instead of faking it.
            </p>
          </div>
        </div>
      )}

      {leftover && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4">
          <div className="text-sm">
            <p className="font-bold text-red-400">
              <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
              A stream is still marked live: “{leftover.title}”
            </p>
            <p className="text-white/50">It was left open (the tab probably closed mid-stream). End it before starting a new one.</p>
          </div>
          <Button onClick={endLeftover} variant="outline" className="gap-2 border-red-400/40 text-red-300" data-testid="btn-end-leftover">
            <Square className="h-4 w-4" /> End it
          </Button>
        </div>
      )}

      {/* ── Monitors: Program (published) + Preview (framing) ── */}
      <section className={`relative mb-6 rounded-2xl border p-4 md:p-5 ${panel}`}>
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className={`text-[11px] font-black uppercase tracking-widest ${isLight ? "text-[#7A5A12]" : "text-[#fbbf24]"}`}>
                Program
              </span>
              <span className={`text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                what goes out — {stage ? stage.programScene().name : "…"}
              </span>
            </div>
            <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
              <canvas ref={programCanvasRef} width={1280} height={720} className="block h-full w-full" data-testid="broadcast-program" />
              {isLivePhase && (
                <div className="absolute left-3 top-3 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-xs font-black uppercase tracking-wider text-white">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Live
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-xs font-bold text-white">
                    <Clock className="h-3.5 w-3.5" /> {formatDuration(elapsed)}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-xs font-bold text-white">
                    <Users className="h-3.5 w-3.5" /> {viewerCount}
                  </span>
                </div>
              )}
              {phase === "off" && (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                  <p className="rounded-full bg-black/70 px-3 py-1 text-[11px] font-bold text-white/80">
                    Start the camera and your scenes come alive here.
                  </p>
                </div>
              )}
              {liveId && <StreamAlertOverlay streamId={liveId} />}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className={`text-[11px] font-black uppercase tracking-widest ${isLight ? "text-[#7A5A12]" : "text-emerald-400"}`}>
                Preview
              </span>
              <span className={`text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                frame the next scene — {stage ? stage.previewScene().name : "…"}
              </span>
            </div>
            <div
              ref={previewWrapRef}
              className="relative aspect-video w-full touch-none overflow-hidden rounded-xl border border-emerald-500/30 bg-black"
              onPointerDown={(e) => beginDrag(e, "move")}
              onContextMenu={openPreviewContextMenu}
            >
              <canvas ref={previewCanvasRef} width={640} height={360} className="block h-full w-full" data-testid="broadcast-preview" />
              {selectedSource && (
                <div
                  className="pointer-events-none absolute border border-dashed border-[#C9A84C]"
                  style={{
                    left: `${selectedSource.x * 100}%`,
                    top: `${selectedSource.y * 100}%`,
                    width: `${selectedSource.w * 100}%`,
                    height: `${selectedSource.h * 100}%`,
                  }}
                >
                  <div
                    className="pointer-events-auto absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border border-black/50 bg-[#C9A84C]"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      beginDrag(e, "resize");
                    }}
                  />
                </div>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                className="flex-1 gap-2"
                disabled={!stage || stage.previewId === stage.programId}
                onClick={() => stage?.transition("cut")}
                data-testid="btn-transition-cut"
              >
                <MonitorPlay className="h-4 w-4" /> Cut
              </Button>
              <Button
                className="flex-1 gap-2 bg-gradient-to-r from-[#fbbf24] to-[#d4a017] font-bold text-black hover:brightness-110"
                disabled={!stage || stage.previewId === stage.programId}
                onClick={() => stage?.transition("fade")}
                data-testid="btn-transition-fade"
              >
                <Wand2 className="h-4 w-4" /> Transition
              </Button>
            </div>
            <p className={`mt-2 text-[11px] leading-snug ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
              Drag a source on Preview to move it; drag its gold corner to resize. Program only changes when you
              Cut or Transition.
            </p>
            {previewMenu && stage && previewScene && (() => {
              const source = previewScene.sources.find((s) => s.id === previewMenu.sourceId);
              if (!source) return null;
              return (
                <ClipContextMenu
                  x={previewMenu.x}
                  y={previewMenu.y}
                  onClose={() => setPreviewMenu(null)}
                  testId="preview-source-context-menu"
                  items={buildSourceContextItems(stage, previewScene, source, {
                    onSelect: setSelectedSourceId,
                    onRename: renamePreviewSource,
                    onRemove: removePreviewSource,
                  })}
                />
              );
            })()}
          </div>
        </div>

        {isLivePhase && (
          <p className={`mt-3 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`} data-testid="stream-health">
            Stream health:{" "}
            {health
              ? [
                  health.bitrateKbps != null ? `${health.bitrateKbps.toLocaleString()} kbps` : "bitrate unavailable",
                  health.fps != null ? `${Math.round(health.fps)} fps` : "fps unavailable",
                  health.droppedFrames != null ? `${health.droppedFrames} dropped frames` : "dropped frames unavailable",
                ].join(" · ")
              : "reading…"}
          </p>
        )}

        {/* camera controls */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {phase === "off" || phase === "starting" ? (
            <Button onClick={startCamera} disabled={phase === "starting"} className="gold-glow gap-2 bg-gradient-to-r from-[#fbbf24] to-[#d4a017] font-bold text-black hover:brightness-110" data-testid="btn-start-camera">
              {phase === "starting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
              Start camera
            </Button>
          ) : (
            <Button onClick={stopCamera} disabled={isLivePhase} variant="outline" className="gap-2 border-white/15" data-testid="btn-stop-camera">
              <Square className="h-4 w-4" /> Stop camera
            </Button>
          )}
          <label className="flex min-w-[180px] flex-1 items-center gap-2 text-xs">
            <Camera className="h-4 w-4 shrink-0 opacity-50" />
            <select
              value={cameraId}
              onChange={async (e) => {
                setCameraId(e.target.value);
                if (changerRef.current && phase !== "off") {
                  try {
                    await changerRef.current.switchCamera(e.target.value || undefined);
                  } catch (err) {
                    setStatusMsg(describeError(err));
                  }
                }
              }}
              className={`${inputCls} !w-auto flex-1`}
              aria-label="Camera"
              data-testid="select-camera"
            >
              <option value="">Default camera</option>
              {cameras.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[180px] flex-1 items-center gap-2 text-xs">
            <Mic className="h-4 w-4 shrink-0 opacity-50" />
            <select
              value={micId}
              onChange={async (e) => {
                setMicId(e.target.value);
                if (changerRef.current && phase !== "off") {
                  try {
                    await changerRef.current.switchMicrophone(e.target.value || undefined);
                    wireMicIntoMixer();
                  } catch (err) {
                    setStatusMsg(describeError(err));
                  }
                }
              }}
              className={`${inputCls} !w-auto flex-1`}
              aria-label="Microphone"
              data-testid="select-mic"
            >
              <option value="">Default microphone</option>
              {mics.map((m) => (
                <option key={m.deviceId} value={m.deviceId}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <button
              type="button"
              role="switch"
              aria-checked={mirror}
              onClick={() => {
                const next = !mirror;
                setMirror(next);
                changerRef.current?.setMirror(next);
              }}
              className={`relative h-6 w-10 rounded-full transition-colors ${mirror ? "bg-amber-400" : "bg-white/15"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-all ${mirror ? "left-[18px]" : "left-0.5"}`} />
            </button>
            Mirror my view
          </label>
        </div>
        <p className={`mt-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`} role="status">{statusMsg}</p>
      </section>

      {/* ── Scenes & sources ── */}
      <section className={`mb-6 rounded-2xl border p-5 md:p-6 ${panel}`}>
        <h3 className="text-sm font-black uppercase tracking-widest text-[#fbbf24]">Scenes &amp; sources</h3>
        {stage ? (
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <ScenesPanel stage={stage} isLight={isLight} onTake={(id) => stage.cutTo(id)} />
            <SourcesPanel
              stage={stage}
              isLight={isLight}
              selectedId={selectedSourceId}
              onSelect={setSelectedSourceId}
              onStartScreenShare={() => void startScreenShare()}
              onStopScreenShare={stopScreenShare}
              screenSharing={screenSharing}
              onNotify={setStatusMsg}
            />
          </div>
        ) : (
          <p className={`mt-3 flex items-center gap-2 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            <Loader2 className="h-4 w-4 animate-spin" /> Setting up the stage…
          </p>
        )}
      </section>

      {/* ── Go live ── */}
      <section className={`mb-6 rounded-2xl border p-5 md:p-6 ${panel}`}>
        <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-[#fbbf24]">
          <Radio className="h-3.5 w-3.5" /> Your stream
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="min-w-[240px] flex-1">
            <span className="text-xs font-bold uppercase tracking-wider opacity-60">Stream title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Friday Night Live — making the new record"
              disabled={isLivePhase}
              className={`${inputCls} mt-1.5`}
              data-testid="input-broadcast-title"
            />
          </label>
          {phase !== "live" && phase !== "ending" ? (
            <Button
              onClick={goLive}
              disabled={phase !== "preview" && !screenSharing}
              className="gold-glow gap-2 bg-gradient-to-r from-[#fbbf24] to-[#d4a017] font-bold text-black hover:brightness-110"
              data-testid="btn-go-live"
            >
              {phase === "connecting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
              Go Live
            </Button>
          ) : (
            <Button onClick={endStream} disabled={phase === "ending"} variant="outline" className="gap-2 border-red-400/40 text-red-300" data-testid="btn-end-broadcast">
              {phase === "ending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              End Stream
            </Button>
          )}
        </div>
        {phase !== "live" && phase !== "ending" && phase !== "preview" && !screenSharing && (
          <p className={`mt-2 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
            Go Live needs a feed — start the camera or share a screen, and what you see in Program is exactly what goes out.
          </p>
        )}
        {isLivePhase && watchPath && (
          <p className={`mt-2 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
            Watching: <Link href={watchPath} className="font-bold text-amber-400 underline underline-offset-2">{watchPath}</Link> — share it anywhere; viewers watch right here on the site.
          </p>
        )}

        {/* Tickets — the pay-per-view door (Wave 4 #31). Set before
            Go Live; the price and cap are fixed for the whole show.
            You keep 95% of every ticket; the house takes 5%. */}
        <div className={`mt-4 rounded-xl border p-3.5 ${isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/[0.03]"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider opacity-60">Tickets</p>
              <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                {ticketed
                  ? "Viewers buy a ticket in Visual Bucs to enter this show — chat, tips, and the replay included. You keep 95% of every ticket."
                  : "This show is free for everyone. Turn on tickets to sell entry instead."}
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <button
                type="button"
                role="switch"
                aria-checked={ticketed}
                disabled={isLivePhase}
                onClick={() => setTicketed(!ticketed)}
                className={`relative h-6 w-10 rounded-full transition-colors ${ticketed ? "bg-amber-400" : "bg-white/15"} ${isLivePhase ? "opacity-50" : ""}`}
                data-testid="switch-ticketed"
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-all ${ticketed ? "left-[18px]" : "left-0.5"}`} />
              </button>
              Sell tickets
            </label>
          </div>
          {ticketed && (
            <div className="mt-3 flex flex-wrap gap-3">
              <label className="min-w-[160px] flex-1">
                <span className="text-xs font-bold uppercase tracking-wider opacity-60">Ticket price (Visual Bucs)</span>
                <input
                  value={ticketPrice}
                  onChange={(e) => setTicketPrice(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="500"
                  inputMode="numeric"
                  disabled={isLivePhase}
                  className={`${inputCls} mt-1.5`}
                  data-testid="input-ticket-price"
                />
              </label>
              <label className="min-w-[160px] flex-1">
                <span className="text-xs font-bold uppercase tracking-wider opacity-60">Seat limit (optional)</span>
                <input
                  value={ticketCapacity}
                  onChange={(e) => setTicketCapacity(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="No limit"
                  inputMode="numeric"
                  disabled={isLivePhase}
                  className={`${inputCls} mt-1.5`}
                  data-testid="input-ticket-capacity"
                />
              </label>
            </div>
          )}
          {ticketed && (
            <div className="mt-3 flex items-start justify-between gap-3">
              <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                Run this show as a class: every ticket holder is an enrolled student,
                and when the session ends the replay is listed as a course (as a draft —
                you set the price and publish it).
              </p>
              <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isClass}
                  disabled={isLivePhase}
                  onClick={() => setIsClass(!isClass)}
                  className={`relative h-6 w-10 rounded-full transition-colors ${isClass ? "bg-amber-400" : "bg-white/15"} ${isLivePhase ? "opacity-50" : ""}`}
                  data-testid="switch-is-class"
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-all ${isClass ? "left-[18px]" : "left-0.5"}`} />
                </button>
                Run as a class
              </label>
            </div>
          )}
          {ticketed && isLivePhase && (
            <p className={`mt-2 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
              The door is set for this show — price and seats can't change while you're live.{" "}
              <span className="font-bold text-amber-400" data-testid="text-tickets-sold">
                {liveTicketsSold} ticket{liveTicketsSold === 1 ? "" : "s"} sold
              </span>
            </p>
          )}
        </div>

        {/* Destinations — v1 broadcasts to the profile; fan-out is coming
            and is labeled as such, with each platform's real recording
            behavior spelled out. No dead toggles. */}
        <div className={`mt-4 rounded-xl border p-3.5 ${isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/[0.03]"}`}>
          <p className="text-xs font-bold uppercase tracking-wider opacity-60">Broadcasting to</p>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className={`inline-block h-2 w-2 rounded-full ${isLivePhase ? "animate-pulse bg-red-500" : "bg-emerald-500"}`} />
            <span className="font-bold">Your profile</span>
            <span className={`text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
              {isLivePhase ? "live now" : "ready"} · replay saves to your clips
            </span>
          </div>
          {transportKind === "own" && (
            <p className={`mt-1.5 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
              This site carries your stream itself — viewers see it a few seconds behind real time.
            </p>
          )}
          <div className="mt-3 space-y-1.5 border-t border-dashed border-[#C9A84C]/25 pt-3">
            {DESTINATION_PLATFORMS.filter((p) => p.platform !== "site").map((p) => (
              <div key={p.platform} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm opacity-70">
                <span className="font-semibold">{p.label}</span>
                <span className="rounded-full border border-current px-1.5 py-px text-[10px] font-bold uppercase tracking-wide">
                  Coming soon
                </span>
                <span className={`text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>{p.recordingNote}</span>
              </div>
            ))}
          </div>
          <p className={`mt-2.5 text-[11px] leading-snug ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
            Streaming to other platforms at the same time is on the way. When it lands, each platform you connect will
            save the stream its own way — the notes above are how they really work.
          </p>
        </div>

        {/* Standalone recording — the Program feed, no broadcast needed */}
        <div className={`mt-4 rounded-xl border p-3.5 ${isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/[0.03]"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-bold uppercase tracking-wider opacity-60">Record</p>
            <Button
              variant="outline"
              className="gap-2"
              disabled={isLivePhase || recPhase === "saving"}
              onClick={() => void toggleRecord()}
              title={isLivePhase ? "Your broadcast is already recording its replay" : "Record the Program feed without going live"}
              data-testid="btn-record"
            >
              {recPhase === "recording" ? (
                <>
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" /> Stop · {formatDuration(recSecs)}
                </>
              ) : recPhase === "saving" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Circle className="h-4 w-4 text-red-500" /> Record
                </>
              )}
            </Button>
            <span className={`text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
              {isLivePhase
                ? "While you're live, the broadcast records its own replay automatically."
                : "Record the Program feed any time — for clips, promos, or a rehearsal."}
            </span>
          </div>
          {recPhase === "failed" && recError && (
            <p className="mt-2 text-xs font-bold text-red-400">{recError}</p>
          )}
          {recPhase === "saved" && recResult && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className={isLight ? "text-[#2A1E07]" : "text-white/70"}>
                Recording saved ({(recResult.blob.size / 1024 / 1024).toFixed(1)} MB
                {recResult.storage === "memory" ? " — kept in memory, so download it before closing this tab" : ""}).
                {recSavedLib ? " It's in your clips too." : ""}
              </span>
              <Button variant="outline" className="gap-2" onClick={downloadRecording} data-testid="btn-download-recording">
                <Download className="h-4 w-4" /> Download
              </Button>
              {!recSavedLib && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => void saveRecordingToLibrary()}
                  disabled={recSavingLib}
                  data-testid="btn-save-recording"
                >
                  {recSavingLib ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save to my clips
                </Button>
              )}
            </div>
          )}
        </div>

        {recordNote === "saved" && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-500">
            <CheckCircle2 className="h-4 w-4" /> Recording saved — it's in your clips, and on the watch page as the replay.
          </p>
        )}
        {recordNote === "failed" && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-red-400">
            <AlertTriangle className="h-4 w-4" /> The stream ended fine, but the recording didn't save.
          </p>
        )}
        {recordWarning && <p className="mt-2 text-xs text-amber-500">{recordWarning}</p>}
        {discordReady && (phase === "live" || recordNote !== null) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {phase === "live" && !announcedLive && (
              <Button onClick={() => announce("live")} disabled={announcing} variant="outline" className="gap-2 border-amber-400/30 text-amber-300" data-testid="btn-announce-live">
                {announcing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
                Announce to Discord
              </Button>
            )}
            {phase !== "live" && recordNote !== null && !announcedEnd && (
              <Button onClick={() => announce("ended")} disabled={announcing} variant="outline" className="gap-2 border-amber-400/30 text-amber-300" data-testid="btn-announce-ended">
                {announcing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
                Post the wrap-up to Discord
              </Button>
            )}
          </div>
        )}
      </section>

      {/* ── Stream chat ── */}
      <section className="mb-6">
        <div className="mb-4">
          <ChannelModerators />
        </div>
        <div className="mb-4">
          <StreamWidgetsPanel streamId={liveId} />
        </div>
        <div className="mb-4">
          <LiveCaptionsStudioPanel streamId={liveId} />
        </div>
        {liveId ? (
          <LiveChatPanel streamId={liveId} className="h-[420px]" />
        ) : (
          <div className={`rounded-2xl border p-5 md:p-6 ${panel}`}>
            <h3 className="text-sm font-black uppercase tracking-widest text-[#fbbf24]">Stream chat</h3>
            <p className={`mt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
              Chat opens with your stream — go live and the conversation lands here, where you can read it, post, and
              moderate while you broadcast.
            </p>
          </div>
        )}
      </section>

      {/* ── Stream Controller ── */}
      <section className={`mb-6 rounded-2xl border p-5 md:p-6 ${panel}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black uppercase tracking-widest text-[#fbbf24]">Stream Controller</h3>
          <span className={`flex items-center gap-1.5 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/40"}`} role="status">
            <span className={`inline-block h-2 w-2 rounded-full ${controllerLinkUp ? "bg-emerald-500" : controllerLinkDown ? "bg-red-400" : "bg-white/30"}`} />
            {controllerLinkUp
              ? "Phone remote link: ready"
              : controllerLinkDown
                ? "Phone remote link: unavailable — the controls on this screen still run your show"
                : "Phone remote link: connecting…"}
          </span>
        </div>
        <p className={`mt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          Big buttons for running the show — here, or from your phone: open the{" "}
          <Link href="/go-live/controller" className="font-bold text-amber-500 underline underline-offset-2">
            Stream Controller
          </Link>{" "}
          on your phone and it pairs with this studio automatically, because it's signed in as you.
        </p>
        <div className="mt-4 rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] p-3.5" data-dark-lock>
          <StreamDeck
            state={controllerState}
            canControl
            onCommand={(cmd, args) => {
              void controllerExecRef.current(cmd, args ?? {});
            }}
          />
        </div>
      </section>

      {/* ── Behind me ── */}
      <section className={`mb-6 rounded-2xl border p-5 md:p-6 ${panel}`}>
        <h3 className="text-sm font-black uppercase tracking-widest text-[#fbbf24]">Behind me</h3>
        <p className={`mt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          Your background lives here — turn on the green screen or a backdrop, then pick what sits behind you in
          this same panel: a built-in scene, or your own photo.
        </p>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Background mode">
          {(
            [
              ["green", "Green Screen"],
              ["blur", "Blur"],
              ["image", "Backdrop"],
              ["none", "Original"],
            ] as Array<[BackgroundMode, string]>
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              disabled={engineDown && m !== "none"}
              className={`${pillBtn(mode === m)} disabled:cursor-not-allowed disabled:opacity-40`}
              onClick={async () => {
                setMode(m);
                const changer = changerRef.current;
                if (!changer) return;
                changer.setMode(m);
                if (m === "image" && !changer.hasBackdrop()) {
                  await applyBackdropSelection(changer);
                }
              }}
              data-testid={`btn-mode-${m}`}
            >
              {label}
            </button>
          ))}
        </div>
        {engineDown && (
          <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#8a6d1f]" : "text-amber-200/80"}`} data-testid="engine-down-note">
            Background effects couldn&rsquo;t load — camera is running plain.
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Background quality">
          <span className={`text-xs font-bold uppercase tracking-wider ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>Quality</span>
          {(
            [
              ["auto", "Auto"],
              ["pro", "Pro"],
              ["tasks", "MediaPipe"],
            ] as Array<[BackgroundQuality, string]>
          ).map(([q, label]) => (
            <button
              key={q}
              type="button"
              className={pillBtn(quality === q)}
              onClick={async () => {
                setQualityState(q);
                // Live switch when the camera is running; before the
                // first start it simply rides into the kit's config.
                await changerRef.current?.setQuality(q).catch(() => undefined);
              }}
              data-testid={`btn-quality-${q}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className={`mt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          Auto runs the Pro cutout and steps its quality down on its own if your device can&rsquo;t hold it — it never
          swaps engines behind your back. Pro holds the sharpest cutout. MediaPipe is the lighter per-frame cutout:
          easier on slower devices, less steady when you move. The engine only changes when you change it here.
        </p>
        {phase !== "off" && (
          <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`} data-testid="engine-status">
            Background engine: {engineKind === "pro" ? "Pro" : engineKind === "tasks" ? "MediaPipe Tasks" : "Off"}
          </p>
        )}
        {phase !== "off" && engineDetail?.fellBack && (
          <p className={`mt-1 text-xs font-semibold ${isLight ? "text-[#8a6d1f]" : "text-amber-200/80"}`} data-testid="engine-fallback-note">
            {engineDetail.reason === "pro-stopped"
              ? "Pro engine stopped on this device — camera is running plain. Try MediaPipe, or reopen the studio."
              : engineDetail.reason === "tasks-stopped"
                ? "MediaPipe engine stopped on this device — camera is running plain. Try Pro, or reopen the studio."
                : engineDetail.reason === "tasks-init-failed"
                  ? "MediaPipe engine couldn't start on this device — camera is running plain."
                  : "Pro engine couldn't start on this device — camera is running plain."}
          </p>
        )}
        {greenScreenCueVisible(mode) && (
          <p className={`mt-4 text-xs font-semibold ${isLight ? "text-[#8a6d1f]" : "text-amber-200/80"}`} data-testid="gs-bg-cue">
            Green screen is on — pick any background below, or upload your own photo, and it goes right behind
            you. It&rsquo;s all one step, right here.
          </p>
        )}
        <p className={`mt-4 text-xs font-bold uppercase tracking-wider ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          Your background
        </p>
        <div
          className="mt-2 grid max-h-56 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 md:grid-cols-6"
          role="group"
          aria-label="Your background"
        >
          {BACKDROPS.map((b) => {
            const active = isSelectionActive(backdropSel, { kind: "builtin", id: b.id }) && mode === "image";
            return (
              <button
                key={b.id}
                type="button"
                disabled={engineDown}
                onClick={() => void pickBackdrop({ kind: "builtin", id: b.id })}
                className={`overflow-hidden rounded-lg border p-1 text-center transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  active
                    ? "border-transparent bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C]"
                    : isLight
                      ? "border-[#C9A84C]/30 hover:border-[#C9A84C]"
                      : "border-white/10 hover:border-white/30"
                }`}
                data-testid={`btn-backdrop-${b.id}`}
              >
                <img src={b.uri} alt="" className="aspect-video w-full rounded object-cover" />
                <span className={`mt-1 block text-[11px] font-bold leading-tight ${active ? "text-black" : isLight ? "text-[#6B5B36]" : "text-white/60"}`}>{b.label}</span>
              </button>
            );
          })}
          {customBackdrop && (
            <button
              type="button"
              disabled={engineDown}
              onClick={() => void pickBackdrop({ kind: "custom", name: customBackdrop.name })}
              className={`overflow-hidden rounded-lg border p-1 text-center transition disabled:cursor-not-allowed disabled:opacity-40 ${
                backdropSel.kind === "custom" && mode === "image"
                  ? "border-transparent bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C]"
                  : isLight
                    ? "border-[#C9A84C]/30 hover:border-[#C9A84C]"
                    : "border-white/10 hover:border-white/30"
              }`}
              data-testid="btn-backdrop-custom"
            >
              <img src={customBackdrop.thumb} alt="" className="aspect-video w-full rounded object-cover" />
              <span className={`mt-1 block truncate text-[11px] font-bold leading-tight ${backdropSel.kind === "custom" && mode === "image" ? "text-black" : isLight ? "text-[#6B5B36]" : "text-white/60"}`}>
                {customBackdrop.name}
              </span>
            </button>
          )}
          <label
            className={`cursor-pointer overflow-hidden rounded-lg border border-dashed p-1 text-center transition ${
              isLight
                ? "border-[#C9A84C]/50 hover:border-[#C9A84C]"
                : "border-white/25 hover:border-white/50"
            } ${engineDown ? "pointer-events-none opacity-40" : ""}`}
            data-testid="btn-backdrop-upload"
          >
            <span className={`flex aspect-video w-full flex-col items-center justify-center gap-1 rounded ${isLight ? "text-[#6B5B36]" : "text-white/60"}`}>
              <ImagePlus className="h-5 w-5" />
              <span className="text-[11px] font-bold leading-tight">Upload your photo</span>
            </span>
            <span className={`mt-1 block text-[11px] leading-tight ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
              JPG, PNG or WebP
            </span>
            <input
              type="file"
              accept={BACKDROP_UPLOAD_ACCEPT}
              className="hidden"
              onChange={(e) => {
                void handleBackdropUpload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            id="backdrop-url"
            type="text"
            aria-label="Backdrop image URL"
            placeholder="…or paste your own backdrop image URL"
            className={`${inputCls} min-w-[220px] flex-1`}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const url = (e.target as HTMLInputElement).value.trim();
              if (!url) return;
              void handleBackdropUrl(url);
            }}
          />
        </div>
        {mode !== "none" && (
          <div className="mt-5 border-t border-dashed border-[#C9A84C]/25 pt-4" data-testid="greenscreen-finetune">
            <div className="flex items-center justify-between gap-2">
              <p className={`text-xs font-bold uppercase tracking-wider ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                Fine-tune your cutout
              </p>
              <button
                type="button"
                onClick={resetFineTune}
                className={`text-xs font-bold underline underline-offset-2 ${isLight ? "text-[#8a6d1f]" : "text-amber-200/80"}`}
                data-testid="btn-finetune-reset"
              >
                Reset to standard
              </button>
            </div>
            <p className={`mt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
              Every slider applies live and stays saved on this device. Standard is the picture you already
              know — nothing changes until you move one.
            </p>
            <div className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2">
              {FINE_TUNE_SLIDERS.filter((s) => s.modes.includes(mode)).map((s) => (
                <label key={s.key} className="block">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`text-xs font-bold ${isLight ? "text-[#6B5B36]" : "text-white/60"}`}>{s.label}</span>
                    <span className={`text-xs font-black tabular-nums ${isLight ? "text-[#7A5A12]" : "text-[#fbbf24]"}`}>
                      {s.format(fineTune[s.key])}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={fineTune[s.key]}
                    aria-label={s.label}
                    onChange={(e) => applyFineTune({ [s.key]: Number(e.target.value) })}
                    className="mt-1 w-full accent-[#C9A84C]"
                    data-testid={`slider-finetune-${s.key}`}
                  />
                  <span className={`mt-0.5 block text-[11px] leading-snug ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                    {s.hint}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Camera effects ── */}
      <section className={`mb-6 rounded-2xl border p-5 md:p-6 ${panel}`}>
        <h3 className="text-sm font-black uppercase tracking-widest text-[#fbbf24]">Camera effects</h3>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Camera effect presets">
          {CAMERA_EFFECTS.map((e) => (
            <button
              key={e.id}
              type="button"
              className={pillBtn(camFx === e.id)}
              onClick={() => {
                setCamFx(e.id);
                changerRef.current?.setCameraEffect(e.id);
              }}
              data-testid={`btn-camfx-${e.id}`}
            >
              {e.label}
            </button>
          ))}
        </div>
      </section>

      {/* ── Voice ── */}
      <section className={`rounded-2xl border p-5 md:p-6 ${panel}`}>
        <h3 className="text-sm font-black uppercase tracking-widest text-[#fbbf24]">Voice</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Noise cancellation level">
          <span className="text-xs font-bold uppercase tracking-wider opacity-60">Noise Cancellation</span>
          {(
            [
              ["off", "Off"],
              ["on", "On"],
              ["max", "Max"],
            ] as Array<[NoiseCancellationLevel, string]>
          ).map(([lvl, label]) => (
            <button
              key={lvl}
              type="button"
              className={pillBtn(nc === lvl)}
              onClick={async () => {
                setNc(lvl);
                if (!changerRef.current) {
                  setNcMsg(lvl === "off" ? "Noise cancellation is off — your mic will pass through unchanged." : "Noise cancellation will start with the camera.");
                  return;
                }
                await changerRef.current.setNoiseCancellation(lvl).catch((err) => setNcMsg(describeError(err)));
                wireMicIntoMixer();
              }}
              data-testid={`btn-nc-${lvl}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <VoiceMeter getAnalyser={getAnalyser} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Voice effect presets">
          <span className="text-xs font-bold uppercase tracking-wider opacity-60">Voice Effects</span>
          {VOICE_EFFECTS.map((e) => (
            <button
              key={e.id}
              type="button"
              className={pillBtn(fx === e.id)}
              onClick={async () => {
                setFx(e.id);
                if (!changerRef.current) {
                  setNcMsg(e.id === "none" ? "Voice effects are off." : `${e.label} will be on your voice when you start the camera.`);
                  return;
                }
                await changerRef.current.setVoiceEffect(e.id).catch((err) => setNcMsg(describeError(err)));
                wireMicIntoMixer();
              }}
              data-testid={`btn-fx-${e.id}`}
            >
              {e.label}
            </button>
          ))}
        </div>
        <p className={`mt-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`} role="status">{ncMsg}</p>
      </section>

      {/* ── Mixer & hotkeys ── */}
      <section className={`mt-6 rounded-2xl border p-5 md:p-6 ${panel}`}>
        <MixerPanel
          mixer={mixerRef.current}
          isLight={isLight}
          onChange={bump}
          screenSharing={screenSharing}
          screenHasAudio={screenHasAudio}
        />
        <div className="mt-5 border-t border-dashed border-[#C9A84C]/25 pt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <p className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${isLight ? "text-[#6B5B36]" : "text-zinc-400"}`}>
              <Keyboard className="h-3.5 w-3.5" /> Hotkeys
            </p>
            <button
              type="button"
              role="switch"
              aria-checked={hotkeysOn}
              onClick={() => setHotkeysOn((v) => !v)}
              className={`relative h-5 w-9 rounded-full transition ${hotkeysOn ? "bg-[#C9A84C]" : "bg-zinc-500"}`}
              data-testid="switch-hotkeys"
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${hotkeysOn ? "left-[18px]" : "left-0.5"}`} />
            </button>
          </div>
          <ul className={`grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] sm:grid-cols-3 ${isLight ? "text-[#6B5B36]" : "text-zinc-400"}`}>
            <li><strong>1–9</strong> take scene to Program</li>
            <li><strong>T</strong> transition (fade)</li>
            <li><strong>C</strong> cut to Preview scene</li>
            <li><strong>M</strong> mute / unmute mic</li>
            <li><strong>R</strong> start / stop recording</li>
          </ul>
          <p className={`mt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-zinc-500"}`}>
            Hotkeys pause while you're typing in a field, and R stays out of the way while you're live (the broadcast records itself).
          </p>
        </div>
      </section>

      <p className={`mt-6 flex items-center gap-2 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/35"}`}>
        <RotateCcw className="h-3.5 w-3.5 shrink-0" />
        Everything applies live — switch scenes, backdrops, effects, and voices mid-stream and the audience sees it instantly.
      </p>
    </div>
  );
}
