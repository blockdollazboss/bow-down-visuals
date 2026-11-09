/**
 * PhotoBenches — the Photo Studio family's native benches at
 * the Photo Desk (Stack 400 world parity, census Lane B item
 * B-04): BgStudio's background pair (remove + AI backdrop),
 * the editor's background-plate rail, PhotoEnhance, the
 * Headshot Studio and the Product Photo Studio — each on its
 * 2D twin's own rail (lib/world/photo-desk.ts), each charged
 * call on the registry-priced spend confirmation, each bench
 * rendering the NativeStates trio for its loading / empty /
 * failed moments and its twin's own catalog copy wherever the
 * twin has it (bgStudio.*, photoEnhance.*, headshotStudio.*,
 * productPhotoStudio.*, wave9.bgReplace.ai.*), so a bench's
 * words can never drift from its page's.
 *
 * One photo feeds the desk: the intake at the top uploads
 * through the family's own free door (POST
 * /api/ai-page-designer/upload — BgStudio's door, BgStudio's
 * pick rules) or takes a pasted URL, and every bench that
 * works on a photo works on that one. Finished work flows
 * into the hub project exactly as the other benches' does.
 */
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Camera,
  CheckCircle2,
  Eraser,
  ImagePlus,
  Loader2,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage, plainErrorText } from "@/lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { AdvancedExpander, DeskSelectField, DeskTextField, deskInputCls } from "./CreateDeskLeaf";
import { ImageResult } from "./CreateResultLeaf";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  AUTOPILOT_ENHANCE_OPS,
  BACKDROP_PROVIDERS,
  BACKDROP_RATIOS,
  BG_GENERATE_NOT_CONFIGURED_CODE,
  BG_GENERATE_PATH,
  BG_GENERATE_STATUS_PATH,
  BG_GENERATE_STYLE_DEFAULT_LABELS,
  BG_GENERATE_STYLE_LABEL_KEYS,
  BG_GENERATE_STYLES,
  ENHANCE_OPS,
  HEADSHOT_FLOWS,
  HEADSHOT_MODELS,
  HEADSHOT_PATH,
  HEADSHOT_PRESETS,
  PHOTO_BACKDROP_PATH,
  PHOTO_BACKDROP_STATUS_PATH,
  PHOTO_ENHANCE_NOT_CONNECTED_CODE,
  PHOTO_ENHANCE_PATH,
  PHOTO_UPLOAD_PATH,
  PRODUCT_KINDS,
  PRODUCT_MODELS,
  PRODUCT_PHOTO_PATH,
  PRODUCT_RATIOS,
  PRODUCT_STYLE_MODES,
  REMOVE_BACKGROUND_PATH,
  backdropStatusOf,
  bgGenerateCost,
  bgGenerateStatusOf,
  bgGenerateUrlOf,
  buildBgGeneratePayload,
  buildHeadshotPayload,
  buildPhotoBackdropPayload,
  buildPhotoEnhancePayload,
  buildProductPhotoPayload,
  buildRemoveBackgroundPayload,
  closestBackdropRatio,
  defaultBackdropProvider,
  enhanceResultOf,
  headshotCost,
  isHeadshotProviderDown,
  mintBgGenerateIdempotencyKey,
  photoBackdropCost,
  photoEnhanceCost,
  photoErrorCodeOf,
  photoIntakeVerdict,
  photoResultUrlOf,
  photoUploadUrlOf,
  productPhotoCost,
  productPhotoResultOf,
  productScenePresets,
  removeBackgroundCost,
  type BackdropProvider,
  type BackdropRatio,
  type BgGenerateStyle,
  type EnhanceOp,
  type HeadshotFlow,
  type HeadshotModel,
  type HeadshotPreset,
  type ProductKind,
  type ProductModel,
  type ProductRatio,
  type ProductScenePreset,
  type ProductShotType,
  type ProductStyleMode,
} from "@/lib/world/photo-desk";

/* ─── Shared bench chrome ────────────────────────────────────── */

type RunState = "idle" | "running" | "done" | "failed";

const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target";

function chipCls(isLight: boolean, active: boolean) {
  return `rounded-xl border px-3 py-2 text-left text-xs transition bdv-touch-target ${
    active
      ? isLight
        ? "border-[#C9A84C] bg-[#F7ECD2] text-[#2a1e07]"
        : "border-amber-400 bg-amber-400/[0.16] text-amber-200"
      : isLight
        ? "border-[#C9A84C]/30 text-[#6B5B36] hover:border-[#C9A84C]/60"
        : "border-white/10 text-white/60 hover:border-white/30"
  }`;
}

function BenchHead({
  isLight,
  icon: Icon,
  title,
  cost,
}: {
  isLight: boolean;
  icon: ComponentType<{ className?: string }>;
  title: string;
  cost: number;
}) {
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-4 w-4 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
      <p className={`text-base font-black ${strong}`}>{title}</p>
      <span
        className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
          isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"
        }`}
      >
        {cost} VB
      </span>
    </div>
  );
}

function OutOfBucsLine({ isLight, feature }: { isLight: boolean; feature: string }) {
  const { t } = useTranslation();
  return (
    <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
      {t("worldBenches300.outOfBucs", { feature })}
    </p>
  );
}

/** Load an image just far enough to know its shape (the backdrop
 *  rail renders at the source photo's own ratio). Best-effort:
 *  an unmeasurable photo simply leaves the ratio at square. */
function measureImage(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export interface DeskPhoto {
  url: string;
  dims: { w: number; h: number } | null;
}

/* ─── The shared intake ────────────────────────────────────────
   One photo for the whole desk: upload through the family's
   free door (BgStudio's own) or paste a photo URL. */

export function PhotoIntake({
  isLight,
  photo,
  onPhoto,
}: {
  isLight: boolean;
  photo: DeskPhoto | null;
  onPhoto: (photo: DeskPhoto | null) => void;
}) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  async function adopt(url: string) {
    const dims = await measureImage(url);
    onPhoto({ url, dims });
  }

  async function pickFile(file: File | undefined) {
    if (!file || uploading) return;
    const verdict = photoIntakeVerdict(file);
    if (verdict === "not-image") {
      setError(t("bgStudio.uploadNotImage"));
      return;
    }
    if (verdict === "too-large") {
      setError(t("worldPhotoDesk.uploadTooLarge", { defaultValue: "That photo is over 5 MB — pick a smaller one." }));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "background");
      const res = await confirmedFetch(PHOTO_UPLOAD_PATH, { method: "POST", body: form, skipConfirm: true });
      if (!res) {
        setUploading(false);
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      const url = photoUploadUrlOf(data);
      if (!res.ok || !url) {
        setError(apiErrorMessage(data, t("bgStudio.uploadFailed")));
        setUploading(false);
        return;
      }
      await adopt(url);
    } catch {
      setError(t("bgStudio.uploadFailed"));
    }
    setUploading(false);
  }

  return (
    <div className="space-y-3" data-testid="world-photo-intake">
      <div className="flex items-center gap-2">
        <ImagePlus className={`h-4 w-4 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
        <p className={`text-base font-black ${strong}`}>
          {t("worldPhotoDesk.yourPhoto", { defaultValue: "Your photo" })}
        </p>
        <span className={`ml-auto text-[11px] font-bold ${muted}`}>
          {t("worldPhotoDesk.uploadFree", { defaultValue: "Uploads are free" })}
        </span>
      </div>

      {photo ? (
        <div className="space-y-2">
          {uploading ? <NativeLoadingState isLight={isLight} message={t("bgStudio.uploading")} /> : null}
          <img src={photo.url} alt={t("bgStudio.photoReady")} className="max-h-[220px] w-full rounded-xl object-contain" />
          <div className="flex flex-wrap items-center gap-2">
            <p className={`inline-flex items-center gap-1.5 text-xs font-semibold ${strong}`}>
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> {t("bgStudio.photoReady")}
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className={`ml-auto text-xs font-bold underline-offset-2 hover:underline ${muted}`}
            >
              {t("bgStudio.changePhoto")}
            </button>
            <button
              type="button"
              onClick={() => onPhoto(null)}
              className={`text-xs font-bold underline-offset-2 hover:underline ${muted}`}
            >
              {t("worldPhotoDesk.clearPhoto", { defaultValue: "Clear" })}
            </button>
          </div>
        </div>
      ) : uploading ? (
        <NativeLoadingState isLight={isLight} message={t("bgStudio.uploading")} />
      ) : (
        <>
          <NativeEmptyState
            isLight={isLight}
            message={t("worldPhotoDesk.noPhoto", {
              defaultValue: "No photo loaded yet — upload one or paste a photo URL, then pick a bench below.",
            })}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={`w-full rounded-xl border-2 border-dashed p-5 text-center transition bdv-touch-target ${
              isLight ? "border-[#C9A84C]/40 hover:border-[#C9A84C]/70" : "border-white/15 hover:border-amber-500/50"
            }`}
          >
            <Upload className={`mx-auto h-6 w-6 ${isLight ? "text-[#7A5A12]" : "text-amber-400"}`} />
            <span className={`mt-2 block text-sm font-medium ${strong}`}>{t("bgStudio.dropHint")}</span>
          </button>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void pickFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="flex gap-2">
        <input
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          placeholder={t("productPhotoStudio.pastePlaceholder")}
          className={deskInputCls(isLight)}
        />
        <button
          type="button"
          disabled={!urlDraft.trim() || uploading}
          onClick={() => {
            const url = urlDraft.trim();
            setUrlDraft("");
            setError(null);
            void adopt(url);
          }}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
            isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"
          }`}
        >
          {t("productPhotoStudio.useUrl")}
        </button>
      </div>
      {error ? (
        <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{error}</p>
      ) : null}
    </div>
  );
}

/* ─── Remove Background (BgStudio step 2) ────────────────────── */

export function RemoveBackgroundBench({ isLight, photo }: { isLight: boolean; photo: DeskPhoto | null }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();
  const [aggressiveness, setAggressiveness] = useState(0.5);
  const [state, setState] = useState<RunState>("idle");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [backgroundColor, setBackgroundColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const cost = removeBackgroundCost();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  async function run() {
    if (!photo || state === "running") return;
    setState("running");
    setError(null);
    setOutOfCredits(false);
    setResultUrl(null);
    setBackgroundColor(null);
    try {
      const res = await confirmedFetch(REMOVE_BACKGROUND_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRemoveBackgroundPayload(photo.url, aggressiveness)),
        overrideCost: cost,
        overrideFeature: "Background Removal",
      });
      if (!res) {
        setState("idle");
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setState("idle");
        return;
      }
      const url = photoResultUrlOf(data);
      if (!res.ok || !url) {
        setError(apiErrorMessage(data, t("bgStudio.removeFailed")));
        setState("failed");
        return;
      }
      const color = (data as { backgroundColor?: unknown }).backgroundColor;
      setBackgroundColor(typeof color === "string" ? color : null);
      setResultUrl(url);
      setState("done");
      try {
        addAsset({ kind: "image", url, label: "Background removed", detail: "Photo Desk · Remove background" });
      } catch { /* non-fatal — the Caption Styler bench's own guard */ }
    } catch (err) {
      setError(plainErrorText(err, t("bgStudio.removeFailed")));
      setState("failed");
    }
  }

  return (
    <div className="space-y-3" data-testid="world-photo-remove-bg-bench">
      <BenchHead isLight={isLight} icon={Eraser} title={t("bgStudio.step2")} cost={cost} />
      {!photo ? (
        <NativeEmptyState
          isLight={isLight}
          message={t("worldPhotoDesk.needsPhoto", { defaultValue: "Load a photo at the top of the desk first." })}
        />
      ) : (
        <>
          <div>
            <label className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              {t("bgStudio.aggressiveness")} — {Math.round(aggressiveness * 100)}%
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(aggressiveness * 100)}
              onChange={(e) => setAggressiveness(Number(e.target.value) / 100)}
              className="w-full accent-amber-400"
            />
            <p className={`mt-1 text-[11px] ${muted}`}>{t("bgStudio.aggressivenessHint")}</p>
          </div>
          <div className="flex">
            <button type="button" data-testid="world-photo-remove-bg-run" onClick={() => void run()} disabled={state === "running"} className={`${goldBtn} ml-auto`}>
              {state === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eraser className="h-4 w-4" />}
              {state === "running" ? t("bgStudio.removing") : t("bgStudio.removeCta")}
            </button>
          </div>
        </>
      )}
      {state === "running" ? <NativeLoadingState isLight={isLight} message={t("bgStudio.removing")} /> : null}
      {outOfCredits ? <OutOfBucsLine isLight={isLight} feature="Background Removal" /> : null}
      {state === "failed" && error ? <NativeErrorState isLight={isLight} message={error} onRetry={() => void run()} /> : null}
      {state === "done" && resultUrl ? (
        <div className="space-y-2">
          <ImageResult url={resultUrl} title={t("bgStudio.result")} />
          {backgroundColor ? (
            <p className={`text-[11px] ${muted}`}>
              {t("bgStudio.detectedColor")}: {backgroundColor}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ─── Photo Backdrop (BgStudio step 3, AI replace) ───────────── */

type GateState = "loading" | "ready" | "closed" | "error";

export function PhotoBackdropBench({ isLight, photo }: { isLight: boolean; photo: DeskPhoto | null }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();
  const [gate, setGate] = useState<GateState>("loading");
  const [providers, setProviders] = useState<BackdropProvider[]>([]);
  const [provider, setProvider] = useState<BackdropProvider>("nano-banana-2.1");
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<BackdropRatio>("1080:1080");
  const [state, setState] = useState<RunState>("idle");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const cost = photoBackdropCost();
  const ratioTouched = useRef(false);

  /* The page's own shape rule: the backdrop renders at the
     source photo's ratio until the member picks one themselves. */
  useEffect(() => {
    if (!ratioTouched.current && photo?.dims) {
      setRatio(closestBackdropRatio(photo.dims.w, photo.dims.h));
    }
  }, [photo]);

  async function loadGate() {
    setGate("loading");
    try {
      const res = await confirmedFetch(PHOTO_BACKDROP_STATUS_PATH, { skipConfirm: true });
      if (!res) {
        setGate("error");
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      const status = backdropStatusOf(data);
      if (!res.ok || !status || !status.configured) {
        setGate("closed");
        return;
      }
      const first = defaultBackdropProvider(status);
      if (!first) {
        setGate("closed");
        return;
      }
      setProviders(BACKDROP_PROVIDERS.filter((p) => (p === "nano-banana-2.1" ? status.nanoConfigured : status.ideogramConfigured)));
      setProvider(first);
      setGate("ready");
    } catch {
      setGate("error");
    }
  }

  useEffect(() => {
    void loadGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    if (state === "running" || !prompt.trim()) return;
    setState("running");
    setError(null);
    setOutOfCredits(false);
    setResultUrl(null);
    try {
      const res = await confirmedFetch(PHOTO_BACKDROP_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPhotoBackdropPayload(prompt.trim(), provider, ratio)),
        overrideCost: cost,
        overrideFeature: "Photo Backdrop",
      });
      if (!res) {
        setState("idle");
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setState("idle");
        return;
      }
      if (res.status === 503) {
        setGate("closed");
        setState("idle");
        return;
      }
      const url = photoResultUrlOf(data);
      if (!res.ok || !url) {
        setError(apiErrorMessage(data, t("bgStudio.backdropFailed")));
        setState("failed");
        return;
      }
      setResultUrl(url);
      setState("done");
      try {
        addAsset({ kind: "image", url, label: "AI backdrop", detail: "Photo Desk · Photo backdrop" });
      } catch { /* non-fatal */ }
    } catch (err) {
      setError(plainErrorText(err, t("bgStudio.backdropFailed")));
      setState("failed");
    }
  }

  return (
    <div className="space-y-3" data-testid="world-photo-backdrop-bench">
      <BenchHead isLight={isLight} icon={Sparkles} title={t("bgStudio.kind.ai")} cost={cost} />
      {gate === "loading" ? <NativeLoadingState isLight={isLight} message={t("bgStudio.checkingAi")} /> : null}
      {gate === "error" ? (
        <NativeErrorState
          isLight={isLight}
          message={t("worldPhotoDesk.gateCheckFailed", { defaultValue: "Couldn't check AI availability — try again." })}
          onRetry={() => void loadGate()}
        />
      ) : null}
      {gate === "closed" ? <NativeEmptyState isLight={isLight} message={t("bgStudio.aiNotConnected")} /> : null}
      {gate === "ready" ? (
        <>
          <DeskTextField
            isLight={isLight}
            label={t("bgStudio.customPrompt")}
            value={prompt}
            onChange={setPrompt}
            placeholder={t("bgStudio.promptPlaceholder")}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskSelectField
              isLight={isLight}
              label={t("bgStudio.provider")}
              value={provider}
              onChange={(v) => setProvider(v as BackdropProvider)}
              options={providers.map((p) => ({
                value: p,
                label:
                  p === "nano-banana-2.1"
                    ? t("worldPhotoDesk.providerNano", { defaultValue: "Nano Banana 2.1" })
                    : t("worldPhotoDesk.providerIdeogram", { defaultValue: "Ideogram 4.0" }),
              }))}
            />
            <DeskSelectField
              isLight={isLight}
              label={t("worldPhotoDesk.ratioLabel", { defaultValue: "Shape" })}
              value={ratio}
              onChange={(v) => {
                ratioTouched.current = true;
                setRatio(v as BackdropRatio);
              }}
              options={BACKDROP_RATIOS.map((r) => ({
                value: r,
                label:
                  r === "1080:1080"
                    ? t("productPhotoStudio.ratioSquare")
                    : r === "1080:1920"
                      ? t("productPhotoStudio.ratioStory")
                      : t("worldPhotoDesk.ratioWide", { defaultValue: "Wide 16:9" }),
              }))}
            />
          </div>
          <div className="flex">
            <button type="button" data-testid="world-photo-backdrop-run" onClick={() => void run()} disabled={state === "running" || !prompt.trim()} className={`${goldBtn} ml-auto`}>
              {state === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {state === "running" ? t("bgStudio.generating") : t("bgStudio.generateCta")}
            </button>
          </div>
        </>
      ) : null}
      {state === "running" ? <NativeLoadingState isLight={isLight} message={t("bgStudio.generating")} /> : null}
      {outOfCredits ? <OutOfBucsLine isLight={isLight} feature="Photo Backdrop" /> : null}
      {state === "failed" && error ? <NativeErrorState isLight={isLight} message={error} onRetry={() => void run()} /> : null}
      {state === "done" && resultUrl ? <ImageResult url={resultUrl} title={t("bgStudio.result")} /> : null}
    </div>
  );
}

/* ─── Background Plate (the editor's bg-generate rail) ───────── */

export function BgPlateBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();
  const [gate, setGate] = useState<GateState>("loading");
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<BgGenerateStyle>("studio");
  const [state, setState] = useState<RunState>("idle");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const cost = bgGenerateCost();
  /* One idempotency key per attempt, exactly as the editor
     section keeps it: minted on the first try, reused by that
     attempt's retries, cleared on success and on a thrown
     failure (the server voids the charge's key when its
     provider fails, so a kept key would suppress the retry). */
  const attemptKey = useRef<string | null>(null);

  const gateMessage = t("wave9.bgReplace.ai.notConfigured", {
    defaultValue:
      "AI background generation isn't connected yet — the site owner needs to add an image-generation API key before AI backgrounds can generate. Presets and uploads keep working.",
  });

  async function loadGate() {
    setGate("loading");
    try {
      const res = await confirmedFetch(BG_GENERATE_STATUS_PATH, { skipConfirm: true });
      if (!res) {
        setGate("error");
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      const status = bgGenerateStatusOf(data);
      if (!res.ok || !status) {
        setGate("error");
        return;
      }
      setGate(status.configured ? "ready" : "closed");
    } catch {
      setGate("error");
    }
  }

  useEffect(() => {
    void loadGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    if (state === "running" || !prompt.trim()) return;
    setState("running");
    setError(null);
    setOutOfCredits(false);
    setResultUrl(null);
    try {
      if (!attemptKey.current) {
        attemptKey.current = mintBgGenerateIdempotencyKey(Date.now(), Math.random());
      }
      const res = await confirmedFetch(BG_GENERATE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBgGeneratePayload(prompt.trim(), style, attemptKey.current)),
        overrideCost: cost,
        overrideFeature: t("wave9.bgReplace.ai.confirmFeature", { defaultValue: "AI background plate" }),
      });
      if (!res) {
        setState("idle");
        return;
      }
      if (res.status === 402) {
        setOutOfCredits(true);
        setState("idle");
        return;
      }
      if (res.status === 503) {
        const data: unknown = await res.json().catch(() => null);
        if (photoErrorCodeOf(data) === BG_GENERATE_NOT_CONFIGURED_CODE) {
          /* Gate self-heals like the section's: the server lost
             its key — close the gate instead of erroring forever. */
          setGate("closed");
          setState("idle");
        } else {
          setError(apiErrorMessage(data, gateMessage));
          setState("failed");
        }
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      const url = bgGenerateUrlOf(data);
      if (!res.ok || !url) {
        attemptKey.current = null;
        setError(apiErrorMessage(data, t("wave9.bgReplace.ai.generateError", { defaultValue: "Couldn't generate that background — try again." })));
        setState("failed");
        return;
      }
      attemptKey.current = null;
      setResultUrl(url);
      setState("done");
      try {
        addAsset({ kind: "image", url, label: "Background plate", detail: "Photo Desk · Background plate" });
      } catch { /* non-fatal */ }
    } catch (err) {
      attemptKey.current = null;
      setError(plainErrorText(err, t("wave9.bgReplace.ai.generateError", { defaultValue: "Couldn't generate that background — try again." })));
      setState("failed");
    }
  }

  return (
    <div className="space-y-3" data-testid="world-photo-plate-bench">
      <BenchHead isLight={isLight} icon={Wand2} title={t("worldPhotoDesk.plateTitle", { defaultValue: "Background plates" })} cost={cost} />
      {gate === "loading" ? (
        <NativeLoadingState isLight={isLight} message={t("worldPhotoDesk.checkingPlate", { defaultValue: "Checking AI availability…" })} />
      ) : null}
      {gate === "error" ? <NativeErrorState isLight={isLight} message={gateMessage} onRetry={() => void loadGate()} /> : null}
      {gate === "closed" ? <NativeEmptyState isLight={isLight} message={gateMessage} /> : null}
      {gate === "ready" ? (
        <>
          <DeskTextField
            isLight={isLight}
            label={t("worldPhotoDesk.platePromptLabel", { defaultValue: "Describe the background" })}
            value={prompt}
            onChange={setPrompt}
            placeholder={t("bgStudio.promptPlaceholder")}
          />
          <div className="flex flex-wrap gap-1.5">
            {BG_GENERATE_STYLES.map((s) => (
              <button key={s} type="button" onClick={() => setStyle(s)} aria-pressed={style === s} className={chipCls(isLight, style === s)}>
                {t(BG_GENERATE_STYLE_LABEL_KEYS[s], { defaultValue: BG_GENERATE_STYLE_DEFAULT_LABELS[s] })}
              </button>
            ))}
          </div>
          <div className="flex">
            <button type="button" data-testid="world-photo-plate-run" onClick={() => void run()} disabled={state === "running" || !prompt.trim()} className={`${goldBtn} ml-auto`}>
              {state === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {state === "running"
                ? t("wave9.bgReplace.working", { defaultValue: "Working…" })
                : t("worldPhotoDesk.plateRun", { defaultValue: "Generate plate" })}
            </button>
          </div>
        </>
      ) : null}
      {state === "running" ? (
        <NativeLoadingState isLight={isLight} message={t("wave9.bgReplace.working", { defaultValue: "Working…" })} />
      ) : null}
      {outOfCredits ? <OutOfBucsLine isLight={isLight} feature="AI background plate" /> : null}
      {state === "failed" && error ? <NativeErrorState isLight={isLight} message={error} onRetry={() => void run()} /> : null}
      {state === "done" && resultUrl ? (
        <ImageResult url={resultUrl} title={t("wave9.bgReplace.ai.generatedTitle", { defaultValue: "Background generated" })} />
      ) : null}
    </div>
  );
}

/* ─── Photo Enhance ──────────────────────────────────────────── */

const ENHANCE_DEFAULT_STRENGTH = 70;

export function PhotoEnhanceBench({ isLight, photo }: { isLight: boolean; photo: DeskPhoto | null }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();
  const [selectedOps, setSelectedOps] = useState<EnhanceOp[]>([...AUTOPILOT_ENHANCE_OPS]);
  const [strengths, setStrengths] = useState<Record<EnhanceOp, number>>({
    upscale: ENHANCE_DEFAULT_STRENGTH,
    denoise: ENHANCE_DEFAULT_STRENGTH,
    restore: ENHANCE_DEFAULT_STRENGTH,
    colorize: ENHANCE_DEFAULT_STRENGTH,
  });
  const [state, setState] = useState<RunState>("idle");
  const [result, setResult] = useState<{ url: string; operations: EnhanceOp[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const cost = photoEnhanceCost();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  function toggleOp(op: EnhanceOp) {
    setSelectedOps((prev) => (prev.includes(op) ? prev.filter((o) => o !== op) : [...prev, op]));
    setResult(null);
  }

  async function run(ops: readonly EnhanceOp[], withStrengths: boolean) {
    if (!photo || state === "running") return;
    if (ops.length === 0) {
      setError(t("photoEnhance.errorNoOps"));
      setState("failed");
      return;
    }
    setState("running");
    setError(null);
    setOutOfCredits(false);
    setResult(null);
    try {
      const res = await confirmedFetch(PHOTO_ENHANCE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPhotoEnhancePayload(photo.url, ops, withStrengths ? strengths : null)),
        overrideCost: cost,
        overrideFeature: t("photoEnhance.featureName", { defaultValue: "Photo Enhance" }),
      });
      if (!res) {
        setState("idle");
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setState("idle");
        return;
      }
      const parsed = enhanceResultOf(data, ops);
      if (!res.ok || !parsed) {
        setError(
          photoErrorCodeOf(data) === PHOTO_ENHANCE_NOT_CONNECTED_CODE
            ? t("photoEnhance.errorNotConnected")
            : apiErrorMessage(data, t("photoEnhance.errorFailed")),
        );
        setState("failed");
        return;
      }
      setResult(parsed);
      setState("done");
      try {
        addAsset({ kind: "image", url: parsed.url, label: "Enhanced photo", detail: "Photo Desk · Photo enhance" });
      } catch { /* non-fatal */ }
    } catch (err) {
      setError(plainErrorText(err, t("photoEnhance.errorFailed")));
      setState("failed");
    }
  }

  return (
    <div className="space-y-3" data-testid="world-photo-enhance-bench">
      <BenchHead isLight={isLight} icon={Sparkles} title={t("photoEnhance.featureName")} cost={cost} />
      {!photo ? (
        <NativeEmptyState isLight={isLight} message={t("photoEnhance.errorNoPhoto")} />
      ) : (
        <>
          <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
            <p className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{t("photoEnhance.autopilotTitle")}</p>
            <p className={`mt-0.5 text-[11px] ${muted}`}>{t("photoEnhance.autopilotHint")}</p>
            <button
              type="button"
              data-testid="world-photo-enhance-autopilot"
              onClick={() => void run(AUTOPILOT_ENHANCE_OPS, false)}
              disabled={state === "running"}
              className={`${goldBtn} mt-2`}
            >
              {state === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {t("photoEnhance.autopilotButton")}
            </button>
          </div>
          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("photoEnhance.pickOps")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ENHANCE_OPS.map((op) => (
              <button
                key={op}
                type="button"
                aria-pressed={selectedOps.includes(op)}
                onClick={() => toggleOp(op)}
                className={chipCls(isLight, selectedOps.includes(op))}
              >
                {t(`photoEnhance.ops.${op}`)}
              </button>
            ))}
          </div>
          <p className={`text-[11px] ${muted}`}>{t("photoEnhance.colorizeHint")}</p>
          {/* The page sends its slider values only while its
              Advanced block is open; the desk's shared expander
              keeps its own open state, so the selected run here
              always carries the slider values on display (the
              page's own 70% defaults until the member moves
              one) — what the member sees is what runs. The
              Autopilot run above sends none, like the page's. */}
          <AdvancedExpander isLight={isLight} defaultOpen={false}>
            <div className="space-y-3">
              {selectedOps.map((op) => (
                <div key={op}>
                  <label className={`mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                    <span>{t(`photoEnhance.ops.${op}`)}</span>
                    <span>{strengths[op]}%</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={strengths[op]}
                    onChange={(e) => setStrengths((prev) => ({ ...prev, [op]: Number(e.target.value) }))}
                    className="w-full accent-amber-400"
                  />
                </div>
              ))}
              <p className={`text-[11px] ${muted}`}>{t("photoEnhance.advanced")}</p>
            </div>
          </AdvancedExpander>
          <div className="flex">
            <button
              type="button"
              data-testid="world-photo-enhance-run"
              onClick={() => void run(selectedOps, true)}
              disabled={state === "running" || selectedOps.length === 0}
              className={`${goldBtn} ml-auto`}
            >
              {state === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {state === "running" ? t("photoEnhance.enhancing") : t("photoEnhance.runSelected")}
            </button>
          </div>
        </>
      )}
      {state === "running" ? <NativeLoadingState isLight={isLight} message={t("photoEnhance.enhancing")} /> : null}
      {outOfCredits ? <OutOfBucsLine isLight={isLight} feature={t("photoEnhance.featureName")} /> : null}
      {state === "failed" && error ? (
        <NativeErrorState isLight={isLight} message={error} onRetry={() => void run(selectedOps, true)} />
      ) : null}
      {state === "done" && result ? (
        <div className="space-y-2">
          <ImageResult url={result.url} title={t("photoEnhance.after")} />
          <p className={`text-[11px] ${muted}`}>
            {t("photoEnhance.applied", { ops: result.operations.map((o) => t(`photoEnhance.ops.${o}`)).join(", ") })}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* ─── Headshot ───────────────────────────────────────────────── */

export function HeadshotBench({ isLight, photo }: { isLight: boolean; photo: DeskPhoto | null }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();
  const [flow, setFlow] = useState<HeadshotFlow>("autopilot");
  const [preset, setPreset] = useState<HeadshotPreset>("studio");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<HeadshotModel>("nano-banana-2.1");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [state, setState] = useState<RunState>("idle");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [providerDown, setProviderDown] = useState(false);
  const cost = headshotCost();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  async function run() {
    if (state === "running") return;
    if (flow === "manual" && !prompt.trim()) {
      setError(t("headshotStudio.errors.describeFirst"));
      setState("failed");
      return;
    }
    setState("running");
    setError(null);
    setOutOfCredits(false);
    setProviderDown(false);
    setResultUrl(null);
    try {
      const res = await confirmedFetch(HEADSHOT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildHeadshotPayload({ flow, preset, promptText: prompt, model, referenceImageUrl: referenceUrl }),
        ),
        overrideCost: cost,
        overrideFeature: t("headshotStudio.featureName", { defaultValue: "Headshot" }),
      });
      if (!res) {
        setState("idle");
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setState("idle");
        return;
      }
      const url = photoResultUrlOf(data);
      if (!res.ok || !url) {
        if (isHeadshotProviderDown(res.status, data)) {
          setProviderDown(true);
          setError(t("headshotStudio.errors.failed"));
        } else if (photoErrorCodeOf(data) === "out_of_credits") {
          setError(t("headshotStudio.errors.outOfCredits"));
        } else {
          setError(apiErrorMessage(data, t("headshotStudio.errors.failed")));
        }
        setState("failed");
        return;
      }
      setResultUrl(url);
      setState("done");
      try {
        addAsset({ kind: "image", url, label: "Headshot", detail: "Photo Desk · Headshot" });
      } catch { /* non-fatal */ }
    } catch (err) {
      setError(plainErrorText(err, t("headshotStudio.errors.failed")));
      setState("failed");
    }
  }

  return (
    <div className="space-y-3" data-testid="world-photo-headshot-bench">
      <BenchHead isLight={isLight} icon={Camera} title={t("headshotStudio.title")} cost={cost} />
      <div className="flex flex-wrap gap-1.5">
        {HEADSHOT_FLOWS.map((f) => (
          <button key={f} type="button" aria-pressed={flow === f} onClick={() => setFlow(f)} className={chipCls(isLight, flow === f)}>
            {t(`headshotStudio.flows.${f}`)}
          </button>
        ))}
      </div>
      {flow === "autopilot" ? <p className={`text-[11px] ${muted}`}>{t("headshotStudio.autopilot.blurb")}</p> : null}
      {flow === "preset" ? (
        <div className="grid grid-cols-2 gap-2">
          {HEADSHOT_PRESETS.map((p) => (
            <button key={p} type="button" aria-pressed={preset === p} onClick={() => setPreset(p)} className={chipCls(isLight, preset === p)}>
              <span className="block text-xs font-bold">{t(`headshotStudio.presetNames.${p}`)}</span>
              <span className={`mt-0.5 block text-[11px] ${muted}`}>{t(`headshotStudio.presets.${p}`)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {flow === "manual" ? (
        <DeskTextField
          isLight={isLight}
          label={t("headshotStudio.manualLabel")}
          value={prompt}
          onChange={setPrompt}
          placeholder={t("headshotStudio.manualPlaceholder")}
        />
      ) : null}
      <DeskTextField
        isLight={isLight}
        label={t("headshotStudio.refLabel")}
        value={referenceUrl}
        onChange={setReferenceUrl}
        placeholder={t("headshotStudio.refPlaceholder")}
      />
      {photo && referenceUrl !== photo.url ? (
        <button
          type="button"
          onClick={() => setReferenceUrl(photo.url)}
          className={`text-xs font-bold underline-offset-2 hover:underline ${muted}`}
        >
          {t("worldPhotoDesk.useDeskPhotoRef", { defaultValue: "Use the desk photo as the face reference" })}
        </button>
      ) : null}
      <DeskSelectField
        isLight={isLight}
        label={t("headshotStudio.modelLabel")}
        value={model}
        onChange={(v) => setModel(v as HeadshotModel)}
        options={HEADSHOT_MODELS.map((m) => ({
          value: m,
          label: m === "nano-banana-2.1" ? t("headshotStudio.models.nano") : t("headshotStudio.models.ideogram"),
        }))}
      />
      <div className="flex">
        <button type="button" data-testid="world-photo-headshot-run" onClick={() => void run()} disabled={state === "running"} className={`${goldBtn} ml-auto`}>
          {state === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {state === "running" ? t("headshotStudio.generating") : t("headshotStudio.generate")}
        </button>
      </div>
      {state === "running" ? <NativeLoadingState isLight={isLight} message={t("headshotStudio.generating")} /> : null}
      {outOfCredits ? <OutOfBucsLine isLight={isLight} feature={t("headshotStudio.featureName")} /> : null}
      {state === "failed" && error ? (
        providerDown ? (
          <NativeErrorState
            isLight={isLight}
            message={`${error} ${t("headshotStudio.errors.tryOtherEngine")}`}
            onRetry={() => {
              setProviderDown(false);
              setState("idle");
              setError(null);
            }}
          />
        ) : (
          <NativeErrorState isLight={isLight} message={error} onRetry={() => void run()} />
        )
      ) : null}
      {state === "done" && resultUrl ? <ImageResult url={resultUrl} title={t("headshotStudio.resultLabel")} /> : null}
    </div>
  );
}

/* ─── Product Photo ──────────────────────────────────────────── */

const PRODUCT_PRESET_KEYS: Record<ProductScenePreset, string> = {
  "studio-white": "studioWhite",
  "light-grey": "lightGrey",
  "infinity-white": "infinityWhite",
  "marble-luxe": "marbleLuxe",
  "street-style": "streetStyle",
  "golden-hour": "goldenHour",
  "cozy-home": "cozyHome",
};

export function ProductPhotoBench({
  isLight,
  photo,
  onUsePhoto,
}: {
  isLight: boolean;
  photo: DeskPhoto | null;
  onUsePhoto: (url: string) => void;
}) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();
  const [productUrl, setProductUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [kind, setKind] = useState<ProductKind>("other");
  const [shotType, setShotType] = useState<ProductShotType>("packshot");
  const [styleMode, setStyleMode] = useState<ProductStyleMode>("autopilot");
  const [scenePreset, setScenePreset] = useState<ProductScenePreset>("studio-white");
  const [customPrompt, setCustomPrompt] = useState("");
  const [model, setModel] = useState<ProductModel>("nano-banana-2.1");
  const [ratio, setRatio] = useState<ProductRatio>("1080:1080");
  const [state, setState] = useState<RunState>("idle");
  const [result, setResult] = useState<{ url: string; path: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const cost = productPhotoCost(shotType);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  function pickShot(next: ProductShotType) {
    setShotType(next);
    /* Keep the picked scene inside the new shot's family, the
       way the page's preset list swaps with the shot type. */
    if (!productScenePresets(next).includes(scenePreset)) {
      setScenePreset(productScenePresets(next)[0]);
    }
  }

  async function run() {
    if (state === "running") return;
    if (!productUrl.trim()) {
      setError(t("productPhotoStudio.errorNoProduct"));
      setState("failed");
      return;
    }
    if (styleMode === "custom" && !customPrompt.trim()) {
      setError(t("productPhotoStudio.errorNoPrompt"));
      setState("failed");
      return;
    }
    setState("running");
    setError(null);
    setOutOfCredits(false);
    setResult(null);
    try {
      const res = await confirmedFetch(PRODUCT_PHOTO_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildProductPhotoPayload({
            productImageUrl: productUrl,
            productName,
            productKind: kind,
            shotType,
            styleMode,
            scenePreset,
            customPrompt,
            model,
            ratio,
          }),
        ),
        overrideCost: cost,
        overrideFeature: t("productPhotoStudio.confirmFeature"),
      });
      if (!res) {
        setState("idle");
        return;
      }
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setState("idle");
        return;
      }
      const parsed = productPhotoResultOf(data);
      if (!res.ok || !parsed) {
        setError(
          photoErrorCodeOf(data) === "out_of_credits"
            ? t("productPhotoStudio.errorCredits")
            : apiErrorMessage(data, t("productPhotoStudio.errorFailed")),
        );
        setState("failed");
        return;
      }
      setResult(parsed);
      setState("done");
      try {
        addAsset({ kind: "image", url: parsed.url, label: "Product photo", detail: "Photo Desk · Product photo" });
      } catch { /* non-fatal */ }
    } catch (err) {
      setError(plainErrorText(err, t("productPhotoStudio.errorFailed")));
      setState("failed");
    }
  }

  return (
    <div className="space-y-3" data-testid="world-photo-product-bench">
      <BenchHead isLight={isLight} icon={Camera} title={t("productPhotoStudio.title")} cost={cost} />
      <DeskTextField
        isLight={isLight}
        label={t("productPhotoStudio.stepProduct")}
        value={productUrl}
        onChange={setProductUrl}
        placeholder={t("productPhotoStudio.pastePlaceholder")}
      />
      {photo && productUrl !== photo.url ? (
        <button
          type="button"
          onClick={() => setProductUrl(photo.url)}
          className={`text-xs font-bold underline-offset-2 hover:underline ${muted}`}
        >
          {t("worldPhotoDesk.useDeskPhotoProduct", { defaultValue: "Use the desk photo as the product" })}
        </button>
      ) : null}
      <input
        value={productName}
        onChange={(e) => setProductName(e.target.value)}
        placeholder={t("productPhotoStudio.namePlaceholder")}
        className={deskInputCls(isLight)}
      />
      <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        {t("productPhotoStudio.stepShot")}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(["packshot", "lifestyle"] as const).map((s) => (
          <button key={s} type="button" aria-pressed={shotType === s} onClick={() => pickShot(s)} className={chipCls(isLight, shotType === s)}>
            <span className="block text-xs font-bold">{t(`productPhotoStudio.${s}`)}</span>
            <span className={`mt-0.5 block text-[11px] ${muted}`}>{t(`productPhotoStudio.${s}Blurb`)}</span>
            <span className="mt-1 block text-[11px] font-bold">{productPhotoCost(s)} VB</span>
          </button>
        ))}
      </div>
      <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        {t("productPhotoStudio.stepStyle")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {PRODUCT_STYLE_MODES.map((m) => (
          <button key={m} type="button" aria-pressed={styleMode === m} onClick={() => setStyleMode(m)} className={chipCls(isLight, styleMode === m)}>
            {t(`productPhotoStudio.mode${m === "autopilot" ? "Autopilot" : m === "presets" ? "Presets" : "Custom"}`)}
          </button>
        ))}
      </div>
      {styleMode === "autopilot" ? (
        <DeskSelectField
          isLight={isLight}
          label={t("productPhotoStudio.kindLabel")}
          value={kind}
          onChange={(v) => setKind(v as ProductKind)}
          options={PRODUCT_KINDS.map((k) => ({ value: k, label: t(`productPhotoStudio.kind.${k}`) }))}
        />
      ) : null}
      {styleMode === "presets" ? (
        <div className="grid grid-cols-2 gap-2">
          {productScenePresets(shotType).map((p) => (
            <button key={p} type="button" aria-pressed={scenePreset === p} onClick={() => setScenePreset(p)} className={chipCls(isLight, scenePreset === p)}>
              <span className="block text-xs font-bold">{t(`productPhotoStudio.preset.${PRODUCT_PRESET_KEYS[p]}`)}</span>
              <span className={`mt-0.5 block text-[11px] ${muted}`}>{t(`productPhotoStudio.preset.${PRODUCT_PRESET_KEYS[p]}Blurb`)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {styleMode === "custom" ? (
        <DeskTextField
          isLight={isLight}
          label={t("productPhotoStudio.modeCustom")}
          value={customPrompt}
          onChange={setCustomPrompt}
          placeholder={t("productPhotoStudio.customPlaceholder")}
        />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <DeskSelectField
          isLight={isLight}
          label={t("productPhotoStudio.stepModel")}
          value={model}
          onChange={(v) => setModel(v as ProductModel)}
          options={PRODUCT_MODELS.map((m) => ({
            value: m,
            label: m === "nano-banana-2.1" ? t("productPhotoStudio.modelNano") : t("productPhotoStudio.modelIdeogram"),
          }))}
        />
        <DeskSelectField
          isLight={isLight}
          label={t("worldPhotoDesk.ratioLabel", { defaultValue: "Shape" })}
          value={ratio}
          onChange={(v) => setRatio(v as ProductRatio)}
          options={PRODUCT_RATIOS.map((r) => ({
            value: r,
            label: r === "1080:1080" ? t("productPhotoStudio.ratioSquare") : t("productPhotoStudio.ratioStory"),
          }))}
        />
      </div>
      <div className="flex">
        <button type="button" data-testid="world-photo-product-run" onClick={() => void run()} disabled={state === "running"} className={`${goldBtn} ml-auto`}>
          {state === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {state === "running" ? t("productPhotoStudio.generating") : t("productPhotoStudio.generate")}
        </button>
      </div>
      {state === "running" ? <NativeLoadingState isLight={isLight} message={t("productPhotoStudio.generating")} /> : null}
      {outOfCredits ? <OutOfBucsLine isLight={isLight} feature={t("productPhotoStudio.confirmFeature")} /> : null}
      {state === "failed" && error ? <NativeErrorState isLight={isLight} message={error} onRetry={() => void run()} /> : null}
      {state === "done" && result ? (
        <div className="space-y-2">
          <ImageResult url={result.url} title={t("productPhotoStudio.resultTitle")} />
          <button
            type="button"
            onClick={() => onUsePhoto(result.url)}
            className={`text-xs font-bold underline-offset-2 hover:underline ${muted}`}
          >
            {t("productPhotoStudio.usePhoto")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
