import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Radio, Square, Loader2, AlertTriangle, Camera, Mic, Users, Clock,
  Megaphone, Video, VideoOff, CheckCircle2, RotateCcw,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { Button } from "@/components/ui/button";
import {
  BackgroundChanger,
  BackgroundChangerError,
  CAMERA_EFFECTS,
  type BackgroundMode,
} from "@/lib/stream-kit/background-changer";
import { VOICE_EFFECTS, type NoiseCancellationLevel } from "@/lib/stream-kit/voice-isolator";
import { BACKDROPS, BACKDROP_URIS } from "@/lib/stream-kit/backdrops";
import { WhipTransport, TransportError, type TransportState } from "@/lib/stream-kit/transport";
import { StreamRecorder } from "@/lib/stream-kit/stream-recorder";

/* ─── Broadcast Studio — the "Broadcast" tab of the /go-live hub ──────────
   Our OBS: the Live Camera kit (backdrops, camera effects, noise
   cancellation, voice effects) feeding ONE processed stream, published
   through a StreamTransport (transport.ts). WHIP-to-Cloudflare is the
   first transport; the UI never touches WHIP itself, so a second
   transport (a companion app's virtual camera/mic) slots in behind the
   same interface later.

   While live, the browser also records the processed feed (StreamRecorder)
   and on End Stream the recording uploads through the site's storage path
   and registers on the stream — it lands in the creator's clips library.
   If the recording fails, the stream still ends cleanly and the UI says
   the recording didn't save. Going live is free (no credit charge). */

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

export default function BroadcastStudio() {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("off");
  const [title, setTitle] = useState("");
  const [cameras, setCameras] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [mics, setMics] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [cameraId, setCameraId] = useState("");
  const [micId, setMicId] = useState("");
  const [mode, setMode] = useState<BackgroundMode>("green");
  const [backdropId, setBackdropId] = useState("stage");
  const [camFx, setCamFx] = useState("none");
  const [nc, setNc] = useState<NoiseCancellationLevel>("on");
  const [fx, setFx] = useState("none");
  const [mirror, setMirror] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Camera is off. Start it to check your picture and sound before you go live.");
  const [ncMsg, setNcMsg] = useState("Noise cancellation starts with the camera.");
  const [configured, setConfigured] = useState<boolean | null>(null);
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

  const getAnalyser = useCallback(() => changerRef.current?.getAnalyser() ?? null, []);

  const previewRef = useRef<HTMLVideoElement>(null);
  const changerRef = useRef<BackgroundChanger | null>(null);
  const transportRef = useRef<WhipTransport | null>(null);
  const recorderRef = useRef<StreamRecorder | null>(null);
  const phaseRef = useRef<Phase>("off");
  phaseRef.current = phase;

  const panel = isLight
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const inputCls = isLight
    ? "w-full rounded-xl border border-[#C9A84C]/40 bg-white/70 px-4 py-2.5 text-sm text-[#2A1E07] placeholder:text-[#6B5B36]/60 focus:outline-none focus:border-[#C9A84C]"
    : "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm placeholder:text-white/25 focus:outline-none focus:border-amber-400/60";
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
        const d = (await res.json()) as { configured: boolean; live_stream: LiveStreamOwnerDto | null };
        setConfigured(d.configured);
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
    void loadStatus();
  }, [getAccessToken, loadStatus]);

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

  async function startCamera() {
    setPhase("starting");
    setStatusMsg("Starting the camera and loading the effects engine…");
    try {
      if (!changerRef.current) {
        changerRef.current = new BackgroundChanger({
          mode,
          audio: true,
          noiseCancellation: nc,
          voiceEffect: fx,
          cameraEffect: camFx,
          mirror,
          onNoiseStatus: (s) => setNcMsg(s.message),
        });
      }
      const changer = changerRef.current;
      const { stream } = await changer.start(cameraId || undefined);
      if (previewRef.current) previewRef.current.srcObject = stream;
      if (mode === "image" && !changer.hasBackdrop()) {
        await changer.setImage(BACKDROP_URIS[backdropId] ?? null);
      }
      setPhase("preview");
      setStatusMsg("That's your feed — exactly what viewers will see. Pick a title and go live when you're ready.");
      await refreshDevices();
    } catch (err) {
      setPhase("off");
      setStatusMsg(describeError(err));
      toast({ title: "Camera didn't start", description: describeError(err), variant: "destructive" });
    }
  }

  async function stopCamera() {
    if (phase === "live" || phase === "connecting" || phase === "ending") return;
    await changerRef.current?.stop();
    changerRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
    setPhase("off");
    setStatusMsg("Camera is off.");
  }

  async function goLive() {
    const changer = changerRef.current;
    const stream = changer?.getStream();
    if (!changer || !stream) return;
    if (!title.trim()) {
      toast({ title: "Give your stream a title", description: "Viewers find you by it in the Live rail.", variant: "destructive" });
      return;
    }
    setRecordNote(null);
    setLastVodUrl(null);
    setAnnouncedLive(false);
    setAnnouncedEnd(false);
    setPhase("connecting");
    const transport = new WhipTransport();
    transportRef.current = transport;
    transport.onStateChange((s: TransportState) => {
      if (s === "failed" && phaseRef.current === "connecting") setPhase("preview");
    });
    try {
      await transport.start(stream, { title: title.trim() });
      const id = transport.streamId;
      setLiveId(id);
      setLiveSince(Date.now());
      setElapsed(0);
      setViewerCount(0);
      setPhase("live");
      setStatusMsg("You're live. Your stream is on your profile and in the Live rail on Explore.");
      // Record the same processed feed for the VOD. A recorder failure
      // never touches the broadcast — it just means no replay.
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
    } catch (err) {
      setPhase("preview");
      const msg =
        err instanceof TransportError && err.code === "NOT_CONFIGURED"
          ? "Live streaming isn't switched on yet on this site. Your camera kit works — broadcasting turns on the moment the owner enables it."
          : describeError(err);
      setStatusMsg(msg);
      toast({ title: "Couldn't go live", description: msg, variant: "destructive" });
    }
  }

  async function endStream() {
    const transport = transportRef.current;
    if (!transport) return;
    setPhase("ending");
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
    setStatusMsg("You're off air. That was the show — post the replay to Discord from the Announce tab if you want the crowd to catch it.");

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

  const isLivePhase = phase === "live" || phase === "ending";
  const watchPath = liveId ? `/live/${liveId}` : null;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-6 md:px-8">
      <div className="mb-6">
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[#d4a017]/40 bg-[#d4a017]/10 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-[#fbbf24]">
          <Radio className="h-3 w-3" aria-hidden="true" /> Broadcast studio
        </p>
        <h2 className="text-2xl font-black tracking-tight md:text-3xl">Go live right here — no extra software.</h2>
        <p className={`mt-2 max-w-2xl text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          Your camera, your backdrop, your sound — cleaned up and broadcast straight from this page to your profile.
          Free to stream; the whole kit below is yours to shape before and during the show.
        </p>
      </div>

      {configured === false && (
        <div className={`mb-6 flex items-start gap-3 rounded-xl border p-4 ${panel}`}>
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="text-sm">
            <p className="font-bold">Live streaming isn't switched on yet.</p>
            <p className={isLight ? "text-[#6B5B36]" : "text-white/50"}>
              The studio below fully works — camera, backdrops, effects, clean voice. Broadcasting turns on the
              moment the site owner enables it; until then, Go Live will tell you the same thing instead of faking it.
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

      {/* ── Stage ── */}
      <section className={`relative mb-6 rounded-2xl border p-4 md:p-5 ${panel}`}>
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
          <video ref={previewRef} autoPlay playsInline muted className="h-full w-full object-contain" data-testid="broadcast-preview" />
          {phase === "off" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <VideoOff className="h-8 w-8 text-[#C9A84C]/60" />
              <p className="text-sm font-bold text-white/80">Your processed feed shows here.</p>
              <p className="max-w-sm text-xs text-white/40">Start the camera, allow access, and pick what's behind you. Everything runs in your browser.</p>
            </div>
          )}
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
        </div>

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
              disabled={phase !== "preview"}
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
        {phase === "preview" && (
          <p className={`mt-2 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
            Go Live needs the camera running — what you see above is exactly what goes out.
          </p>
        )}
        {isLivePhase && watchPath && (
          <p className={`mt-2 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
            Watching: <Link href={watchPath} className="font-bold text-amber-400 underline underline-offset-2">{watchPath}</Link> — share it anywhere; viewers watch right here on the site.
          </p>
        )}
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

      {/* ── Behind me ── */}
      <section className={`mb-6 rounded-2xl border p-5 md:p-6 ${panel}`}>
        <h3 className="text-sm font-black uppercase tracking-widest text-[#fbbf24]">Behind me</h3>
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
              className={pillBtn(mode === m)}
              onClick={async () => {
                setMode(m);
                const changer = changerRef.current;
                if (!changer) return;
                changer.setMode(m);
                if (m === "image" && !changer.hasBackdrop()) {
                  await changer.setImage(BACKDROP_URIS[backdropId] ?? null).catch(() => undefined);
                }
              }}
              data-testid={`btn-mode-${m}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid max-h-56 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 md:grid-cols-6">
          {BACKDROPS.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={async () => {
                setBackdropId(b.id);
                setMode("image");
                const changer = changerRef.current;
                if (!changer) {
                  setStatusMsg("Start the camera, then your backdrop applies.");
                  return;
                }
                changer.setMode("image");
                await changer.setImage(b.uri).catch((err) => setStatusMsg(describeError(err)));
              }}
              className={`overflow-hidden rounded-lg border p-1 text-center transition ${
                backdropId === b.id && mode === "image"
                  ? "border-transparent bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C]"
                  : isLight
                    ? "border-[#C9A84C]/30 hover:border-[#C9A84C]"
                    : "border-white/10 hover:border-white/30"
              }`}
              data-testid={`btn-backdrop-${b.id}`}
            >
              <img src={b.uri} alt="" className="aspect-video w-full rounded object-cover" />
              <span className={`mt-1 block text-[11px] font-bold leading-tight ${backdropId === b.id && mode === "image" ? "text-black" : isLight ? "text-[#6B5B36]" : "text-white/60"}`}>{b.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            id="backdrop-url"
            type="text"
            placeholder="…or paste your own backdrop image URL"
            className={`${inputCls} min-w-[220px] flex-1`}
            onKeyDown={async (e) => {
              if (e.key !== "Enter") return;
              const url = (e.target as HTMLInputElement).value.trim();
              if (!url || !changerRef.current) return;
              setMode("image");
              changerRef.current.setMode("image");
              await changerRef.current.setImage(url).catch((err) => setStatusMsg(describeError(err)));
            }}
          />
          <label className={`cursor-pointer rounded-lg border px-3 py-2 text-xs font-bold ${isLight ? "border-[#C9A84C]/40 text-[#6B5B36]" : "border-white/10 text-white/60"}`}>
            Upload backdrop
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file || !changerRef.current) return;
                setMode("image");
                changerRef.current.setMode("image");
                await changerRef.current.setImage(file).catch((err) => setStatusMsg(describeError(err)));
              }}
            />
          </label>
        </div>
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
              }}
              data-testid={`btn-fx-${e.id}`}
            >
              {e.label}
            </button>
          ))}
        </div>
        <p className={`mt-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`} role="status">{ncMsg}</p>
      </section>

      <p className={`mt-6 flex items-center gap-2 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/35"}`}>
        <RotateCcw className="h-3.5 w-3.5 shrink-0" />
        Everything you set here applies live — switch backdrops, effects, and voices mid-stream and the audience sees it instantly.
      </p>
    </div>
  );
}
