import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Sparkles,
  Upload,
  Wand2,
  SlidersHorizontal,
  Download,
  Loader2,
  AlertTriangle,
  ImagePlus,
  RotateCcw,
  Check,
  ChevronsLeftRight,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { r2UploadFile } from "@/lib/r2-storage";

/**
 * PHOTO ENHANCE & RESTORE — docked as the "Enhance" tab on Thumbnail Studio.
 *
 * Flow: upload photo → pick operations (autopilot / toggles / strength
 * sliders) → before/after preview → download.
 *
 * All four operations (upscale, denoise, restore, colorize) run on the gated
 * Nano Banana 2.1 AI provider via POST /api/photo-enhance. There is no local
 * (free) processing path in this build — every run costs credits.
 */

/* PLACEHOLDER credit price — NOT USER-APPROVED. Shown in the confirm popup
   and must be finalized before this ships. */
const PHOTO_ENHANCE_COST_PLACEHOLDER = 100;

type EnhanceOp = "upscale" | "denoise" | "restore" | "colorize";

const ALL_OPS: EnhanceOp[] = ["upscale", "denoise", "restore", "colorize"];

/** Autopilot: everything a clean photo needs; colorize stays opt-in (B&W only). */
const AUTOPILOT_OPS: EnhanceOp[] = ["upscale", "denoise", "restore"];

const OP_META: Record<EnhanceOp, { icon: string; cost: boolean }> = {
  upscale: { icon: "🔍", cost: true },
  denoise: { icon: "✨", cost: true },
  restore: { icon: "🩹", cost: true },
  colorize: { icon: "🎨", cost: true },
};

interface EnhanceResult {
  url: string;
  operations: EnhanceOp[];
}

export function PhotoEnhance() {
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedOps, setSelectedOps] = useState<EnhanceOp[]>(AUTOPILOT_OPS);
  const [strengths, setStrengths] = useState<Record<EnhanceOp, number>>({
    upscale: 70,
    denoise: 70,
    restore: 70,
    colorize: 70,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [result, setResult] = useState<EnhanceResult | null>(null);
  const [comparePos, setComparePos] = useState(50);
  const [error, setError] = useState<string | null>(null);

  const pickFile = useCallback(() => fileInputRef.current?.click(), []);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError(t("photoEnhance.errorNotImage", { defaultValue: "Please choose an image file." }));
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError(t("photoEnhance.errorTooLarge", { defaultValue: "That photo is over 12 MB — pick a smaller one." }));
      return;
    }
    setError(null);
    setResult(null);
    setUploading(true);
    try {
      const token = await getAccessToken().catch(() => null);
      const key = `photo-enhance/${user?.id ?? "anon"}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const publicUrl = await r2UploadFile(key, file, file.type, token);
      setOriginalUrl(publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("photoEnhance.errorUpload", { defaultValue: "Upload failed. Try again." }));
    } finally {
      setUploading(false);
    }
  }

  function toggleOp(op: EnhanceOp) {
    setSelectedOps((prev) => (prev.includes(op) ? prev.filter((o) => o !== op) : [...prev, op]));
    setResult(null);
  }

  function runAutopilot() {
    setSelectedOps(AUTOPILOT_OPS);
    setShowAdvanced(false);
    void runEnhance(AUTOPILOT_OPS, null);
  }

  async function runEnhance(ops: EnhanceOp[], strengthMap: Record<EnhanceOp, number> | null) {
    if (!originalUrl) {
      setError(t("photoEnhance.errorNoPhoto", { defaultValue: "Upload a photo first." }));
      return;
    }
    if (ops.length === 0) {
      setError(t("photoEnhance.errorNoOps", { defaultValue: "Pick at least one enhancement." }));
      return;
    }
    setEnhancing(true);
    setError(null);
    setResult(null);
    try {
      const res = await confirmedFetch("/api/photo-enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: originalUrl,
          operations: ops,
          ...(strengthMap ? { strengths: Object.fromEntries(ops.map((o) => [o, strengthMap[o]])) } : {}),
        }),
        overrideCost: PHOTO_ENHANCE_COST_PLACEHOLDER,
        overrideFeature: t("photoEnhance.featureName", { defaultValue: "Photo Enhance" }),
      });
      if (!res) {
        setEnhancing(false);
        return; // user cancelled the credit confirmation
      }
      const data = (await res.json()) as {
        url?: string;
        operations?: EnhanceOp[];
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.url) {
        if (data.error === "photo_enhance_not_connected") {
          throw new Error(
            data.message ??
              t("photoEnhance.errorNotConnected", {
                defaultValue: "Photo Enhance is not connected yet — the AI image service still needs to be set up.",
              })
          );
        }
        throw new Error(data.message ?? data.error ?? `Enhance API error (HTTP ${res.status})`);
      }
      setResult({ url: data.url, operations: data.operations ?? ops });
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("photoEnhance.errorFailed", { defaultValue: "Enhancement failed. Try again." });
      setError(msg === "out_of_credits" ? t("photoEnhance.errorCredits", { defaultValue: "Not enough Visual Bucs. Please buy more Visual Bucs to continue." }) : msg);
    } finally {
      setEnhancing(false);
    }
  }

  /** Download the enhanced image as a file (blob fetch, falls back to new tab). */
  async function handleDownload() {
    if (!result?.url) return;
    try {
      const res = await fetch(result.url);
      if (!res.ok) throw new Error(`download ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `enhanced-photo-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
    } catch {
      window.open(result.url, "_blank", "noopener");
    }
  }

  function resetAll() {    setOriginalUrl(null);
    setResult(null);
    setError(null);
    setSelectedOps(AUTOPILOT_OPS);
    setShowAdvanced(false);
    setComparePos(50);
  }

  const busy = uploading || enhancing;

  return (
    <div className="text-white">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />

      {/* ── Step 1: upload ── */}
      {!originalUrl && (
        <button
          onClick={pickFile}
          disabled={busy}
          className="flex w-full flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.03] px-6 py-16 transition hover:border-[#fbbf24]/60 hover:bg-white/[0.05] disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#fbbf24] to-[#d4a017] shadow-[0_0_28px_rgba(251,191,36,0.35)]">
              <ImagePlus className="h-8 w-8 text-black" />
            </div>
          )}
          <div className="text-center">
            <div className="text-lg font-bold">
              {t("photoEnhance.uploadTitle", { defaultValue: "Upload a photo to enhance" })}
            </div>
            <div className="mt-1 text-sm text-white/50">
              {t("photoEnhance.uploadHint", { defaultValue: "JPG or PNG, up to 12 MB. Old, noisy, or black-and-white photos welcome." })}
            </div>
          </div>
        </button>
      )}

      {/* ── Steps 2–4: operations + preview ── */}
      {originalUrl && (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          {/* Preview */}
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="text-sm font-semibold text-white/70">
                {result
                  ? t("photoEnhance.beforeAfter", { defaultValue: "Before / After — drag the divider" })
                  : t("photoEnhance.previewOriginal", { defaultValue: "Your photo" })}
              </div>
              <button
                onClick={resetAll}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white/50 transition hover:bg-white/10 hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("photoEnhance.startOver", { defaultValue: "Start over" })}
              </button>
            </div>
            <div className="relative aspect-[4/3] w-full select-none overflow-hidden bg-black/40">
              {result ? (
                <>
                  <img src={result.url} alt="Enhanced" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
                  <div
                    className="absolute inset-0"
                    style={{ clipPath: `inset(0 ${100 - comparePos}% 0 0)` }}
                  >
                    <img src={originalUrl} alt="Original" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
                  </div>
                  <div className="absolute inset-y-0" style={{ left: `${comparePos}%` }}>
                    <div className="h-full w-0.5 -translate-x-1/2 bg-[#fbbf24] shadow-[0_0_12px_rgba(251,191,36,0.8)]" />
                    <div className="pointer-events-none absolute top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gradient-to-br from-[#fbbf24] to-[#d4a017] shadow-[0_0_16px_rgba(251,191,36,0.6)]">
                      <ChevronsLeftRight className="h-5 w-5 text-black" />
                    </div>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={98}
                    value={comparePos}
                    onChange={(e) => setComparePos(Number(e.target.value))}
                    className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
                    aria-label={t("photoEnhance.compareSlider", { defaultValue: "Compare before and after" })}
                  />
                  <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-xs font-bold text-white/80">
                    {t("photoEnhance.before", { defaultValue: "Before" })}
                  </span>
                  <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-[#fbbf24] px-2.5 py-1 text-xs font-bold text-black">
                    {t("photoEnhance.after", { defaultValue: "After" })}
                  </span>
                </>
              ) : (
                <img src={originalUrl} alt="Original" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
              )}
              {enhancing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-sm">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  <div className="text-sm font-semibold text-white/80">
                    {t("photoEnhance.enhancing", { defaultValue: "Enhancing your photo…" })}
                  </div>
                </div>
              )}
            </div>
            {result && (
              <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
                <div className="flex items-center gap-1.5 text-xs text-white/50">
                  <Check className="h-4 w-4 text-green-400" />
                  {t("photoEnhance.applied", {
                    defaultValue: "Applied: {{ops}}",
                    ops: result.operations
                      .map((o) => t(`photoEnhance.ops.${o}`, { defaultValue: o }))
                      .join(" + "),
                  })}
                </div>
                <button
                  onClick={() => void handleDownload()}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#fbbf24] to-[#d4a017] px-4 py-2 text-sm font-bold text-black shadow-[0_0_18px_rgba(251,191,36,0.35)] transition hover:brightness-110"
                >
                  <Download className="h-4 w-4" />
                  {t("photoEnhance.download", { defaultValue: "Download" })}
                </button>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-5">
            {/* Autopilot */}
            <div className="rounded-2xl border border-[#fbbf24]/30 bg-gradient-to-b from-[#fbbf24]/10 to-transparent p-5">
              <div className="mb-1 flex items-center gap-2 text-base font-bold">
                <Sparkles className="h-5 w-5 text-primary" />
                {t("photoEnhance.autopilotTitle", { defaultValue: "Enhance everything" })}
              </div>
              <p className="mb-4 text-sm text-white/50">
                {t("photoEnhance.autopilotHint", {
                  defaultValue: "One tap: upscale, denoise, and repair damage — the AI picks the rest.",
                })}
              </p>
              <button
                onClick={runAutopilot}
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#fbbf24] to-[#d4a017] px-4 py-3 text-sm font-bold text-black shadow-[0_0_18px_rgba(251,191,36,0.35)] transition hover:brightness-110 disabled:opacity-50"
              >
                {enhancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {t("photoEnhance.autopilotButton", { defaultValue: "✨ Enhance everything" })}
              </button>
              <div className="mt-2 text-center text-xs text-white/40">
                {t("photoEnhance.costNote", {
                  defaultValue: "{{cost}} Visual Bucs per enhancement",
                  cost: PHOTO_ENHANCE_COST_PLACEHOLDER,
                })}
              </div>
            </div>

            {/* Guided toggles */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="mb-3 text-sm font-bold text-white/80">
                {t("photoEnhance.pickOps", { defaultValue: "Or pick operations" })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {ALL_OPS.map((op) => {
                  const active = selectedOps.includes(op);
                  return (
                    <button
                      key={op}
                      onClick={() => toggleOp(op)}
                      disabled={busy}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
                        active
                          ? "border-[#fbbf24]/70 bg-[#fbbf24]/15 text-white"
                          : "border-white/10 bg-white/[0.03] text-white/50 hover:border-white/25 hover:text-white"
                      }`}
                    >
                      <span aria-hidden>{OP_META[op].icon}</span>
                      {t(`photoEnhance.ops.${op}`, { defaultValue: op })}
                      {active && <Check className="ml-auto h-4 w-4 text-primary" />}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-white/40">
                {t("photoEnhance.colorizeHint", {
                  defaultValue: "Colorize only applies to black-and-white photos. Restore repairs scratches, dust, and fading.",
                })}
              </p>

              {/* Advanced: strength sliders */}
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-white/50 transition hover:text-white"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t("photoEnhance.advanced", { defaultValue: "Advanced — strength sliders" })}
                <span className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`}>▾</span>
              </button>
              {showAdvanced && (
                <div className="mt-3 flex flex-col gap-3">
                  {selectedOps.map((op) => (
                    <label key={op} className="block">
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-semibold text-white/70">
                          {t(`photoEnhance.ops.${op}`, { defaultValue: op })}
                        </span>
                        <span className="text-white/40">{strengths[op]}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={strengths[op]}
                        disabled={busy}
                        onChange={(e) =>
                          setStrengths((prev) => ({ ...prev, [op]: Number(e.target.value) }))
                        }
                        className="w-full accent-[#fbbf24]"
                      />
                    </label>
                  ))}
                </div>
              )}

              <button
                onClick={() => void runEnhance(selectedOps, showAdvanced ? strengths : null)}
                disabled={busy || selectedOps.length === 0}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#fbbf24]/50 bg-[#fbbf24]/10 px-4 py-2.5 text-sm font-bold text-primary transition hover:bg-[#fbbf24]/20 disabled:opacity-50"
              >
                {enhancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 rotate-90" />}
                {t("photoEnhance.runSelected", { defaultValue: "Enhance with selected" })}
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default PhotoEnhance;
