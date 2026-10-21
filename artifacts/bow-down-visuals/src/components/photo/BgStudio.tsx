import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CostBadge } from "@/components/CostBadge";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import {
  Upload,
  Eraser,
  Loader2,
  Download,
  RotateCcw,
  Image as ImageIcon,
  Palette,
  Sparkles,
  Check,
  ChevronDown,
} from "lucide-react";
import {
  createStillMattingEngine, cutoutDataUrl, chromaKeyAlpha, tierLabel,
  type MattingTier, type StillMattingEngine,
} from "@/lib/photo-matting";

/* ─── Background Studio — photo background remover + replacer ───────────────
   Difficulty ladder: one-tap "Remove background" (simple) → preset
   colors/gradients/backdrops (guided) → custom prompt + color picker +
   aggressiveness slider (manual, top).
   Docks as the "background" tab on thumbnail-studio.tsx.
   Removal quality tiers (Stack 7 #3, labeled truthfully):
   - Pro matting: the stream desk's on-device matting engine run for a
     single frame (lib/photo-matting.ts) — free, soft edges.
   - Basic color-key: a corner-sampling color heuristic — the client
     fallback (free) and the server /api/remove-background path
     (200 VB, unchanged price). A color heuristic is never called AI. */

const REMOVE_COST = 200; // existing backend price — do not change here
const BACKDROP_COST = 100; // PLACEHOLDER — not user-approved

interface BackdropStatus {
  configured: boolean;
  nanoConfigured: boolean;
  ideogramConfigured: boolean;
  creditCost: number;
  pricePlaceholder: boolean;
}

interface GradientPreset {
  id: string;
  name: string;
  css: string;
  stops: [string, string];
}

const GRADIENT_PRESETS: GradientPreset[] = [
  { id: "studio", name: "Studio grey", css: "linear-gradient(135deg,#3a3a3f,#101013)", stops: ["#3a3a3f", "#101013"] },
  { id: "gold", name: "Gold luxury", css: "linear-gradient(135deg,#fbbf24,#7c4a03)", stops: ["#fbbf24", "#7c4a03"] },
  { id: "sunset", name: "Sunset", css: "linear-gradient(135deg,#ff7a18,#af002d 60%,#2b1055)", stops: ["#ff7a18", "#2b1055"] },
  { id: "ocean", name: "Ocean", css: "linear-gradient(135deg,#1d976c,#0f3443)", stops: ["#1d976c", "#0f3443"] },
  { id: "neon", name: "Neon night", css: "linear-gradient(135deg,#fc00ff,#00dbde)", stops: ["#fc00ff", "#00dbde"] },
  { id: "rose", name: "Rose", css: "linear-gradient(135deg,#ff9a9e,#a18cd1)", stops: ["#ff9a9e", "#a18cd1"] },
  { id: "midnight", name: "Midnight", css: "linear-gradient(135deg,#0f2027,#2c5364)", stops: ["#0f2027", "#2c5364"] },
  { id: "fire", name: "Fire stage", css: "linear-gradient(135deg,#f83600,#f9d423)", stops: ["#f83600", "#f9d423"] },
  { id: "violet", name: "Violet haze", css: "linear-gradient(135deg,#8e2de2,#4a00e0)", stops: ["#8e2de2", "#4a00e0"] },
];

const COLOR_SWATCHES = [
  "#ffffff", "#f3f4f6", "#111827", "#000000",
  "#fbbf24", "#ef4444", "#3b82f6", "#22c55e",
  "#a855f7", "#ec4899", "#14b8a6", "#f97316",
];

const AI_PRESET_PROMPTS: { id: string; label: string; prompt: string }[] = [
  { id: "stage", label: "Concert stage", prompt: "Concert stage at night, dramatic spotlight beams, crowd bokeh lights, cinematic wide shot, empty stage backdrop" },
  { id: "studio", label: "Studio", prompt: "Professional photo studio, seamless grey backdrop, soft rim lighting, shallow depth of field" },
  { id: "gold", label: "Gold luxury", prompt: "Luxurious gold interior, marble and warm light, elegant bokeh, high-end portrait backdrop" },
  { id: "city", label: "City night", prompt: "City street at night, neon signs glowing, wet asphalt reflections, cinematic urban backdrop" },
  { id: "beach", label: "Beach", prompt: "Tropical beach at golden hour, palm trees, turquoise water, dreamy soft light" },
  { id: "records", label: "Record booth", prompt: "Recording studio booth, mixing console, warm tungsten lights, music producer backdrop" },
];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image."));
    img.src = src;
  });
}

function closestRatio(w: number, h: number): "1080:1920" | "1080:1080" | "1920:1080" {
  const aspect = w / h;
  const candidates: Array<{ r: "1080:1920" | "1080:1080" | "1920:1080"; a: number }> = [
    { r: "1080:1920", a: 1080 / 1920 },
    { r: "1080:1080", a: 1 },
    { r: "1920:1080", a: 1920 / 1080 },
  ];
  return candidates.reduce((best, c) =>
    Math.abs(c.a - aspect) < Math.abs(best.a - aspect) ? c : best
  ).r;
}

type ReplaceKind = "color" | "gradient" | "ai";

export function BgStudio() {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  /* source */
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoDims, setPhotoDims] = useState<{ w: number; h: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  /* removal */
  const [matting, setMatting] = useState(false);
  const [matteError, setMatteError] = useState<string | null>(null);
  const [cutoutTier, setCutoutTier] = useState<MattingTier | null>(null);
  const stillEngineRef = useRef<StillMattingEngine | null>(null);
  const [aggressiveness, setAggressiveness] = useState(0.5);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [cutoutUrl, setCutoutUrl] = useState<string | null>(null);
  const [detectedColor, setDetectedColor] = useState<string | null>(null);

  /* replacement */
  const [replaceKind, setReplaceKind] = useState<ReplaceKind>("color");
  const [color, setColor] = useState("#fbbf24");
  const [gradientId, setGradientId] = useState<string>(GRADIENT_PRESETS[0]!.id);
  const [aiPrompt, setAiPrompt] = useState("");
  const [provider, setProvider] = useState<"nano-banana-2.1" | "ideogram-4.0">("nano-banana-2.1");
  const [backdropStatus, setBackdropStatus] = useState<BackdropStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [backdropUrl, setBackdropUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  /* result */
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── AI backdrop provider gate: check once when the tab mounts ── */
  useEffect(() => {
    let alive = true;
    (async () => {
      setStatusLoading(true);
      try {
        const res = await confirmedFetch("/api/photo-backdrop/status", { skipConfirm: true });
        if (!res?.ok) return;
        const data = (await res.json()) as BackdropStatus;
        if (!alive) return;
        setBackdropStatus(data);
        if (!data.nanoConfigured && data.ideogramConfigured) setProvider("ideogram-4.0");
      } catch {
        /* gate stays unknown — AI option shows its offline message */
      } finally {
        if (alive) setStatusLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Upload a photo (free: pure storage) ── */
  async function handleFile(f: File | undefined) {
    if (!f || uploading) return;
    if (!f.type.startsWith("image/")) {
      setError(t("bgStudio.uploadNotImage", { defaultValue: "Please choose an image file." }));
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError(t("bgStudio.uploadTooLarge", { defaultValue: "That image is over 5 MB — pick a smaller one." }));
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", f);
      form.append("kind", "background");
      const res = await confirmedFetch("/api/ai-page-designer/upload", {
        method: "POST",
        body: form,
        skipConfirm: true, // free upload — no spend confirm
      });
      if (!res) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      const url = data.url as string;
      setPhotoUrl(url);
      const img = await loadImage(url);
      setPhotoDims({ w: img.naturalWidth, h: img.naturalHeight });
      /* reset downstream state for the new photo */
      setCutoutUrl(null); setDetectedColor(null); setBackdropUrl(null); setResultUrl(null);
      toast({ title: t("bgStudio.uploadedTitle", { defaultValue: "Photo uploaded" }), description: t("bgStudio.uploadedDesc", { defaultValue: "Now remove the background." }) });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("bgStudio.uploadFailed", { defaultValue: "Upload failed. Try again." }));
    } finally {
      setUploading(false);
    }
  }

  /* ── One-tap background removal via the EXISTING backend ── */
  async function handleRemoveBackground() {
    if (!photoUrl || removing) return;
    setError(null);
    setRemoving(true);
    try {
      const res = await confirmedFetch("/api/remove-background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: photoUrl, aggressiveness }),
        overrideCost: REMOVE_COST,
        overrideFeature: "Background Removal",
      });
      if (!res) { setRemoving(false); return; } // user cancelled the confirm
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || t("bgStudio.removeFailed", { defaultValue: "Background removal failed." }));
      }
      if (!data.url) throw new Error(t("bgStudio.noOutput", { defaultValue: "No output image returned." }));
      setCutoutTier("basic"); // server path is the corner-sampling color-key
      setCutoutUrl(data.url as string);
      setDetectedColor((data.backgroundColor as string | undefined) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("bgStudio.removeFailed", { defaultValue: "Background removal failed." }));
    } finally {
      setRemoving(false);
    }
  }

  /* ── Pro matting: the stream desk's engine, one frame, on-device ── */
  async function handleProMatting() {
    if (!photoUrl || matting) return;
    setError(null); setMatteError(null); setMatting(true);
    try {
      if (!stillEngineRef.current) stillEngineRef.current = createStillMattingEngine();
      const img = await loadImage(photoUrl);
      const matte = await stillEngineRef.current.processStill(img);
      setCutoutTier("pro");
      setCutoutUrl(cutoutDataUrl(img, matte));
    } catch (e) {
      // Honest failure + a labeled Basic fallback — never a silent swap.
      setMatteError(e instanceof Error ? e.message : t("bgStudio.matteFailed", { defaultValue: "Pro matting could not run on this device." }));
    } finally {
      setMatting(false);
    }
  }

  /* ── Basic color-key fallback (client-side, free, honestly labeled) ── */
  async function handleBasicKey() {
    if (!photoUrl) return;
    setError(null); setMatteError(null);
    try {
      const img = await loadImage(photoUrl);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas unavailable.");
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const alpha = chromaKeyAlpha(data.data, canvas.width, canvas.height, aggressiveness);
      setCutoutTier("basic");
      setCutoutUrl(cutoutDataUrl(img, { alpha, width: canvas.width, height: canvas.height }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("bgStudio.removeFailed", { defaultValue: "Background removal failed." }));
    }
  }

  /* ── AI backdrop generation (gated by provider keys) ── */
  async function handleGenerateBackdrop(promptOverride?: string) {
    const prompt = (promptOverride ?? aiPrompt).trim();
    if (!prompt || generating) return;
    if (backdropStatus && !backdropStatus.configured) {
      setError(t("bgStudio.aiNotConnected", { defaultValue: "AI backdrops are not connected on this server yet. Pick a solid color or preset scene instead." }));
      return;
    }
    setError(null);
    setGenerating(true);
    try {
      const ratio = photoDims ? closestRatio(photoDims.w, photoDims.h) : "1080:1080";
      const res = await confirmedFetch("/api/photo-backdrop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, provider, ratio }),
        overrideCost: BACKDROP_COST,
        overrideFeature: "Photo Backdrop (price TBD)",
      });
      if (!res) { setGenerating(false); return; } // user cancelled the confirm
      const data = await res.json();
      if (res.status === 503) {
        throw new Error(data.message || t("bgStudio.aiNotConnected", { defaultValue: "AI backdrops are not connected on this server yet." }));
      }
      if (!res.ok || !data.url) {
        throw new Error(data.message || data.error || t("bgStudio.backdropFailed", { defaultValue: "Backdrop generation failed." }));
      }
      setBackdropUrl(data.url as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("bgStudio.backdropFailed", { defaultValue: "Backdrop generation failed." }));
    } finally {
      setGenerating(false);
    }
  }

  /* ── Client-side composite (free — runs in the browser) ── */
  const compose = useCallback(async () => {
    if (!cutoutUrl) return;
    const needsBackdrop = replaceKind === "ai" && !backdropUrl;
    if (needsBackdrop) { setResultUrl(null); return; }
    setComposing(true);
    try {
      const fg = await loadImage(cutoutUrl);
      const canvas = document.createElement("canvas");
      canvas.width = fg.naturalWidth;
      canvas.height = fg.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable.");

      if (replaceKind === "ai" && backdropUrl) {
        const bg = await loadImage(backdropUrl);
        /* cover-fit the backdrop under the cutout */
        const scale = Math.max(canvas.width / bg.naturalWidth, canvas.height / bg.naturalHeight);
        const dw = bg.naturalWidth * scale, dh = bg.naturalHeight * scale;
        ctx.drawImage(bg, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      } else if (replaceKind === "gradient") {
        const g = GRADIENT_PRESETS.find((p) => p.id === gradientId) ?? GRADIENT_PRESETS[0]!;
        const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        grad.addColorStop(0, g.stops[0]); grad.addColorStop(1, g.stops[1]);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else if (replaceKind === "color") {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(fg, 0, 0);
      setResultUrl(canvas.toDataURL("image/png"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("bgStudio.composeFailed", { defaultValue: "Could not compose the final image." }));
    } finally {
      setComposing(false);
    }
  }, [cutoutUrl, replaceKind, backdropUrl, color, gradientId, t]);

  useEffect(() => { void compose(); }, [compose]);

  function resetAll() {
    setPhotoUrl(null); setPhotoDims(null); setCutoutUrl(null); setDetectedColor(null);
    setBackdropUrl(null); setResultUrl(null); setAiPrompt(""); setError(null);
  }

  const aiEnabled = !!backdropStatus?.configured && !statusLoading;

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* ── Step 1: upload ── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400/20 text-xs font-black text-amber-300">1</span>
          <h3 className="font-bold text-white">{t("bgStudio.step1", { defaultValue: "Upload a photo" })}</h3>
        </div>
        {!photoUrl ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFile(e.dataTransfer.files?.[0]); }}
            className={`flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${dragOver ? "border-amber-400 bg-amber-400/10" : "border-white/15 hover:border-white/30"}`}
          >
            {uploading ? <Loader2 className="h-8 w-8 animate-spin text-amber-300" /> : <Upload className="h-8 w-8 text-white/40" />}
            <span className="text-sm text-white/60">
              {uploading
                ? t("bgStudio.uploading", { defaultValue: "Uploading…" })
                : t("bgStudio.dropHint", { defaultValue: "Drop a photo here, or tap to choose one" })}
            </span>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ""; }} />
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <img src={photoUrl} alt="" className="h-28 w-28 rounded-xl object-cover border border-white/15" />
            <div className="flex-1 min-w-[180px]">
              <p className="text-sm text-white/60">{t("bgStudio.photoReady", { defaultValue: "Photo ready" })}{photoDims && ` · ${photoDims.w}×${photoDims.h}`}</p>
              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {t("bgStudio.changePhoto", { defaultValue: "Change photo" })}
                </Button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ""; }} />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Step 2: remove background (one tap) ── */}
      <section className={`rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6 ${!photoUrl ? "opacity-40 pointer-events-none" : ""}`}>
        <div className="flex items-center gap-2 mb-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400/20 text-xs font-black text-amber-300">2</span>
          <h3 className="font-bold text-white">{t("bgStudio.step2", { defaultValue: "Remove the background" })}</h3>
          <CostBadge cost={REMOVE_COST} className="ml-1" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => void handleProMatting()}
            disabled={!photoUrl || matting || uploading}
            className="bg-gradient-to-r from-[#fbbf24] to-[#d4a017] text-black font-bold hover:opacity-90"
          >
            {matting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {matting
              ? t("bgStudio.matting", { defaultValue: "Matting…" })
              : t("bgStudio.proCta", { defaultValue: "Remove background — Pro matting (free, on-device)" })}
          </Button>
          <Button
            variant="outline"
            onClick={handleRemoveBackground}
            disabled={!photoUrl || removing || uploading}
          >
            {removing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eraser className="mr-2 h-4 w-4" />}
            {removing
              ? t("bgStudio.removing", { defaultValue: "Removing background…" })
              : t("bgStudio.removeCta", { defaultValue: "Remove background — Basic color-key" })}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-white/35">
          {t("bgStudio.tierNote", { defaultValue: "Pro matting uses the on-device matting model for soft, hair-level edges. Basic color-key is a color heuristic for solid backgrounds only." })}
          {cutoutTier && <> {t("bgStudio.lastTier", { defaultValue: "Last cut-out used: {{tier}}.", tier: tierLabel(cutoutTier) })}</>}
        </p>
        {matteError && (
          <div className="mt-3">
            <p className="text-sm text-red-300">{matteError}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void handleBasicKey()} disabled={!photoUrl}>
              {t("bgStudio.basicFallbackCta", { defaultValue: "Try Basic color-key instead (free)" })}
            </Button>
          </div>
        )}

        <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="mt-3 flex items-center gap-1 text-xs text-white/40 hover:text-white/70">
          <ChevronDown className={`h-3.5 w-3.5 transition ${showAdvanced ? "rotate-180" : ""}`} />
          {t("bgStudio.advanced", { defaultValue: "Manual: removal strength" })}
        </button>
        {showAdvanced && (
          <div className="mt-3 max-w-sm">
            <Label className="text-xs text-white/60">
              {t("bgStudio.aggressiveness", { defaultValue: "Removal strength" })} — {Math.round(aggressiveness * 100)}%
            </Label>
            <Input
              type="range" min={0} max={1} step={0.05}
              value={aggressiveness}
              onChange={(e) => setAggressiveness(Number(e.target.value))}
              className="mt-1 accent-amber-400"
            />
            <p className="mt-1 text-[11px] text-white/35">{t("bgStudio.aggressivenessHint", { defaultValue: "Higher removes more edge pixels — use it for fuzzy or shadowy backgrounds." })}</p>
          </div>
        )}

        {cutoutUrl && photoUrl && (
          <div className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <p className="mb-2 text-xs font-semibold text-white/50">{t("bgStudio.before", { defaultValue: "Before" })}</p>
              <img src={photoUrl} alt="original" className="w-full rounded-xl border border-white/15 object-contain bg-black/40" />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-white/50">{t("bgStudio.after", { defaultValue: "After" })}</p>
              <img
                src={cutoutUrl}
                alt="cutout"
                className="w-full rounded-xl border border-white/15 object-contain"
                style={{ backgroundImage: "conic-gradient(#b9b9b9 25%, #dcdcdc 0 50%, #b9b9b9 0 75%, #dcdcdc 0)", backgroundSize: "16px 16px" }}
              />
            </div>
          </div>
        )}
        {detectedColor && (
          <p className="mt-2 text-[11px] text-white/35">{t("bgStudio.detectedColor", { defaultValue: "Detected background color" })}: {detectedColor}</p>
        )}
      </section>

      {/* ── Step 3: replace the background ── */}
      <section className={`rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6 ${!cutoutUrl ? "opacity-40 pointer-events-none" : ""}`}>
        <div className="flex items-center gap-2 mb-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400/20 text-xs font-black text-amber-300">3</span>
          <h3 className="font-bold text-white">{t("bgStudio.step3", { defaultValue: "Replace the background" })}</h3>
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.02] p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
          {(["color", "gradient", "ai"] as ReplaceKind[]).map((kind) => (
            <button
              key={kind}
              role="tab"
              aria-selected={replaceKind === kind}
              onClick={() => setReplaceKind(kind)}
              className={`flex flex-none whitespace-nowrap sm:flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                replaceKind === kind ? "bg-amber-400/20 text-amber-300" : "text-white/50 hover:text-white"
              }`}
            >
              {kind === "color" && <Palette className="h-4 w-4" />}
              {kind === "gradient" && <ImageIcon className="h-4 w-4" />}
              {kind === "ai" && <Sparkles className="h-4 w-4" />}
              {t(`bgStudio.kind.${kind}`, { defaultValue: kind === "color" ? "Color" : kind === "gradient" ? "Gradient" : "AI backdrop" })}
            </button>
          ))}
        </div>

        {replaceKind === "color" && (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={c}
                  className={`h-9 w-9 rounded-full border-2 transition ${color === c ? "border-amber-300 scale-110" : "border-white/20 hover:border-white/50"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <label className="ml-1 flex items-center gap-2 text-xs text-white/50">
                {t("bgStudio.custom", { defaultValue: "Custom" })}
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-white/20 bg-transparent" />
              </label>
            </div>
          </div>
        )}

        {replaceKind === "gradient" && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {GRADIENT_PRESETS.map((g) => (
              <button
                key={g.id}
                onClick={() => setGradientId(g.id)}
                className={`relative h-16 overflow-hidden rounded-xl border-2 transition ${gradientId === g.id ? "border-amber-300" : "border-white/15 hover:border-white/40"}`}
                style={{ background: g.css }}
              >
                <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-[10px] font-semibold text-white">{g.name}</span>
                {gradientId === g.id && <Check className="absolute right-1 top-1 h-4 w-4 text-white drop-shadow" />}
              </button>
            ))}
          </div>
        )}

        {replaceKind === "ai" && (
          <div>
            {statusLoading && <p className="text-sm text-white/50">{t("bgStudio.checkingAi", { defaultValue: "Checking AI availability…" })}</p>}
            {!statusLoading && !aiEnabled && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                {t("bgStudio.aiNotConnected", { defaultValue: "AI backdrops are not connected on this server yet. Pick a solid color or preset scene instead." })}
              </div>
            )}
            {aiEnabled && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {AI_PRESET_PROMPTS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleGenerateBackdrop(p.prompt)}
                      disabled={generating}
                      className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs text-white/70 hover:border-amber-400/60 hover:text-white disabled:opacity-40"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div>
                  <Label className="text-xs text-white/60">{t("bgStudio.customPrompt", { defaultValue: "Custom backdrop prompt" })}</Label>
                  <Textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    placeholder={t("bgStudio.promptPlaceholder", { defaultValue: "Describe the backdrop — e.g. “golden desert dunes at dawn, soft light”" }) as string}
                    className="mt-1 bg-black/30 text-white"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Label className="text-xs text-white/60">{t("bgStudio.provider", { defaultValue: "Model" })}</Label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setProvider("nano-banana-2.1")}
                      disabled={!backdropStatus?.nanoConfigured}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${provider === "nano-banana-2.1" ? "border-amber-300 bg-amber-400/15 text-amber-300" : "border-white/15 text-white/50 hover:text-white"} disabled:opacity-30`}
                    >
                      Turbo Render
                    </button>
                    <button
                      onClick={() => setProvider("ideogram-4.0")}
                      disabled={!backdropStatus?.ideogramConfigured}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${provider === "ideogram-4.0" ? "border-amber-300 bg-amber-400/15 text-amber-300" : "border-white/15 text-white/50 hover:text-white"} disabled:opacity-30`}
                    >
                      Portrait Render
                    </button>
                  </div>
                </div>
                <Button
                  onClick={() => handleGenerateBackdrop()}
                  disabled={generating || !aiPrompt.trim()}
                  className="bg-gradient-to-r from-[#fbbf24] to-[#d4a017] text-black font-bold hover:opacity-90"
                >
                  {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {generating
                    ? t("bgStudio.generating", { defaultValue: "Generating backdrop…" })
                    : t("bgStudio.generateCta", { defaultValue: "Generate AI backdrop" })}
                  <CostBadge cost={BACKDROP_COST} className="ml-2" />
                </Button>
                <p className="text-[11px] text-white/35">{t("bgStudio.priceTbdNote", { defaultValue: "Draft price — not final. Free colors and gradients never cost anything." })}</p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Result + download (free) ── */}
      {(composing || resultUrl) && (
        <section className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.04] p-5 md:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="font-bold text-white">{t("bgStudio.result", { defaultValue: "Your new photo" })}</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={resetAll}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                {t("bgStudio.startOver", { defaultValue: "Start over" })}
              </Button>
              {resultUrl && (
                <a href={resultUrl} download="bowdown-background-studio.png">
                  <Button size="sm" className="bg-gradient-to-r from-[#fbbf24] to-[#d4a017] text-black font-bold hover:opacity-90">
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    {t("bgStudio.download", { defaultValue: "Download PNG" })}
                  </Button>
                </a>
              )}
            </div>
          </div>
          {composing && !resultUrl ? (
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" />{t("bgStudio.composing", { defaultValue: "Compositing…" })}
            </div>
          ) : resultUrl ? (
            <img src={resultUrl} alt="final" className="mx-auto max-h-[560px] rounded-xl border border-white/15 object-contain" />
          ) : null}
        </section>
      )}
    </div>
  );
}
