import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, Loader2, AlertTriangle, Sparkles, Download, Upload } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { EditorSettings } from "@/lib/editor-settings";
import { EditorCard } from "@/components/editor/controls";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── AI Background Replace ───────────────────────────────────────────────
 * For talking-head clips shot WITHOUT a green screen: pick a background
 * preset (or upload your own image) and swap the real background for it.
 *
 * Runs 100% ON-DEVICE via MediaPipe SelfieSegmentation (loaded from CDN at
 * runtime — no npm dependency, no api-server provider, no per-clip cost).
 * The video plays through the segmenter frame-by-frame; each frame is
 * composited (person over new background) onto a canvas that is recorded
 * with audio via MediaRecorder. Nothing is uploaded anywhere.
 *
 * Honest limits: needs a CORS-readable clip URL (crossOrigin="anonymous");
 * if the host blocks it we say so plainly. Quality depends on the device —
 * we cap processing at 720p for speed. "Custom" = upload your own
 * background image (no AI background generation — that would need a
 * provider and we don't fake it).
 *
 * NOT a duplicate of Pro Tools Chroma Key: chroma key needs actual
 * green-screen footage; this is for plain backgrounds (bedroom, office,
 * street) via AI subject segmentation.
 *
 * DOCK: video-editor rail (Beat Sync / Edit Recipes / Voice Edits area).
 */

const MEDIAPIPE_VERSION = "0.1.1672281042";
const MEDIAPIPE_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@${MEDIAPIPE_VERSION}`;

declare global {
  interface Window {
    SelfieSegmentation?: new (opts: { locateFile: (f: string) => string }) => {
      setOptions: (o: { modelSelection: number }) => void;
      onResults: (cb: (r: { image: HTMLVideoElement; segmentationMask: HTMLCanvasElement }) => void) => void;
      send: (input: { image: HTMLVideoElement }) => Promise<void>;
      close: () => void;
    };
  }
}

let selfieScriptPromise: Promise<void> | null = null;
function loadSelfieSegmentation(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.SelfieSegmentation) return Promise.resolve();
  if (selfieScriptPromise) return selfieScriptPromise;
  selfieScriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${MEDIAPIPE_CDN}/selfie_segmentation.js`;
    s.onload = () => (window.SelfieSegmentation ? resolve() : reject(new Error("mediapipe load failed")));
    s.onerror = () => reject(new Error("mediapipe load failed"));
    document.head.appendChild(s);
  });
  return selfieScriptPromise;
}

/** Gradient stops per preset (match the gallery swatches). */
const PRESET_GRADIENTS: Record<string, [string, string, string]> = {
  studio: ["#1a1a1a", "#3a2f18", "#C9A84C"],
  stage: ["#0d0d12", "#2a1f3d", "#C9A84C"],
  "city-night": ["#05070f", "#0f1e3a", "#8a6f2e"],
  "abstract-gold": ["#000000", "#4a3a12", "#e8c96a"],
};

/** 200 VB — charged on delivery, after the on-device replacement succeeds. */
const CREDIT_COST = 200;

interface BgPreset {
  id: "studio" | "stage" | "city-night" | "abstract-gold" | "custom";
  nameKey: string;
  descKey: string;
  /** CSS gradient swatch for the gallery. */
  swatch: string;
}

const BG_PRESETS: BgPreset[] = [  {
    id: "studio",
    nameKey: "wave9.bgReplace.presetStudio",
    descKey: "wave9.bgReplace.presetStudioDesc",
    swatch: "linear-gradient(135deg, #1a1a1a 0%, #3a2f18 60%, #C9A84C33 100%)",
  },
  {
    id: "stage",
    nameKey: "wave9.bgReplace.presetStage",
    descKey: "wave9.bgReplace.presetStageDesc",
    swatch: "linear-gradient(135deg, #0d0d12 0%, #2a1f3d 50%, #C9A84C55 100%)",
  },
  {
    id: "city-night",
    nameKey: "wave9.bgReplace.presetCityNight",
    descKey: "wave9.bgReplace.presetCityNightDesc",
    swatch: "linear-gradient(135deg, #05070f 0%, #0f1e3a 55%, #8a6f2e66 100%)",
  },
  {
    id: "abstract-gold",
    nameKey: "wave9.bgReplace.presetAbstractGold",
    descKey: "wave9.bgReplace.presetAbstractGoldDesc",
    swatch: "linear-gradient(135deg, #000000 0%, #4a3a12 55%, #e8c96a 130%)",
  },
  {
    id: "custom",
    nameKey: "wave9.bgReplace.presetCustom",
    descKey: "wave9.bgReplace.presetCustomDesc",
    swatch: "linear-gradient(135deg, #141414 0%, #333333 100%)",
  },
];

interface BackgroundReplaceSectionProps {
  scene: SceneData | null;
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  /** Swaps the scene's clip video when a result lands. */
  onReplaceClipVideo?: (sceneId: string, url: string) => void;
}

export function BackgroundReplaceSection({
  scene,
  settings,
  setSettings: _setSettings,
  onReplaceClipVideo,
}: BackgroundReplaceSectionProps) {
  const { t } = useTranslation();
  const ns = "wave9.bgReplace";
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();

  const [presetId, setPresetId] = useState<BgPreset["id"]>("studio");
  const [customBg, setCustomBg] = useState<HTMLImageElement | null>(null);
  const [phase, setPhase] = useState<"idle" | "working" | "confirming" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [showAfter, setShowAfter] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  /** Processed blob held while the charge is confirmed/retried — no reprocessing needed. */
  const pendingBlob = useRef<Blob | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  void _setSettings;
  void settings;

  const mediaUrl = scene?.demoClipUrl ?? null;
  const preset = BG_PRESETS.find((p) => p.id === presetId) ?? BG_PRESETS[0];

  function handleCustomUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      setCustomBg(img);
      setMessage(null);
    };
    img.onerror = () => setMessage(t(`${ns}.customLoadError`));
    img.src = url;
  }

  function drawBackground(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
  ) {
    if (presetId === "custom" && customBg) {
      // cover-fit the uploaded image
      const ir = customBg.width / customBg.height;
      const cr = w / h;
      let dw = w, dh = h, dx = 0, dy = 0;
      if (ir > cr) { dw = h * ir; dx = (w - dw) / 2; }
      else { dh = w / ir; dy = (h - dh) / 2; }
      ctx.drawImage(customBg, dx, dy, dw, dh);
      return;
    }
    const stops = PRESET_GRADIENTS[presetId] ?? PRESET_GRADIENTS.studio!;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, stops[0]);
    g.addColorStop(0.55, stops[1]);
    g.addColorStop(1, stops[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  async function replaceBackground() {
    if (!mediaUrl || phase === "working" || phase === "confirming") return;
    if (presetId === "custom" && !customBg) {
      setMessage(t(`${ns}.customNeeded`));
      return;
    }
    setMessage(null);
    setOutOfCredits(false);
    setPhase("working");
    setProgress(0);
    try {
      const blob = await processVideo(mediaUrl, drawBackground, setProgress);
      pendingBlob.current = blob;
      // Charge on delivery: the on-device work is done, now collect the 200 VB.
      await collectCharge();
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : t(`${ns}.errorGeneric`));
    }
  }

  /** Charge 200 VB for the completed replacement. Keeps the processed blob
   *  on 402 so the user can top up and retry without reprocessing. */
  async function collectCharge() {
    const blob = pendingBlob.current;
    if (!blob) {
      setPhase("idle");
      return;
    }
    setPhase("confirming");
    setMessage(null);
    try {
      const res = await confirmedFetch("/api/wave9b/bg/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId: scene?.id ?? "" }),
      });
      if (!res) {
        // User cancelled the credit confirmation — discard, no charge.
        pendingBlob.current = null;
        setPhase("idle");
        setMessage(t(`${ns}.cancelled`));
        return;
      }
      if (res.status === 402) {
        setOutOfCredits(true);
        setPhase("error");
        setMessage(t(`${ns}.topUpToKeep`));
        return;
      }
      if (!res.ok) throw new Error(t(`${ns}.errorGeneric`));
      const url = URL.createObjectURL(blob);
      pendingBlob.current = null;
      setResultUrl(url);
      setShowAfter(true);
      setPhase("done");
      setOutOfCredits(false);
      onReplaceClipVideo?.(scene!.id, url);
      toast({
        title: t(`${ns}.replacedTitle`),
        description: t(`${ns}.doneToast`, { preset: t(preset.nameKey) }),
      });
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : t(`${ns}.errorGeneric`));
    }
  }

  /**
   * On-device pipeline: video → MediaPipe segmentation → composite canvas
   * (new background + person) → MediaRecorder (video + original audio).
   * Throws with a plain-language message on failure; never charges.
   */
  async function processVideo(
    videoUrl: string,
    paintBg: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
    onProgress: (p: number) => void,
  ): Promise<Blob> {
    await loadSelfieSegmentation().catch(() => {
      throw new Error(t(`${ns}.loadError`));
    });
    const SegCtor = window.SelfieSegmentation;
    if (!SegCtor) throw new Error(t(`${ns}.loadError`));

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.playsInline = true;
    video.preload = "auto";
    video.src = videoUrl;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error(t(`${ns}.corsError`)));
    });
    if (!video.videoWidth || !video.videoHeight) throw new Error(t(`${ns}.errorGeneric`));

    // Cap at 720p wide for segmentation speed; keep aspect.
    const scale = Math.min(1, 1280 / video.videoWidth);
    const W = Math.max(2, Math.round((video.videoWidth * scale) / 2) * 2);
    const H = Math.max(2, Math.round((video.videoHeight * scale) / 2) * 2);

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const personCanvas = document.createElement("canvas");
    personCanvas.width = W;
    personCanvas.height = H;
    const pctx = personCanvas.getContext("2d");
    if (!ctx || !pctx) throw new Error(t(`${ns}.errorGeneric`));

    const segmenter = new SegCtor({
      locateFile: (f: string) => `${MEDIAPIPE_CDN}/${f}`,
    });
    segmenter.setOptions({ modelSelection: 1 });
    segmenter.onResults((res) => {
      paintBg(ctx, W, H);
      pctx.clearRect(0, 0, W, H);
      pctx.filter = "blur(3px)";
      pctx.drawImage(res.segmentationMask, 0, 0, W, H);
      pctx.filter = "none";
      pctx.globalCompositeOperation = "source-in";
      pctx.drawImage(res.image, 0, 0, W, H);
      pctx.globalCompositeOperation = "source-over";
      ctx.drawImage(personCanvas, 0, 0, W, H);
    });

    // Route the clip's audio into the recording (element stays silent —
    // createMediaElementSource reroutes output away from the speakers).
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioCtor();
    let stream: MediaStream;
    try {
      const srcNode = audioCtx.createMediaElementSource(video);
      const dest = audioCtx.createMediaStreamDestination();
      srcNode.connect(dest);
      stream = canvas.captureStream(30);
      dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    } catch {
      await audioCtx.close().catch(() => {});
      throw new Error(t(`${ns}.corsError`));
    }

    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    const finished = new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    });

    try {
      await video.play();
    } catch {
      throw new Error(t(`${ns}.playError`));
    }
    rec.start(500);

    await new Promise<void>((resolve) => {
      let stopped = false;
      const finish = () => {
        if (stopped) return;
        stopped = true;
        resolve();
      };
      const pump = async () => {
        if (video.ended || video.paused) {
          finish();
          return;
        }
        try {
          await segmenter.send({ image: video });
        } catch {
          /* drop the frame, keep going */
        }
        onProgress(video.duration > 0 ? Math.min(1, video.currentTime / video.duration) : 0);
        if ((video as unknown as { requestVideoFrameCallback?: (cb: () => void) => void }).requestVideoFrameCallback) {
          (video as unknown as { requestVideoFrameCallback: (cb: () => void) => void }).requestVideoFrameCallback(() => void pump());
        } else {
          setTimeout(() => void pump(), 33);
        }
      };
      video.onended = finish;
      void pump();
    });

    rec.stop();
    const blob = await finished;
    video.pause();
    video.src = "";
    segmenter.close();
    await audioCtx.close().catch(() => {});
    if (blob.size === 0) throw new Error(t(`${ns}.errorGeneric`));
    return blob;
  }

  const previewSrc = showAfter && resultUrl ? resultUrl : mediaUrl;

  return (
    <EditorCard
      title={t(`${ns}.title`)}
      subtitle={t(`${ns}.subtitle`, { cost: CREDIT_COST })}
      icon={<ImageIcon className="h-4 w-4" />}
      data-testid="wave9b-bgreplace"
    >
      <div className="space-y-4">
        {outOfCredits && <OutOfCredits />}
        {!scene || !mediaUrl ? (
          <p className="text-sm text-white/40">{t(`${ns}.noClip`)}</p>
        ) : (
          <>
            {/* ── Preset gallery ── */}
            <div>
              <p className="text-[11px] font-black text-white/40 uppercase tracking-widest mb-2">
                {t(`${ns}.presetLabel`)}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {BG_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPresetId(p.id);
                      setPhase("idle");
                      setMessage(null);
                    }}
                    className={`rounded-xl border overflow-hidden text-left transition-all ${
                      presetId === p.id
                        ? "border-[#C9A84C]/60 ring-1 ring-[#C9A84C]/30"
                        : "border-white/[0.08] hover:border-white/25"
                    }`}
                    data-testid={`wave9b-bgpreset-${p.id}`}
                  >
                    <div className="h-14" style={{ background: p.swatch }} />
                    <div className="px-3 py-2 bg-black/40">
                      <p className="text-xs font-black text-white">{t(p.nameKey)}</p>
                      <p className="text-[10px] text-white/35 leading-snug mt-0.5">{t(p.descKey)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {presetId === "custom" && (
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleCustomUpload}
                  data-testid="wave9b-bgupload"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-bold text-white/70 hover:border-[#C9A84C]/40 hover:text-white transition-all"
                >
                  <Upload className="h-4 w-4" />
                  {customBg ? t(`${ns}.customUploaded`) : t(`${ns}.customUploadLabel`)}
                </button>
                {customBg && (
                  <div className="mt-2 rounded-xl overflow-hidden border border-white/[0.08] max-w-xs">
                    <img src={customBg.src} alt="" className="w-full h-24 object-cover" />
                  </div>
                )}
              </div>
            )}

            {/* ── Before/after preview ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-black text-white/40 uppercase tracking-widest">
                  {t(`${ns}.previewLabel`)}
                </p>
                {resultUrl && (
                  <div className="flex rounded-lg border border-white/10 overflow-hidden text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setShowAfter(false)}
                      className={`px-3 py-1 transition-colors ${!showAfter ? "bg-[#C9A84C]/20 text-[#e8c96a]" : "text-white/40 hover:text-white/70"}`}
                    >
                      {t(`${ns}.before`)}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAfter(true)}
                      className={`px-3 py-1 transition-colors ${showAfter ? "bg-[#C9A84C]/20 text-[#e8c96a]" : "text-white/40 hover:text-white/70"}`}
                    >
                      {t(`${ns}.after`)}
                    </button>
                  </div>
                )}
              </div>
              <div className="relative rounded-xl overflow-hidden border border-white/[0.08] bg-black">
                {previewSrc ? (
                  <video
                    key={previewSrc}
                    src={previewSrc}
                    controls
                    playsInline
                    className="w-full max-h-64 object-contain"
                    data-testid="wave9b-bgpreview"
                  />
                ) : (
                  <div className="h-40 flex items-center justify-center text-white/25 text-sm">
                    {t(`${ns}.noClipLoaded`)}
                  </div>
                )}
              </div>
            </div>

            {/* ── Progress ── */}
            {phase === "working" && (
              <div className="space-y-1.5">
                <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#C9A84C] to-[#e8c96a] transition-[width]"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
                <p className="text-[11px] text-white/40">
                  {t(`${ns}.workingProgress`, { pct: Math.round(progress * 100) })}
                </p>
              </div>
            )}

            {message && (
              <div className="flex items-start gap-2.5 rounded-xl border px-4 py-3 border-red-500/25 bg-red-500/5">
                <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-200/80">{message}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={replaceBackground}
                disabled={phase === "working" || phase === "confirming"}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm
                  bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black
                  hover:from-[#e0bc58] hover:to-[#a5853a] transition-all shadow-lg shadow-[#C9A84C]/20
                  disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="wave9b-bg-replace"
              >
                {phase === "working" || phase === "confirming" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {phase === "working"
                  ? t(`${ns}.working`)
                  : phase === "confirming"
                    ? t(`${ns}.confirming`)
                    : t(`${ns}.replace`, { cost: CREDIT_COST })}
              </button>
              {outOfCredits && pendingBlob.current && (
                <button
                  type="button"
                  onClick={collectCharge}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#C9A84C]/40 bg-[#C9A84C]/10 text-sm font-black text-[#e8c96a] hover:bg-[#C9A84C]/20 transition-all"
                  data-testid="wave9b-bg-retry-charge"
                >
                  <Sparkles className="h-4 w-4" />
                  {t(`${ns}.retryCharge`, { cost: CREDIT_COST })}
                </button>
              )}
              {phase === "done" && resultUrl && (
                <a
                  href={resultUrl}
                  download="background-replaced.webm"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-bold text-white/70 hover:border-[#C9A84C]/40 hover:text-white transition-all"
                >
                  <Download className="h-4 w-4" />
                  {t(`${ns}.download`)}
                </a>
              )}
            </div>

            {phase === "done" && resultUrl && (
              <p className="text-[11px] text-white/35 leading-relaxed">{t(`${ns}.doneNote`)}</p>
            )}
          </>
        )}
      </div>
    </EditorCard>
  );
}
