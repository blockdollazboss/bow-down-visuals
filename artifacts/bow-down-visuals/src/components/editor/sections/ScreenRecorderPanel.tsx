import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  MonitorUp, Video, VideoOff, Mic, MicOff, Pause, Play, Square,
  Download, Send, AlertTriangle, Smartphone, CheckCircle2,
  Captions, Scissors, CalendarClock, Loader2, Monitor, AppWindow, Globe,
  Share2, Link2, BadgeCheck,
} from "lucide-react";
import { Collapsible } from "@/components/editor/controls";
import { useToast } from "@/hooks/use-toast";
import type { SceneData } from "@/lib/scene-parser";

type Phase =
  | "idle" | "settingUp" | "ready" | "countdown"
  | "recording" | "paused" | "review" | "uploading" | "sent";
type SourceHint = "monitor" | "window" | "browser";
type Corner = "tl" | "tr" | "bl" | "br";

interface ScreenRecorderPanelProps {
  scenes: SceneData[];
  setScenes: (update: (prev: SceneData[]) => SceneData[]) => void;
  projectId?: string | null;
  getAccessToken: () => Promise<string | null>;
  onGoToTab: (tab: "timeline" | "captions" | "export") => void;
}

const CORNER_POS: Record<Corner, { x: number; y: number }> = {
  tl: { x: 0.03, y: 0.05 },
  tr: { x: 0.97, y: 0.05 },
  bl: { x: 0.03, y: 0.95 },
  br: { x: 0.97, y: 0.95 },
};
const OVERLAY_W_FRAC = 0.24;

function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const c of candidates) {
    try {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
    } catch { /* ignore */ }
  }
  return "";
}

function formatClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function recordingFileName(ext: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `screen-recording-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}

function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function isSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return !!(
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  );
}

export function ScreenRecorderPanel({
  scenes, setScenes, projectId, getAccessToken, onGoToTab,
}: ScreenRecorderPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const tr = (key: string, opts?: Record<string, string | number>) =>
    t(`videoEditor.screenRecorder.${key}`, opts);

  const [phase, setPhase] = useState<Phase>("idle");
  const [sourceHint, setSourceHint] = useState<SourceHint>("monitor");
  const [webcamOn, setWebcamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [watermarkOn, setWatermarkOn] = useState(false); // opt-in, default clean
  const [introOn, setIntroOn] = useState(false);         // opt-in, default clean
  const [corner, setCorner] = useState<Corner | "custom">("br");
  const [overlayPos, setOverlayPos] = useState<{ x: number; y: number }>(CORNER_POS.br);
  const [countdown, setCountdown] = useState(3);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [reviewName, setReviewName] = useState("");
  const [reviewDuration, setReviewDuration] = useState(0);
  const [sentName, setSentName] = useState("");
  const [sentUrl, setSentUrl] = useState<string | null>(null);

  const screenStreamRef = useRef<MediaStream | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number>(0);
  const meterRafRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const camVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const meterFillRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const elapsedRef = useRef(0);
  const intentionalStopRef = useRef(false);
  const supported = isSupported();
  const mobile = isMobileBrowser();

  /* ── cleanup on unmount ── */
  useEffect(() => () => { stopAllTracks(); cancelLoops(); }, []);

  function cancelLoops() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (meterRafRef.current) cancelAnimationFrame(meterRafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    rafRef.current = 0; meterRafRef.current = 0; timerRef.current = null;
  }

  function stopAllTracks() {
    screenStreamRef.current?.getTracks().forEach((tr2) => tr2.stop());
    camStreamRef.current?.getTracks().forEach((tr2) => tr2.stop());
    screenStreamRef.current = null;
    camStreamRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
    if (camVideoRef.current) camVideoRef.current.srcObject = null;
  }

  function fullReset() {
    intentionalStopRef.current = true;
    stopAllTracks();
    cancelLoops();
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    setReviewUrl(null);
    setSentUrl(null);
    elapsedRef.current = 0;
    setElapsedSec(0);
    setError(null);
    setPhase("idle");
  }

  /* ── mic level meter ── */
  function startMicMeter(stream: MediaStream) {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] ?? 0;
        const level = Math.min(1, sum / data.length / 90);
        if (meterFillRef.current) meterFillRef.current.style.width = `${Math.round(level * 100)}%`;
        meterRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* meter is cosmetic — never block recording */ }
  }

  /* ── step 1: capture screen (+ optional webcam/mic) ── */
  async function beginSetup() {
    setError(null);
    intentionalStopRef.current = false;
    setPhase("settingUp");
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: sourceHint } as MediaTrackConstraints,
        audio: true,
      });
      screenStreamRef.current = screen;
      // If the user stops sharing from the browser chrome, end gracefully.
      // (intentionalStopRef guards our own track.stop() calls, which also fire "ended".)
      screen.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (intentionalStopRef.current) return;
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          finishRecording();
        } else {
          fullReset();
        }
      });

      if (webcamOn || micOn) {
        try {
          const cam = await navigator.mediaDevices.getUserMedia({
            video: webcamOn ? { width: { ideal: 640 }, facingMode: "user" } : false,
            audio: micOn,
          });
          camStreamRef.current = cam;
          if (micOn && cam.getAudioTracks().length > 0) startMicMeter(cam);
        } catch (camErr) {
          // Non-fatal: keep going screen-only, say so plainly.
          camStreamRef.current = null;
          toast({
            title: tr("camMicFallbackTitle"),
            description: tr("camMicFallbackDesc"),
          });
          void camErr;
        }
      }
      setPhase("ready");
    } catch (err) {
      const e = err as DOMException;
      if (e?.name === "NotAllowedError") {
        setError(tr("errDenied"));
      } else {
        setError(tr("errNoSource"));
      }
      setPhase("idle");
    }
  }

  /* ── attach live previews when the ready phase mounts ── */
  useEffect(() => {
    if (phase !== "ready") return;
    const sv = screenVideoRef.current;
    const cv = camVideoRef.current;
    if (sv && screenStreamRef.current) {
      sv.srcObject = screenStreamRef.current;
      void sv.play().catch(() => undefined);
    }
    if (cv && camStreamRef.current && camStreamRef.current.getVideoTracks().length > 0) {
      cv.srcObject = camStreamRef.current;
      void cv.play().catch(() => undefined);
    }
  }, [phase]);

  /* ── step 2: countdown → composite canvas → record ── */
  function startCountdown() {
    // overlayPos already holds the preset or the user's dragged custom spot — keep it.
    setCountdown(3);
    setPhase("countdown");
  }

  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      startRecording();
      return;
    }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdown]);

  function startRecording() {
    const screen = screenStreamRef.current;
    if (!screen) { setError(tr("errNoSource")); setPhase("idle"); return; }
    const track = screen.getVideoTracks()[0];
    const st = track?.getSettings() ?? {};
    const W = st.width && st.width > 0 ? st.width : 1920;
    const H = st.height && st.height > 0 ? st.height : 1080;

    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setError(tr("errCanvas")); setPhase("idle"); return; }

    const sVid = document.createElement("video");
    sVid.muted = true;
    sVid.srcObject = screen;
    void sVid.play().catch(() => undefined);

    const cam = camStreamRef.current;
    const hasCamVideo = !!cam && cam.getVideoTracks().length > 0;
    const cVid = document.createElement("video");
    if (hasCamVideo && cam) {
      cVid.muted = true;
      cVid.srcObject = cam;
      void cVid.play().catch(() => undefined);
    }
    const camTrack = cam?.getVideoTracks()[0];
    const camSt = camTrack?.getSettings() ?? {};
    const camAspect = camSt.width && camSt.height ? camSt.width / camSt.height : 16 / 9;
    /* capture branding choices at record time — toggles can't change mid-take */
    const burnWatermark = watermarkOn;
    const introCard = introOn;
    const recStartMs = performance.now();

    const out = canvas.captureStream(30);
    screen.getAudioTracks().forEach((a) => out.addTrack(a)); // system audio (tab share)
    cam?.getAudioTracks().forEach((a) => out.addTrack(a));   // mic

    const draw = () => {
      const nowMs = performance.now();
      if (introCard && nowMs - recStartMs < 2000) {
        /* opt-in branded intro bumper: first 2 s of the recording */
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, W, H);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#C9A84C";
        ctx.font = `900 ${Math.round(H * 0.09)}px system-ui, sans-serif`;
        ctx.fillText("BOW DOWN VISUALS", W / 2, H / 2 - H * 0.04);
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.font = `600 ${Math.round(H * 0.035)}px system-ui, sans-serif`;
        ctx.fillText("Made with Thy Cheat Code", W / 2, H / 2 + H * 0.05);
      } else {
        ctx.drawImage(sVid, 0, 0, W, H);
        if (hasCamVideo && cVid.videoWidth > 0) {
          const cw = W * OVERLAY_W_FRAC;
          const ch = cw / camAspect;
          const cx = overlayPos.x >= 0.5 ? overlayPos.x * W - cw : overlayPos.x * W;
          const cy = overlayPos.y >= 0.5 ? overlayPos.y * H - ch : overlayPos.y * H;
          const r = Math.min(cw, ch) * 0.08;
          ctx.save();
          ctx.beginPath();
          if (typeof ctx.roundRect === "function") ctx.roundRect(cx, cy, cw, ch, r);
          else ctx.rect(cx, cy, cw, ch);
          ctx.clip();
          ctx.drawImage(cVid, cx, cy, cw, ch);
          ctx.restore();
          ctx.strokeStyle = "rgba(201,168,76,0.9)";
          ctx.lineWidth = Math.max(2, W * 0.002);
          ctx.beginPath();
          if (typeof ctx.roundRect === "function") ctx.roundRect(cx, cy, cw, ch, r);
          else ctx.rect(cx, cy, cw, ch);
          ctx.stroke();
        }
      }
      if (burnWatermark) {
        /* opt-in "Made with Bow Down Visuals" watermark, bottom-right */
        const fs = Math.max(14, Math.round(W * 0.016));
        ctx.font = `700 ${fs}px system-ui, sans-serif`;
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = "rgba(201,168,76,0.85)";
        ctx.fillText("Made with Bow Down Visuals", W - W * 0.02, H - H * 0.025);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    const mime = pickMimeType();
    const rec = mime ? new MediaRecorder(out, { mimeType: mime }) : new MediaRecorder(out);
    chunksRef.current = [];
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data); };
    rec.onstop = () => {
      const type = mime || "video/webm";
      const blob = new Blob(chunksRef.current, { type });
      const url = URL.createObjectURL(blob);
      const name = recordingFileName("webm");
      setReviewUrl(url);
      setReviewName(name);
      setReviewDuration(elapsedRef.current);
      intentionalStopRef.current = true; // our own stopAllTracks fires track "ended"
      stopAllTracks();
      cancelLoops();
      setPhase("review");
    };
    recorderRef.current = rec;
    elapsedRef.current = 0;
    setElapsedSec(0);
    setPhase("recording");
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsedSec(elapsedRef.current);
    }, 1000);
    rec.start(250);
  }

  function pauseRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state === "recording") {
      rec.pause();
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setPhase("paused");
    }
  }

  function resumeRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state === "paused") {
      rec.resume();
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsedSec(elapsedRef.current);
      }, 1000);
      setPhase("recording");
    }
  }

  function finishRecording() {
    intentionalStopRef.current = true;
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else { stopAllTracks(); cancelLoops(); setPhase("idle"); }
  }

  /* ── step 3: review → share / download / send to timeline ── */
  type ShareNavigator = Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string; text?: string; url?: string }) => Promise<void>;
  };

  async function shareRecording() {
    if (!reviewUrl) return;
    const nav = navigator as ShareNavigator;
    try {
      const blob = await (await fetch(reviewUrl)).blob();
      const file = new File([blob], reviewName || recordingFileName("webm"), { type: blob.type || "video/webm" });
      if (typeof nav.canShare === "function" && nav.canShare({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: reviewName, text: tr("shareText") });
        return;
      }
      throw new Error("no-file-share");
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return; // user closed the share sheet
      // Fallback: download it so it can be posted anywhere by hand.
      downloadRecording();
      toast({ title: tr("shareFallbackTitle"), description: tr("shareFallbackDesc") });
    }
  }

  async function shareSentLink() {
    if (!sentUrl) return;
    const nav = navigator as ShareNavigator;
    try {
      if (typeof nav.share === "function") {
        await nav.share({ title: sentName || tr("title"), text: tr("shareText"), url: sentUrl });
        return;
      }
      throw new Error("no-share");
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      await copySentLink();
    }
  }

  async function copySentLink() {
    if (!sentUrl) return;
    try {
      await navigator.clipboard.writeText(sentUrl);
      toast({ title: tr("linkCopiedTitle"), description: tr("linkCopiedDesc") });
    } catch {
      toast({ title: tr("linkCopyFailedTitle"), description: tr("linkCopyFailedDesc"), variant: "destructive" });
    }
  }

  function downloadRecording() {
    if (!reviewUrl) return;
    const a = document.createElement("a");
    a.href = reviewUrl;
    a.download = reviewName || recordingFileName("webm");
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function sendToTimeline() {
    if (!reviewUrl) return;
    setPhase("uploading");
    setError(null);
    try {
      const blob = await (await fetch(reviewUrl)).blob();
      let token: string | null = null;
      try { token = await getAccessToken(); } catch { token = null; }
      if (!token) throw new Error(tr("errSignIn"));

      const form = new FormData();
      form.append("clip", blob, reviewName || recordingFileName("webm"));
      const upRes = await fetch("/api/upload-clip", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const upData = (await upRes.json().catch(() => ({}))) as {
        url?: string; error?: string; message?: string;
      };
      if (!upRes.ok) throw new Error(upData.message ?? upData.error ?? tr("errUpload", { status: upRes.status }));
      if (!upData.url) throw new Error(tr("errUploadNoUrl"));

      const nowIso = new Date().toISOString();
      const newScene: SceneData = {
        id: crypto.randomUUID(),
        sceneNumber: scenes.length + 1,
        timestamp: "",
        section: tr("sceneSection"),
        lyricLine: "",
        location: "",
        action: tr("sceneAction", { duration: formatClock(reviewDuration) }),
        cameraMovement: "",
        lighting: "",
        mood: "",
        aiVideoPrompt: "",
        negativePrompt: "",
        approved: true,
        demoClipUrl: upData.url,
        thumbnailUrl: null,
        clipId: null,
        runwayJobId: null,
        provider: "screen-recorder",
        generationStatus: "completed",
        promptUsed: null,
        generatedAt: nowIso,
      };
      setScenes((prev) => [...prev, newScene]);
      setSentName(reviewName);
      setSentUrl(upData.url);
      setPhase("sent");
      toast({ title: tr("sentToastTitle"), description: tr("sentToastDesc") });
      onGoToTab("timeline");
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("errUploadGeneric"));
      setPhase("review");
    }
  }

  /* ── draggable webcam overlay in the ready-phase preview ── */
  function onOverlayPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const box = previewBoxRef.current;
    const el = e.currentTarget;
    if (!box) return;
    const boxRect = box.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    dragRef.current = {
      dx: e.clientX - elRect.left,
      dy: e.clientY - elRect.top,
    };
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const nx = (ev.clientX - boxRect.left - dragRef.current.dx) / boxRect.width;
      const ny = (ev.clientY - boxRect.top - dragRef.current.dy) / boxRect.height;
      setOverlayPos({ x: Math.min(0.97, Math.max(0.03, nx)), y: Math.min(0.95, Math.max(0.05, ny)) });
      setCorner("custom"); // free-dragged spot — no preset claims it
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const hasCamPreview = webcamOn && !!camStreamRef.current && camStreamRef.current.getVideoTracks().length > 0;
  const sourceOptions: { id: SourceHint; icon: React.ReactNode; label: string }[] = [
    { id: "monitor", icon: <Monitor className="h-4 w-4" />, label: tr("sourceFull") },
    { id: "window", icon: <AppWindow className="h-4 w-4" />, label: tr("sourceWindow") },
    { id: "browser", icon: <Globe className="h-4 w-4" />, label: tr("sourceTab") },
  ];
  const corners: { id: Corner; label: string }[] = [
    { id: "tl", label: tr("cornerTL") },
    { id: "tr", label: tr("cornerTR") },
    { id: "bl", label: tr("cornerBL") },
    { id: "br", label: tr("cornerBR") },
  ];

  return (
    <Collapsible title={tr("title")} defaultOpen={false}>
      <div className="space-y-4">
        {/* header row: free badge */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-white/40 leading-relaxed">{tr("subtitle")}</p>
          <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-full px-2.5 py-1">
            {tr("freeBadge")}
          </span>
        </div>

        {mobile && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/[0.07] border border-amber-500/20">
            <Smartphone className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-200/80 leading-relaxed">{tr("mobileNote")}</p>
          </div>
        )}

        {!supported && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/[0.07] border border-red-500/20">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-200/80 leading-relaxed">{tr("unsupported")}</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/[0.07] border border-red-500/20">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-200/80 leading-relaxed">{error}</p>
          </div>
        )}

        {/* ── idle: options ── */}
        {phase === "idle" && supported && (
          <div className="space-y-4">
            <div>
              <p className="text-[11px] font-black text-white/50 uppercase tracking-widest mb-2">{tr("sourceLabel")}</p>
              <div className="grid grid-cols-3 gap-2">
                {sourceOptions.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setSourceHint(o.id)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-[11px] font-bold transition-colors ${
                      sourceHint === o.id
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-white/10 bg-white/[0.02] text-white/50 hover:text-white hover:bg-white/[0.05]"
                    }`}
                  >
                    {o.icon}
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-white/30 mt-1.5">{tr("sourceHint")}</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setWebcamOn((v) => !v)}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors ${
                  webcamOn
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-white/10 bg-white/[0.02] text-white/50 hover:text-white"
                }`}
              >
                {webcamOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                {tr(webcamOn ? "webcamOn" : "webcamOff")}
              </button>
              <button
                type="button"
                onClick={() => setMicOn((v) => !v)}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors ${
                  micOn
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-white/10 bg-white/[0.02] text-white/50 hover:text-white"
                }`}
              >
                {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                {tr(micOn ? "micOn" : "micOff")}
              </button>
            </div>

            <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-3 space-y-2">
              <div className="flex items-center gap-2">
                <BadgeCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                <p className="text-[11px] font-black text-white/50 uppercase tracking-widest">{tr("brandTitle")}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setWatermarkOn((v) => !v)}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors ${
                    watermarkOn
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-white/10 bg-white/[0.02] text-white/50 hover:text-white"
                  }`}
                >
                  {tr(watermarkOn ? "watermarkOn" : "watermarkOff")}
                </button>
                <button
                  type="button"
                  onClick={() => setIntroOn((v) => !v)}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors ${
                    introOn
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-white/10 bg-white/[0.02] text-white/50 hover:text-white"
                  }`}
                >
                  {tr(introOn ? "introOn" : "introOff")}
                </button>
              </div>
              <p className="text-[10px] text-white/30">{tr("brandNote")}</p>
            </div>

            <button
              type="button"
              onClick={() => void beginSetup()}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-black text-black hover:bg-primary/90 transition-colors"
              data-testid="screen-recorder-start"
            >
              <MonitorUp className="h-4 w-4" />
              {tr("pickSource")}
            </button>
          </div>
        )}

        {phase === "settingUp" && (
          <div className="flex items-center justify-center gap-2 py-8 text-white/50">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-sm font-bold">{tr("settingUp")}</p>
          </div>
        )}

        {/* ── ready: live preview + overlay position ── */}
        {phase === "ready" && (
          <div className="space-y-3">
            <div ref={previewBoxRef} className="relative rounded-xl overflow-hidden border border-white/10 bg-black aspect-video">
              <video ref={screenVideoRef} muted playsInline className="absolute inset-0 h-full w-full object-contain" />
              {hasCamPreview && (
                <div
                  onPointerDown={onOverlayPointerDown}
                  className="absolute cursor-move rounded-lg overflow-hidden border-2 border-primary/80 shadow-lg shadow-black/60 touch-none"
                  style={{
                    width: "24%",
                    aspectRatio: "16 / 9",
                    left: `calc(${(overlayPos.x * 100).toFixed(1)}% ${overlayPos.x >= 0.5 ? "- 24%" : ""})`,
                    top: `${(overlayPos.y * 100).toFixed(1)}%`,
                    transform: overlayPos.y >= 0.5 ? "translateY(-100%)" : undefined,
                  }}
                  title={tr("dragOverlay")}
                >
                  <video ref={camVideoRef} muted playsInline className="h-full w-full object-cover pointer-events-none" />
                </div>
              )}
            </div>

            {webcamOn && (
              <div>
                <p className="text-[11px] font-black text-white/50 uppercase tracking-widest mb-2">{tr("overlayLabel")}</p>
                <div className="grid grid-cols-4 gap-2">
                  {corners.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setCorner(c.id); setOverlayPos(CORNER_POS[c.id]); }}
                      className={`rounded-lg border px-2 py-2 text-[11px] font-bold transition-colors ${
                        corner === c.id
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "border-white/10 bg-white/[0.02] text-white/50 hover:text-white"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-white/30 mt-1.5">{tr("dragHint")}</p>
              </div>
            )}

            {/* mic meter */}
            <div className="flex items-center gap-2">
              <Mic className="h-3.5 w-3.5 text-white/40 shrink-0" />
              <div className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden">
                <div ref={meterFillRef} className="h-full rounded-full bg-primary transition-[width] duration-100" style={{ width: "0%" }} />
              </div>
            </div>

            <button
              type="button"
              onClick={startCountdown}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-black text-black hover:bg-primary/90 transition-colors"
              data-testid="screen-recorder-record"
            >
              <span className="h-3 w-3 rounded-full bg-red-600" />
              {tr("startRecording")}
            </button>
            <button
              type="button"
              onClick={fullReset}
              className="w-full rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-white/50 hover:text-white hover:bg-white/5 transition-colors"
            >
              {tr("chooseDifferent")}
            </button>
          </div>
        )}

        {/* ── countdown ── */}
        {phase === "countdown" && (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <span key={countdown} className="text-6xl font-black text-primary tabular-nums animate-ping" style={{ animationIterationCount: 1, animationDuration: "0.9s" }}>
              {countdown}
            </span>
            <p className="text-xs text-white/40 font-bold">{tr("getReady")}</p>
          </div>
        )}

        {/* ── recording / paused ── */}
        {(phase === "recording" || phase === "paused") && (
          <div className="space-y-4">
            <div className="rounded-xl border border-red-500/25 bg-red-500/[0.06] p-4 flex items-center gap-3">
              <span className={`h-3 w-3 rounded-full ${phase === "recording" ? "bg-red-500 animate-pulse" : "bg-red-500/40"}`} />
              <div className="flex-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-red-300/80">
                  {tr(phase === "recording" ? "recIndicator" : "pausedIndicator")}
                </p>
                <p className="text-2xl font-black text-white tabular-nums">{formatClock(elapsedSec)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Mic className="h-3.5 w-3.5 text-white/40 shrink-0" />
                <div className="h-1.5 w-20 rounded-full bg-white/10 overflow-hidden">
                  <div ref={meterFillRef} className="h-full rounded-full bg-primary transition-[width] duration-100" style={{ width: "0%" }} />
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {phase === "recording" ? (
                <button
                  type="button"
                  onClick={pauseRecording}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/10 transition-colors"
                  data-testid="screen-recorder-pause"
                >
                  <Pause className="h-4 w-4" /> {tr("pause")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={resumeRecording}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-bold text-primary hover:bg-primary/15 transition-colors"
                  data-testid="screen-recorder-resume"
                >
                  <Play className="h-4 w-4" /> {tr("resume")}
                </button>
              )}
              <button
                type="button"
                onClick={finishRecording}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-black hover:bg-primary/90 transition-colors"
                data-testid="screen-recorder-stop"
              >
                <Square className="h-4 w-4" /> {tr("stop")}
              </button>
            </div>
          </div>
        )}

        {/* ── review ── */}
        {phase === "review" && reviewUrl && (
          <div className="space-y-3">
            <div className="rounded-xl overflow-hidden border border-white/10 bg-black">
              <video src={reviewUrl} controls playsInline className="w-full aspect-video" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-white/40 font-mono truncate">{reviewName}</p>
              <p className="text-[11px] text-white/40 tabular-nums shrink-0">{formatClock(reviewDuration)}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={downloadRecording}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/10 transition-colors"
              >
                <Download className="h-4 w-4" /> {tr("download")}
              </button>
              <button
                type="button"
                onClick={() => void shareRecording()}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/10 transition-colors"
                data-testid="screen-recorder-share"
              >
                <Share2 className="h-4 w-4" /> {tr("share")}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void sendToTimeline()}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-black text-black hover:bg-primary/90 transition-colors"
              data-testid="screen-recorder-send-timeline"
            >
              <Send className="h-4 w-4" /> {tr("sendToTimeline")}
            </button>
            <p className="text-[10px] text-white/30 text-center">{tr("uploadNote")}</p>
            <button
              type="button"
              onClick={fullReset}
              className="w-full rounded-xl px-4 py-2 text-xs font-bold text-white/40 hover:text-white transition-colors"
            >
              {tr("recordAgain")}
            </button>
          </div>
        )}

        {phase === "uploading" && (
          <div className="flex items-center justify-center gap-2 py-8 text-white/50">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-sm font-bold">{tr("uploading")}</p>
          </div>
        )}

        {/* ── sent: handoff chain ── */}
        {phase === "sent" && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-emerald-500/[0.07] border border-emerald-500/20">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-emerald-200/80 leading-relaxed">
                {tr("sentDesc", { name: sentName })}
              </p>
            </div>
            <p className="text-[11px] font-black text-white/50 uppercase tracking-widest">{tr("nextSteps")}</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void shareSentLink()}
                className="flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/[0.07] px-3 py-2.5 text-xs font-bold text-primary hover:bg-primary/[0.12] transition-colors"
              >
                <Share2 className="h-4 w-4" /> {tr("shareLink")}
              </button>
              <button
                type="button"
                onClick={() => void copySentLink()}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-xs font-bold text-white hover:bg-white/10 transition-colors"
              >
                <Link2 className="h-4 w-4" /> {tr("copyLink")}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => onGoToTab("captions")}
                className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-left hover:bg-white/[0.05] hover:border-white/20 transition-colors"
              >
                <Captions className="h-4 w-4 text-primary shrink-0" />
                <span className="text-xs font-bold text-white">{tr("goCaptions")}</span>
              </button>
              <button
                type="button"
                onClick={() => onGoToTab("export")}
                className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-left hover:bg-white/[0.05] hover:border-white/20 transition-colors"
              >
                <Scissors className="h-4 w-4 text-primary shrink-0" />
                <span className="text-xs font-bold text-white">{tr("goSmartClips")}</span>
              </button>
              <Link
                href="/scheduler"
                className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-left hover:bg-white/[0.05] hover:border-white/20 transition-colors"
              >
                <CalendarClock className="h-4 w-4 text-primary shrink-0" />
                <span className="text-xs font-bold text-white">{tr("goScheduler")}</span>
              </Link>
            </div>
            <button
              type="button"
              onClick={fullReset}
              className="w-full rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-white/50 hover:text-white hover:bg-white/5 transition-colors"
            >
              {tr("recordAnother")}
            </button>
          </div>
        )}
      </div>
    </Collapsible>
  );
}
