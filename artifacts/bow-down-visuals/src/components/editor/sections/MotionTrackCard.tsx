import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import type { SceneData } from "@/lib/scene-parser";
import { EditorCard } from "@/components/editor/controls";
import {
  Crosshair, Loader2, Play, Download, Share2, Sparkles, Shield,
  Sticker, Type, Zap, Check, Plus, Trash2, Eye,
} from "lucide-react";

/* ── Motion Track card (Video Editor → Pro Tools) ────────────────────────
 * CapCut-parity motion tracking: pick a subject, the server tracks it
 * across frames (template matching — honest AI tracking, confidence is
 * reported), then burn a following text label, sticker, or blur/pixelate
 * box onto the clip. Blur-follow is the privacy use case.
 * Manual anchor mode = honest keyframed follow (no fake "AI" claims).
 * Handoff: "Use in editor" replaces the scene clip → captions → export. */

interface TrackPoint { t: number; x: number; y: number; w: number; h: number; conf?: number }
interface TrackResult {
  points: TrackPoint[];
  sampleFps: number;
  width: number;
  height: number;
  startSec: number;
  duration: number;
  avgConfidence: number;
  lowConfidence: boolean;
}

type FollowMode = "text" | "sticker" | "blur" | "pixelate";

function smoothstep(a: number, b: number, x: number): number {
  const u = Math.min(1, Math.max(0, (x - a) / Math.max(1e-6, b - a)));
  return u * u * (3 - 2 * u);
}

function interpPoints(points: TrackPoint[], t: number): TrackPoint {
  if (t <= points[0].t) return points[0];
  const last = points[points.length - 1];
  if (t >= last.t) return last;
  for (let k = 0; k < points.length - 1; k++) {
    const a = points[k], b = points[k + 1];
    if (t >= a.t && t <= b.t) {
      const s = smoothstep(a.t, b.t, t);
      return {
        t,
        x: a.x + (b.x - a.x) * s,
        y: a.y + (b.y - a.y) * s,
        w: a.w + (b.w - a.w) * s,
        h: a.h + (b.h - a.h) * s,
      };
    }
  }
  return last;
}

const MODE_META: { id: FollowMode; icon: React.ReactNode }[] = [
  { id: "blur", icon: <Shield className="h-4 w-4" /> },
  { id: "text", icon: <Type className="h-4 w-4" /> },
  { id: "sticker", icon: <Sticker className="h-4 w-4" /> },
  { id: "pixelate", icon: <Zap className="h-4 w-4" /> },
];

export function MotionTrackCard({
  scene,
  onReplaceClipVideo,
}: {
  scene: SceneData | null;
  onReplaceClipVideo?: (sceneId: string, url: string) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resultVideoRef = useRef<HTMLVideoElement | null>(null);
  const pollTimer = useRef<number | null>(null);

  /* Target selection */
  const [boxX, setBoxX] = useState(0.5);   // center, relative
  const [boxY, setBoxY] = useState(0.5);
  const [boxW, setBoxW] = useState(0.16);
  const [boxH, setBoxH] = useState(0.2);
  const [startSec, setStartSec] = useState(0);
  const [durationSec, setDurationSec] = useState(10);

  /* Tracking */
  const [tracking, setTracking] = useState(false);
  const [trackStage, setTrackStage] = useState("");
  const [trackProgress, setTrackProgress] = useState(0);
  const [trackJobId, setTrackJobId] = useState<string | null>(null);
  const [trackResult, setTrackResult] = useState<TrackResult | null>(null);

  /* Manual anchors (honest keyframed follow) */
  const [anchors, setAnchors] = useState<TrackPoint[]>([]);
  const [useManual, setUseManual] = useState(false);

  /* Burn-in */
  const [mode, setMode] = useState<FollowMode>("blur");
  const [labelText, setLabelText] = useState("");
  const [textStyle, setTextStyle] = useState<"clean" | "glow">("glow");
  const [textPosition, setTextPosition] = useState<"above" | "below" | "center">("above");
  const [stickerUrl, setStickerUrl] = useState("");
  const [blurStrength, setBlurStrength] = useState(2);
  const [attribution, setAttribution] = useState(true);
  const [applying, setApplying] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultRef, setResultRef] = useState<string | null>(null);

  /* Share */
  const [accounts, setAccounts] = useState<{ id: string; platform: string; username: string | null; expired: boolean }[]>([]);
  const [sharing, setSharing] = useState<string | null>(null);

  const clipUrl = scene?.demoClipUrl ?? null;

  useEffect(() => () => {
    if (pollTimer.current) window.clearInterval(pollTimer.current);
  }, []);

  /* Live box overlay position while previewing the track */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || (!trackResult && !useManual)) return;
    const onTime = () => setTick((x) => x + 1);
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [trackResult, useManual]);

  const previewPoint: TrackPoint | null = useMemo(() => {
    const pts = useManual ? anchors : trackResult?.points;
    const v = videoRef.current;
    if (!pts || pts.length < 2 || !v) return null;
    return interpPoints(pts, v.currentTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackResult, anchors, useManual, tick]);

  const pathD = useMemo(() => {
    const pts = useManual ? anchors : trackResult?.points;
    if (!pts || pts.length < 2) return "";
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${(p.x * 100).toFixed(1)},${(p.y * 100).toFixed(1)}`).join(" ");
  }, [trackResult, anchors, useManual]);

  function placeBox(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setBoxX(Math.min(0.98, Math.max(0.02, (e.clientX - rect.left) / rect.width)));
    setBoxY(Math.min(0.98, Math.max(0.02, (e.clientY - rect.top) / rect.height)));
  }

  function grabCurrentFrame() {
    const v = videoRef.current;
    if (v) setStartSec(Math.round(v.currentTime * 10) / 10);
  }

  async function handleTrack() {
    if (!clipUrl) {
      toast({ title: t("videoEditor.motionTrack.noClip"), variant: "destructive" });
      return;
    }
    setTracking(true);
    setTrackResult(null);
    setTrackJobId(null);
    setTrackProgress(0);
    try {
      const res = await confirmedFetch("/api/motion-track/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: clipUrl,
          box: {
            x: Math.max(0, boxX - boxW / 2),
            y: Math.max(0, boxY - boxH / 2),
            w: boxW,
            h: boxH,
          },
          startSec,
          durationSec,
          sampleFps: 5,
        }),
      });
      if (!res) return;
      const body = await res.json().catch(() => ({}));
      if (res.status === 402) {
        toast({ title: t("videoEditor.motionTrack.outOfBucs"), variant: "destructive" });
        return;
      }
      if (!res.ok || !body.jobId) throw new Error(body.error ?? t("videoEditor.motionTrack.trackFailed"));
      const jobId = body.jobId as string;
      setTrackJobId(jobId);
      pollTimer.current = window.setInterval(async () => {
        try {
          const pr = await fetch(`/api/motion-track/job/${jobId}`);
          const jb = await pr.json().catch(() => ({}));
          if (!pr.ok) throw new Error(jb.error ?? "Track job lost.");
          setTrackStage(jb.stage ?? "");
          setTrackProgress(jb.progress ?? 0);
          if (jb.state === "done") {
            if (pollTimer.current) window.clearInterval(pollTimer.current);
            setTrackResult(jb.result as TrackResult);
            setUseManual(false);
            setTracking(false);
            toast({ title: t("videoEditor.motionTrack.trackReady") });
          } else if (jb.state === "failed") {
            if (pollTimer.current) window.clearInterval(pollTimer.current);
            setTracking(false);
            throw new Error(jb.error ?? t("videoEditor.motionTrack.trackFailed"));
          }
        } catch (err) {
          if (pollTimer.current) window.clearInterval(pollTimer.current);
          setTracking(false);
          toast({
            title: t("videoEditor.motionTrack.trackFailed"),
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          });
        }
      }, 2000);
    } catch (err) {
      setTracking(false);
      toast({
        title: t("videoEditor.motionTrack.trackFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  function addAnchor() {
    const v = videoRef.current;
    if (!v) return;
    const a: TrackPoint = { t: Math.round(v.currentTime * 100) / 100, x: boxX, y: boxY, w: boxW, h: boxH };
    setAnchors((prev) => [...prev, a].sort((p, q) => p.t - q.t));
  }

  const activePoints: TrackPoint[] | null =
    useManual ? (anchors.length >= 2 ? anchors : null)
    : trackResult && trackResult.points.length >= 2 ? trackResult.points : null;

  async function handleApply() {
    if (!clipUrl) return;
    if (!activePoints) {
      toast({ title: t("videoEditor.motionTrack.noTrack"), variant: "destructive" });
      return;
    }
    if (mode === "text" && !labelText.trim()) {
      toast({ title: t("videoEditor.motionTrack.needText"), variant: "destructive" });
      return;
    }
    if (mode === "sticker" && !stickerUrl.trim()) {
      toast({ title: t("videoEditor.motionTrack.needSticker"), variant: "destructive" });
      return;
    }
    setApplying(true);
    setResultUrl(null);
    try {
      const res = await confirmedFetch("/api/motion-track/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: clipUrl,
          /* trackJobId makes the apply free (already paid); points ride along
             as a fallback if the server lost the job (e.g. a redeploy). */
          ...(trackJobId && !useManual ? { trackJobId } : {}),
          ...(activePoints ? { points: activePoints, startSec, durationSec } : {}),
          mode,
          text: labelText.trim() || undefined,
          textStyle,
          textPosition,
          stickerUrl: stickerUrl.trim() || undefined,
          blurStrength,
          attribution,
        }),
      });
      if (!res) return;
      const body = await res.json().catch(() => ({}));
      if (res.status === 402) {
        toast({ title: t("videoEditor.motionTrack.outOfBucs"), variant: "destructive" });
        return;
      }
      if (!res.ok || !body.url) throw new Error(body.error ?? t("videoEditor.motionTrack.applyFailed"));
      setResultUrl(body.url as string);
      setResultRef((body.storageRef as string) ?? null);
      toast({ title: t("videoEditor.motionTrack.applyReady") });
      void loadAccounts();
    } catch (err) {
      toast({
        title: t("videoEditor.motionTrack.applyFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setApplying(false);
    }
  }

  async function loadAccounts() {
    try {
      const r = await fetch("/api/social/accounts");
      const b = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(b.accounts)) setAccounts(b.accounts);
    } catch { /* share section stays hidden */ }
  }

  async function handleShare(platform: "instagram" | "facebook" | "tiktok", accountId: string) {
    if (!resultUrl && !resultRef) return;
    setSharing(platform);
    try {
      const res = await confirmedFetch(`/api/social/${platform}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          videoUrl: resultRef ?? resultUrl,
          caption: t("videoEditor.motionTrack.shareCaption"),
          idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        }),
      });
      if (!res) return;
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? body.message ?? t("videoEditor.motionTrack.shareFailed"));
      toast({ title: t("videoEditor.motionTrack.shareOk", { platform }) });
    } catch (err) {
      toast({
        title: t("videoEditor.motionTrack.shareFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSharing(null);
    }
  }

  function handleUseInEditor() {
    if (!scene || !resultUrl || !onReplaceClipVideo) return;
    onReplaceClipVideo(scene.id, resultUrl);
    toast({ title: t("videoEditor.motionTrack.usedInEditor") });
  }

  if (!clipUrl) {
    return (
      <EditorCard
        title={t("videoEditor.motionTrack.title")}
        subtitle={t("videoEditor.motionTrack.subtitle")}
        icon={<Crosshair className="h-4 w-4" />}
      >
        <p className="text-white/40 text-sm">{t("videoEditor.motionTrack.noClip")}</p>
      </EditorCard>
    );
  }

  const boxStyle = previewPoint
    ? {
        left: `${(previewPoint.x - previewPoint.w / 2) * 100}%`,
        top: `${(previewPoint.y - previewPoint.h / 2) * 100}%`,
        width: `${previewPoint.w * 100}%`,
        height: `${previewPoint.h * 100}%`,
      }
    : {
        left: `${(boxX - boxW / 2) * 100}%`,
        top: `${(boxY - boxH / 2) * 100}%`,
        width: `${boxW * 100}%`,
        height: `${boxH * 100}%`,
      };

  const shareTargets = (["instagram", "tiktok", "facebook"] as const)
    .map((platform) => ({
      platform,
      account: accounts.find((a) => a.platform === platform && !a.expired),
    }))
    .filter((s) => s.account);

  return (
    <EditorCard
      title={t("videoEditor.motionTrack.title")}
      subtitle={t("videoEditor.motionTrack.subtitle")}
      icon={<Crosshair className="h-4 w-4" />}
      right={<span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border border-[#C9A84C]/50 bg-[#C9A84C]/10 text-[#F5D576]">{t("videoEditor.motionTrack.costChip")}</span>}
    >
      <div className="space-y-5">
        {/* ── Step 1: pick the subject ── */}
        <div>
          <p className="text-[11px] font-black text-white/50 uppercase tracking-widest mb-2">
            {t("videoEditor.motionTrack.step1")}
          </p>
          <div
            className="relative rounded-xl overflow-hidden border border-white/10 bg-black cursor-crosshair select-none"
            onClick={placeBox}
            data-testid="motion-track-picker"
          >
            <video
              ref={videoRef}
              src={clipUrl}
              controls
              playsInline
              preload="metadata"
              className="w-full max-h-[320px] object-contain bg-black"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="absolute inset-0 pointer-events-none">
              {pathD && (
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <path d={pathD} fill="none" stroke="#C9A84C" strokeOpacity="0.55" strokeWidth="0.6" vectorEffect="non-scaling-stroke" strokeDasharray="2 1.5" />
                </svg>
              )}
              <div
                className="absolute border-2 border-[#C9A84C] rounded-sm shadow-[0_0_18px_rgba(201,168,76,0.55)]"
                style={boxStyle}
              >
                <div className="absolute -top-1 -left-1 h-3 w-3 border-t-2 border-l-2 border-[#F5D576]" />
                <div className="absolute -bottom-1 -right-1 h-3 w-3 border-b-2 border-r-2 border-[#F5D576]" />
              </div>
            </div>
          </div>
          <p className="text-[11px] text-white/35 mt-1.5">{t("videoEditor.motionTrack.pickHint")}</p>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <label className="text-xs text-white/60">
              {t("videoEditor.motionTrack.boxWidth")}
              <input type="range" min={4} max={60} value={Math.round(boxW * 100)} onChange={(e) => setBoxW(Number(e.target.value) / 100)} className="w-full accent-[#C9A84C]" />
            </label>
            <label className="text-xs text-white/60">
              {t("videoEditor.motionTrack.boxHeight")}
              <input type="range" min={4} max={60} value={Math.round(boxH * 100)} onChange={(e) => setBoxH(Number(e.target.value) / 100)} className="w-full accent-[#C9A84C]" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              onClick={grabCurrentFrame}
              className="text-xs font-bold px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-white/70 hover:border-[#C9A84C]/50 transition-colors"
            >
              {t("videoEditor.motionTrack.useCurrentFrame")}
            </button>
            <label className="text-xs text-white/60 flex items-center gap-1.5">
              {t("videoEditor.motionTrack.startAt")}
              <input
                type="number" min={0} step={0.1} value={startSec}
                onChange={(e) => setStartSec(Math.max(0, Number(e.target.value) || 0))}
                className="w-16 bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1 text-white text-xs"
              />s
            </label>
            <label className="text-xs text-white/60 flex items-center gap-1.5">
              {t("videoEditor.motionTrack.trackFor")}
              <input
                type="number" min={1} max={60} step={1} value={durationSec}
                onChange={(e) => setDurationSec(Math.min(60, Math.max(1, Number(e.target.value) || 10)))}
                className="w-16 bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1 text-white text-xs"
              />s
            </label>
          </div>
        </div>

        {/* ── Step 2: track ── */}
        <div>
          <p className="text-[11px] font-black text-white/50 uppercase tracking-widest mb-2">
            {t("videoEditor.motionTrack.step2")}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleTrack}
              disabled={tracking}
              data-testid="motion-track-run"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm text-black bg-gradient-to-b from-[#F5D576] to-[#C9A84C] hover:brightness-110 disabled:opacity-50 transition-all shadow-[0_0_20px_rgba(201,168,76,0.35)]"
            >
              {tracking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {tracking ? t("videoEditor.motionTrack.tracking") : t("videoEditor.motionTrack.trackButton")}
            </button>
            <button
              type="button"
              onClick={addAnchor}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold border border-white/10 bg-white/[0.04] text-white/70 hover:border-[#C9A84C]/50 transition-colors"
              title={t("videoEditor.motionTrack.addAnchorHint")}
            >
              <Plus className="h-3.5 w-3.5" /> {t("videoEditor.motionTrack.addAnchor")}
            </button>
          </div>
          {tracking && (
            <div className="mt-3">
              <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#C9A84C] to-[#F5D576] transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(3, trackProgress))}%` }}
                />
              </div>
              <p className="text-[11px] text-white/40 mt-1.5">{trackStage || t("videoEditor.motionTrack.starting")} · {Math.round(trackProgress)}%</p>
            </div>
          )}
          {trackResult && !useManual && (
            <div className="mt-3 flex items-center gap-2 text-xs">
              <span className={`px-2 py-1 rounded-full font-black ${trackResult.lowConfidence ? "bg-amber-500/15 text-amber-300 border border-amber-500/30" : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"}`}>
                {t("videoEditor.motionTrack.confidence", { pct: Math.round(trackResult.avgConfidence * 100) })}
              </span>
              <span className="text-white/40">{t("videoEditor.motionTrack.aiTrackedNote")}</span>
            </div>
          )}
          {anchors.length > 0 && (
            <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-black text-white/50 uppercase tracking-widest">
                  {t("videoEditor.motionTrack.anchors", { count: anchors.length })}
                </p>
                <button
                  type="button"
                  onClick={() => setUseManual((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-bold text-[#C9A84C]"
                >
                  <Eye className="h-3.5 w-3.5" />
                  {useManual ? t("videoEditor.motionTrack.usingManual") : t("videoEditor.motionTrack.useManual")}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {anchors.map((a, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-white/[0.05] border border-white/10 text-white/60">
                    {a.t.toFixed(1)}s
                    <button type="button" onClick={() => setAnchors((p) => p.filter((_, k) => k !== i))} className="text-white/30 hover:text-red-400">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-white/35 mt-2">{t("videoEditor.motionTrack.anchorNote")}</p>
            </div>
          )}
        </div>

        {/* ── Step 3: follow mode + burn in ── */}
        <div>
          <p className="text-[11px] font-black text-white/50 uppercase tracking-widest mb-2">
            {t("videoEditor.motionTrack.step3")}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {MODE_META.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                data-testid={`motion-track-mode-${m.id}`}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide border transition-all ${
                  mode === m.id
                    ? "border-[#C9A84C] bg-[#C9A84C]/15 text-[#F5D576] shadow-[0_0_16px_rgba(201,168,76,0.3)]"
                    : "border-white/10 bg-white/[0.03] text-white/50 hover:border-white/25"
                }`}
              >
                {m.icon}
                {t(`videoEditor.motionTrack.mode.${m.id}`)}
              </button>
            ))}
          </div>
          {mode === "blur" && (
            <p className="mt-2 text-[11px] text-[#C9A84C]/80 font-bold flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" /> {t("videoEditor.motionTrack.blurPrivacyNote")}
            </p>
          )}

          <div className="mt-3 space-y-3">
            {mode === "text" && (
              <>
                <input
                  type="text"
                  value={labelText}
                  onChange={(e) => setLabelText(e.target.value)}
                  maxLength={80}
                  placeholder={t("videoEditor.motionTrack.textPlaceholder")}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#C9A84C]/60"
                />
                <div className="flex flex-wrap gap-2">
                  {(["clean", "glow"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setTextStyle(s)}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                        textStyle === s ? "border-[#C9A84C] bg-[#C9A84C]/15 text-[#F5D576]" : "border-white/10 text-white/50"
                      }`}
                    >
                      {s === "glow" ? "✨ " : ""}{t(`videoEditor.motionTrack.textStyle.${s}`)}
                    </button>
                  ))}
                  {(["above", "below", "center"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setTextPosition(p)}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                        textPosition === p ? "border-[#C9A84C] bg-[#C9A84C]/15 text-[#F5D576]" : "border-white/10 text-white/50"
                      }`}
                    >
                      {t(`videoEditor.motionTrack.textPos.${p}`)}
                    </button>
                  ))}
                </div>
              </>
            )}
            {mode === "sticker" && (
              <input
                type="url"
                value={stickerUrl}
                onChange={(e) => setStickerUrl(e.target.value)}
                placeholder={t("videoEditor.motionTrack.stickerPlaceholder")}
                className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#C9A84C]/60"
              />
            )}
            {(mode === "blur" || mode === "pixelate") && (
              <label className="text-xs text-white/60 flex items-center gap-3">
                {t("videoEditor.motionTrack.strength")}
                <input type="range" min={1} max={3} step={1} value={blurStrength} onChange={(e) => setBlurStrength(Number(e.target.value))} className="flex-1 accent-[#C9A84C]" />
                <span className="text-white/80 font-bold w-16 text-right">{t(`videoEditor.motionTrack.strength${blurStrength}`)}</span>
              </label>
            )}
            <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer">
              <input
                type="checkbox"
                checked={attribution}
                onChange={(e) => setAttribution(e.target.checked)}
                className="h-4 w-4 accent-[#C9A84C]"
              />
              {t("videoEditor.motionTrack.attribution")}
            </label>
          </div>

          <button
            type="button"
            onClick={handleApply}
            disabled={applying || !activePoints}
            data-testid="motion-track-apply"
            className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-black text-sm text-black bg-gradient-to-b from-[#F5D576] to-[#C9A84C] hover:brightness-110 disabled:opacity-40 transition-all shadow-[0_0_20px_rgba(201,168,76,0.35)]"
          >
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {applying ? t("videoEditor.motionTrack.applying") : t("videoEditor.motionTrack.applyButton")}
          </button>
          {!activePoints && (
            <p className="text-[11px] text-white/35 mt-1.5 text-center">{t("videoEditor.motionTrack.applyHint")}</p>
          )}
        </div>

        {/* ── Result ── */}
        {resultUrl && (
          <div className="rounded-xl border border-[#C9A84C]/30 bg-[#C9A84C]/[0.05] p-4">
            <p className="text-[11px] font-black text-[#F5D576] uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5" /> {t("videoEditor.motionTrack.resultTitle")}
            </p>
            <video ref={resultVideoRef} src={resultUrl} controls playsInline preload="metadata" className="w-full max-h-[300px] object-contain bg-black rounded-lg" />
            <div className="flex flex-wrap gap-2 mt-3">
              {onReplaceClipVideo && (
                <button
                  type="button"
                  onClick={handleUseInEditor}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-black bg-gradient-to-b from-[#F5D576] to-[#C9A84C] hover:brightness-110 transition-all"
                >
                  <Zap className="h-3.5 w-3.5" /> {t("videoEditor.motionTrack.useInEditor")}
                </button>
              )}
              <a
                href={resultUrl}
                download
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border border-white/15 text-white/70 hover:border-[#C9A84C]/50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" /> {t("videoEditor.motionTrack.download")}
              </a>
            </div>
            {/* ── One-click share ── */}
            <div className="mt-3 pt-3 border-t border-white/[0.07]">
              <p className="text-[11px] font-black text-white/50 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Share2 className="h-3.5 w-3.5" /> {t("videoEditor.motionTrack.shareTitle")}
              </p>
              {shareTargets.length === 0 ? (
                <p className="text-[11px] text-white/35">{t("videoEditor.motionTrack.shareNoAccounts")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {shareTargets.map(({ platform, account }) => (
                    <button
                      key={platform}
                      type="button"
                      disabled={sharing === platform}
                      onClick={() => handleShare(platform, account!.id)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-[#C9A84C]/40 bg-[#C9A84C]/10 text-[#F5D576] hover:bg-[#C9A84C]/20 disabled:opacity-50 transition-colors capitalize"
                    >
                      {sharing === platform ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                      {platform}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </EditorCard>
  );
}
