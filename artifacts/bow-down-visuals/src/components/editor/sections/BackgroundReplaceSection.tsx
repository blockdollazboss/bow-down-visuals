import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, Loader2, AlertTriangle, Sparkles, Download, Upload } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { EditorSettings } from "@/lib/editor-settings";
import { EditorCard } from "@/components/editor/controls";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import { OutOfCredits } from "@/components/OutOfCredits";
import { mediaUrl } from "@/lib/media-cdn";

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
 * background image.
 *
 * AI Generate tab: server-side background-plate generation via
 * POST /api/bg-generate, gated on GET /api/bg-generate/status. The route
 * is wired to the house image provider and charges 200 VB (the status
 * endpoint's creditCost IS the charged price); when no key is configured
 * the button stays disabled with a clear "isn't connected yet" message —
 * uploads and presets keep working and nothing charges. When a plate lands, it is loaded as an HTMLImage and
 * drawn by drawBackground inside the SAME on-device composite pipeline
 * below — no duplicated segmentation/composite code.
 *
 * NOT a duplicate of Pro Tools Chroma Key: chroma key needs actual
 * green-screen footage; this is for plain backgrounds (bedroom, office,
 * street) via AI subject segmentation.
 *
 * DOCK: video-editor rail (Beat Sync / Edit Recipes / Voice Edits area).
 */

/* The engine is vendored (public/engines/selfie-segmentation,
   @mediapipe/selfie_segmentation 0.1.1675465747) — the previous pin named
   a version that does not exist in the npm registry, so its CDN URL
   failed everywhere. The first base below is the site's own media
   bucket serving those vendored files (its CORS policy covers the
   site's origins; the classic script tag + locateFile fetches already
   run cross-origin against the fallback). The CDN build is only a
   fallback now, and locateFile follows whichever base served the
   script. */
const MEDIAPIPE_VERSION = "0.1.1675465747";
const MEDIAPIPE_LOCAL = mediaUrl("engines/selfie-segmentation");
/* The shipped same-origin copy (public/engines/selfie-segmentation) —
   the fallback immediately after the R2 media bucket and before the CDN. */
const MEDIAPIPE_ORIGIN = `${import.meta.env.BASE_URL}engines/selfie-segmentation`;
const MEDIAPIPE_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@${MEDIAPIPE_VERSION}`;
const MEDIAPIPE_BASES = [MEDIAPIPE_LOCAL, MEDIAPIPE_ORIGIN, MEDIAPIPE_CDN];
let mediapipeBase = MEDIAPIPE_LOCAL;

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
function loadScriptFrom(base: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${base}/selfie_segmentation.js`;
    s.onload = () => (window.SelfieSegmentation ? resolve() : reject(new Error("mediapipe load failed")));
    s.onerror = () => {
      s.remove();
      reject(new Error("mediapipe load failed"));
    };
    document.head.appendChild(s);
  });
}
function loadSelfieSegmentation(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.SelfieSegmentation) return Promise.resolve();
  if (selfieScriptPromise) return selfieScriptPromise;
  selfieScriptPromise = (async () => {
    let lastErr: unknown = null;
    for (const base of MEDIAPIPE_BASES) {
      try {
        await loadScriptFrom(base);
        mediapipeBase = base;
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("mediapipe load failed");
  })();
  selfieScriptPromise.catch(() => {
    selfieScriptPromise = null;
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

/** AI background style presets — the id is sent to POST /api/bg-generate
 *  (must stay in sync with BG_GENERATE_STYLES server-side). */
const AI_STYLE_PRESETS = [
  { id: "studio", nameKey: "wave9.bgReplace.ai.styleStudio", defaultName: "Studio" },
  { id: "neon-city", nameKey: "wave9.bgReplace.ai.styleNeonCity", defaultName: "Neon City" },
  { id: "golden-palace", nameKey: "wave9.bgReplace.ai.styleGoldenPalace", defaultName: "Golden Palace" },
  { id: "beach-sunset", nameKey: "wave9.bgReplace.ai.styleBeachSunset", defaultName: "Beach Sunset" },
] as const;

/** Display-only fallback for the AI generate cost until /bg-generate/status loads. */
const AI_GENERATE_COST_FALLBACK = 200;

interface BgGenerateStatus {
  configured: boolean;
  creditCost: number;
  pricePlaceholder: boolean;
}

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

  /* ── AI Generate tab state ─────────────────────────────────────────── */
  const [bgTab, setBgTab] = useState<"presets" | "ai">("presets");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiStyle, setAiStyle] = useState<string>("studio");
  const [aiStatus, setAiStatus] = useState<BgGenerateStatus | null>(null);
  const [aiStatusLoading, setAiStatusLoading] = useState(true);
  const [aiGenerating, setAiGenerating] = useState(false);
  /** The AI-generated plate (HTMLImage) feeding the existing composite pipeline. */
  const [aiBg, setAiBg] = useState<HTMLImageElement | null>(null);
  /** Idempotency key for the current AI generate attempt (Stack 7 #4). */
  const aiAttemptKey = useRef<string | null>(null);

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

  /* ── AI background generation (gated) ────────────────────────────────
   * GET /api/bg-generate/status decides whether the Generate button is
   * enabled. When the server has no image key this stays closed: the
   * button is disabled and a clear "isn't connected yet" notice shows.
   * The plate returned by POST /api/bg-generate feeds the SAME on-device
   * composite pipeline (drawBackground) as uploads/presets.
   */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await confirmedFetch("/api/bg-generate/status", { skipConfirm: true });
        if (res?.ok && alive) {
          const data = (await res.json()) as {
            configured?: boolean;
            creditCost?: number;
            pricePlaceholder?: boolean;
          };
          setAiStatus({
            configured: data.configured === true,
            creditCost: typeof data.creditCost === "number" ? data.creditCost : AI_GENERATE_COST_FALLBACK,
            pricePlaceholder: data.pricePlaceholder === true,
          });
        }
      } catch {
        /* gate stays closed on network error — presets/uploads keep working */
      } finally {
        if (alive) setAiStatusLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [confirmedFetch]);

  const aiConfigured = aiStatus?.configured === true;
  const aiCost = aiStatus?.creditCost ?? AI_GENERATE_COST_FALLBACK;
  const aiGateMessage = t(`${ns}.ai.notConfigured`, {
    defaultValue:
      "AI background generation isn't connected yet — the site owner needs to add an image-generation API key before AI backgrounds can generate. Presets and uploads keep working.",
  });

  /** Load a generated plate URL into an HTMLImage. CORS-clean first so the
   *  composite canvas stays untainted; falls back to a plain load (a tainted
   *  canvas still records via captureStream). */
  function loadPlateImage(url: string): Promise<HTMLImageElement> {
    const attempt = (crossOrigin: string | null) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        if (crossOrigin) img.crossOrigin = crossOrigin;
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("plate load failed"));
        img.src = url;
      });
    return attempt("anonymous").catch(() => attempt(null)).catch(() => {
      throw new Error(
        t(`${ns}.ai.loadError`, { defaultValue: "Couldn't load the generated background image." }),
      );
    });
  }

  async function generateAiBackground() {
    if (aiGenerating || !aiConfigured) return;
    const prompt = aiPrompt.trim();
    if (!prompt) {
      setMessage(t(`${ns}.ai.needPrompt`, { defaultValue: "Describe the background you want first." }));
      return;
    }
    setAiGenerating(true);
    setMessage(null);
    try {
      // Price comes from the status endpoint — the server's
      // BG_GENERATE_CREDIT_COST (200), which is exactly what is charged.
      // One idempotency key per user attempt: a retry of THIS attempt
      // reuses the key (no double charge); a new Generate click mints one.
      if (!aiAttemptKey.current) {
        aiAttemptKey.current = `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      }
      const res = await confirmedFetch("/api/bg-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, style: aiStyle, idempotencyKey: aiAttemptKey.current }),
        overrideCost: aiStatus?.creditCost,
        overrideFeature: t(`${ns}.ai.confirmFeature`, { defaultValue: "AI background plate" }),
      });
      if (!res) {
        // User cancelled the credit confirmation — nothing generated, no charge.
        setAiGenerating(false);
        return;
      }
      if (res.status === 503) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        if (data?.error === "BG_IMAGE_PROVIDER_NOT_CONFIGURED") {
          // Gate self-heals: server lost the key (or never had it) — close the UI gate.
          setAiStatus((s) => (s ? { ...s, configured: false } : s));
        }
        setMessage(aiGateMessage);
        setAiGenerating(false);
        return;
      }
      if (res.status === 402) {
        setOutOfCredits(true);
        setMessage(t(`${ns}.topUpToKeep`));
        setAiGenerating(false);
        return;
      }
      if (!res.ok) {
        throw new Error(
          t(`${ns}.ai.generateError`, { defaultValue: "Couldn't generate that background — try again." }),
        );
      }
      const data = (await res.json()) as { imageUrl?: string };
      if (!data?.imageUrl) {
        throw new Error(
          t(`${ns}.ai.generateError`, { defaultValue: "Couldn't generate that background — try again." }),
        );
      }
      const img = await loadPlateImage(data.imageUrl);
      aiAttemptKey.current = null; // success — next Generate is a new attempt
      setAiBg(img);
      setMessage(null);
      toast({
        title: t(`${ns}.ai.generatedTitle`, { defaultValue: "Background generated" }),
        description: t(`${ns}.ai.readyNote`, {
          defaultValue: "AI background ready — hit Replace background below to swap it in.",
        }),
      });
    } catch (err) {
      /* The attempt failed (the server refunds + voids the charge's
         idempotency key on provider failure) — clear the attempt key so
         the next Generate is a fresh, chargeable attempt instead of a
         suppressed replay that would generate free (Lane V3 F1). */
      aiAttemptKey.current = null;
      setMessage(err instanceof Error ? err.message : t(`${ns}.errorGeneric`));
    } finally {
      setAiGenerating(false);
    }
  }

  /** Cover-fit an image plate onto the canvas (shared by custom + AI plates). */
  function drawCoverFit(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    w: number,
    h: number,
  ) {
    const ir = img.width / img.height;
    const cr = w / h;
    let dw = w, dh = h, dx = 0, dy = 0;
    if (ir > cr) { dw = h * ir; dx = (w - dw) / 2; }
    else { dh = w / ir; dy = (h - dh) / 2; }
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  function drawBackground(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
  ) {
    if (presetId === "custom" && customBg) {
      drawCoverFit(ctx, customBg, w, h);
      return;
    }
    if (bgTab === "ai" && aiBg) {
      // The AI-generated plate becomes the composite background here — the
      // rest of the pipeline (segmentation → composite → MediaRecorder) is
      // untouched.
      drawCoverFit(ctx, aiBg, w, h);
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
    if (bgTab === "ai" && !aiBg) {
      setMessage(t(`${ns}.ai.generateFirst`, { defaultValue: "Generate an AI background first — or switch back to Presets." }));
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
      const bgLabel =
        bgTab === "ai"
          ? t(`${ns}.ai.tab`, { defaultValue: "AI background" })
          : t(preset.nameKey);
      toast({
        title: t(`${ns}.replacedTitle`),
        description: t(`${ns}.doneToast`, { preset: bgLabel }),
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
      locateFile: (f: string) => `${mediapipeBase}/${f}`,
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
            {/* ── Background source tabs: presets vs AI generation ── */}
            <div className="flex rounded-xl border border-white/10 overflow-hidden text-xs font-black w-fit" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={bgTab === "presets"}
                onClick={() => {
                  setBgTab("presets");
                  setPhase("idle");
                  setMessage(null);
                }}
                className={`px-4 py-2 transition-colors ${bgTab === "presets" ? "bg-[#C9A84C]/20 text-[#e8c96a]" : "text-white/40 hover:text-white/70"}`}
                data-testid="wave9b-bg-tab-presets"
              >
                {t(`${ns}.ai.presetsTab`, { defaultValue: "Presets" })}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={bgTab === "ai"}
                onClick={() => {
                  setBgTab("ai");
                  setPhase("idle");
                  setMessage(null);
                }}
                className={`px-4 py-2 inline-flex items-center gap-1.5 transition-colors ${bgTab === "ai" ? "bg-[#C9A84C]/20 text-[#e8c96a]" : "text-white/40 hover:text-white/70"}`}
                data-testid="wave9b-bg-tab-ai"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t(`${ns}.ai.tab`, { defaultValue: "AI Generate" })}
              </button>
            </div>

            {bgTab === "ai" ? (
              /* ── AI Generate panel (gated on /api/bg-generate/status) ── */
              <div
                className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3"
                data-testid="wave9b-bg-ai-panel"
              >
                {aiStatusLoading ? (
                  <p className="text-xs text-white/40 flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t(`${ns}.ai.checking`, { defaultValue: "Checking AI status…" })}
                  </p>
                ) : !aiConfigured ? (
                  <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
                    <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
                    <p className="text-xs text-white/60 leading-relaxed">{aiGateMessage}</p>
                  </div>
                ) : (
                  <>
                    <div>
                      <p className="text-[11px] font-black text-white/40 uppercase tracking-widest mb-1.5">
                        {t(`${ns}.ai.promptLabel`, { defaultValue: "Describe your background" })}
                      </p>
                      <textarea
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        rows={2}
                        maxLength={500}
                        placeholder={t(`${ns}.ai.promptPlaceholder`, {
                          defaultValue: "e.g. a moody jazz club with gold stage lights…",
                        })}
                        className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-[#C9A84C]/50 focus:outline-none resize-none"
                        data-testid="wave9b-bg-ai-prompt"
                      />
                    </div>
                    <div>
                      <p className="text-[11px] font-black text-white/40 uppercase tracking-widest mb-1.5">
                        {t(`${ns}.ai.styleLabel`, { defaultValue: "Style" })}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {AI_STYLE_PRESETS.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setAiStyle(s.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                              aiStyle === s.id
                                ? "border-[#C9A84C]/60 bg-[#C9A84C]/15 text-[#e8c96a]"
                                : "border-white/10 bg-white/[0.03] text-white/50 hover:border-white/25 hover:text-white/80"
                            }`}
                            data-testid={`wave9b-bg-ai-style-${s.id}`}
                          >
                            {t(s.nameKey, { defaultValue: s.defaultName })}
                          </button>
                        ))}
                      </div>
                    </div>
                    {aiBg && (
                      <div className="rounded-xl overflow-hidden border border-[#C9A84C]/30 max-w-xs">
                        <img src={aiBg.src} alt="" className="w-full h-24 object-cover" />
                        <p className="px-3 py-1.5 text-[11px] text-[#e8c96a]/80 bg-black/40">
                          {t(`${ns}.ai.readyNote`, {
                            defaultValue: "AI background ready — hit Replace background below to swap it in.",
                          })}
                        </p>
                      </div>
                    )}
                  </>
                )}
                <div>
                  <button
                    type="button"
                    onClick={generateAiBackground}
                    disabled={!aiConfigured || aiGenerating || aiStatusLoading}
                    title={!aiConfigured && !aiStatusLoading ? aiGateMessage : undefined}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm
                      bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black
                      hover:from-[#e0bc58] hover:to-[#a5853a] transition-all shadow-lg shadow-[#C9A84C]/20
                      disabled:opacity-40 disabled:cursor-not-allowed"
                    data-testid="wave9b-bg-ai-generate"
                  >
                    {aiGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {aiGenerating
                      ? t(`${ns}.ai.generating`, { defaultValue: "Generating…" })
                      : t(`${ns}.ai.generate`, { defaultValue: "Generate background ({{cost}} VB)", cost: aiCost })}
                  </button>
                  {aiConfigured && (
                    <p className="text-[11px] text-white/35 mt-1.5">
                      {t(`${ns}.ai.priceNote`, {
                        defaultValue: "Charged exactly {{cost}} VB when a background generates — a failed generation is refunded.",
                        cost: aiCost,
                      })}
                    </p>
                  )}
                </div>
              </div>
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
            </>
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
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
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
