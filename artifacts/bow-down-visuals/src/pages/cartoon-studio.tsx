import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Clapperboard,
  ArrowLeft,
  Loader2,
  Download,
  Upload,
  X,
  Film,
  User,
  ImageIcon,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import { OutOfCredits } from "@/components/OutOfCredits";
import { usePageTitle } from "@/hooks/use-page-title";

type StudioTab = "video" | "characters" | "cartoonize";

const TABS: { key: StudioTab; icon: typeof Film }[] = [
  { key: "video", icon: Film },
  { key: "characters", icon: User },
  { key: "cartoonize", icon: ImageIcon },
];

/** Cartoon style presets — style direction appended to the generation prompt.
 *  No new providers: video goes through /api/generate-runway-clip, images
 *  through /api/generate-artist-image. */
const STYLE_PRESETS = [
  {
    id: "anime",
    nameKey: "cartoonStudio.styleAnimeName",
    direction:
      "vibrant anime style, cel-shaded, clean dynamic linework, Japanese animation aesthetic, expressive",
  },
  {
    id: "toon3d",
    nameKey: "cartoonStudio.style3dToonName",
    direction:
      "3D cartoon render style, stylized animated feature film look, soft volumetric lighting, smooth appealing shapes",
  },
  {
    id: "classic2d",
    nameKey: "cartoonStudio.styleClassic2dName",
    direction:
      "classic 2D hand-drawn cartoon style, vintage animation cel aesthetic, bold confident outlines, flat cheerful colors",
  },
  {
    id: "comic",
    nameKey: "cartoonStudio.styleComicName",
    direction:
      "comic book art style, bold ink outlines, halftone dot shading, dramatic cel shading, graphic novel look",
  },
] as const;

const VIDEO_COST = 400;
const IMAGE_COST = 200;

interface PollResult {
  status: string;
  url?: string | null;
  progress?: number;
  error?: string;
}

export default function CartoonStudio() {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  usePageTitle(t("cartoonStudio.pageTitle"), t("cartoonStudio.pageDescription"));

  const [tab, setTab] = useState<StudioTab>(() => {
    try {
      const param = new URLSearchParams(window.location.search).get("tab");
      if (param === "video" || param === "characters" || param === "cartoonize") return param;
    } catch {
      /* non-browser — ignore */
    }
    return "video";
  });

  function switchTab(next: StudioTab) {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* non-browser — ignore */
    }
  }

  // ── shared form state ──
  const [styleId, setStyleId] = useState<string>("anime");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<5 | 10>(5);
  const [aspect, setAspect] = useState<"16:9" | "9:16">("16:9");
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);

  // ── generation state ──
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const style = STYLE_PRESETS.find((s) => s.id === styleId) ?? STYLE_PRESETS[0];

  useEffect(() => () => stopPolling(), []);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function pollTask(url: string, onDone: (resultUrl: string) => void) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token ?? ""}` } });
        const data = (await res.json()) as PollResult;
        if (data.status === "succeeded" && data.url) {
          stopPolling();
          setBusy(false);
          setProgress(null);
          refreshProfile();
          onDone(data.url);
        } else if (data.status === "failed" || data.status === "cancelled") {
          stopPolling();
          setBusy(false);
          setProgress(null);
          setError(data.error ?? t("cartoonStudio.generationFailed"));
        } else {
          setProgress(typeof data.progress === "number" ? data.progress : null);
        }
      } catch {
        stopPolling();
        setBusy(false);
        setProgress(null);
        setError(t("cartoonStudio.networkError"));
      }
    }, 5000);
  }

  function resetResult() {
    setVideoUrl(null);
    setImageUrl(null);
    setError(null);
    setOutOfCredits(false);
    setProgress(null);
  }

  function handleOutOfCredits() {
    setOutOfCredits(true);
    setBusy(false);
    refreshProfile();
  }

  // ── Tab 1: cartoon video (existing Runway pipeline, 400 VB) ──
  async function generateVideo() {
    if (!prompt.trim() || busy) return;
    resetResult();
    setBusy(true);
    try {
      const token = await getAccessToken();
      const fullPrompt = `${prompt.trim()}, ${style.direction}`;
      const res = await confirmedFetch("/api/generate-runway-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          promptText: fullPrompt,
          negativePrompt: "photorealistic, live action, blurry, distorted",
          ratio: aspect === "9:16" ? "720:1280" : "1280:720",
          durationSec: duration,
        }),
        overrideCost: VIDEO_COST,
        overrideFeature: t("cartoonStudio.videoFeatureName"),
      });
      if (!res) {
        setBusy(false);
        return; // user cancelled the credit confirmation
      }
      if (res.status === 402) {
        handleOutOfCredits();
        return;
      }
      const data = (await res.json()) as { taskId?: string; error?: string };
      if (!res.ok || !data.taskId) throw new Error(data.error ?? t("cartoonStudio.generationFailed"));
      toast({ title: t("cartoonStudio.videoStarted"), description: t("cartoonStudio.videoStartedDesc") });
      await pollTask(`/api/generate-runway-clip/${data.taskId}`, (url) => setVideoUrl(url));
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : t("cartoonStudio.generationFailed"));
    }
  }

  // ── Tab 2: character sheet (existing image pipeline, 200 VB) ──
  async function generateCharacter() {
    if (!prompt.trim() || busy) return;
    resetResult();
    setBusy(true);
    try {
      const token = await getAccessToken();
      const fullPrompt =
        `Cartoon character design sheet, ${style.direction}. ` +
        `Character: ${prompt.trim()}. ` +
        `Show front view, side view, 3/4 view and two expressions, consistent design, clean light-grey studio background, model-sheet layout.`;
      const res = await confirmedFetch("/api/generate-artist-image", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ promptText: fullPrompt, model: "gen4_image", ratio: "1:1" }),
        overrideCost: IMAGE_COST,
        overrideFeature: t("cartoonStudio.characterFeatureName"),
      });
      if (!res) {
        setBusy(false);
        return;
      }
      if (res.status === 402) {
        handleOutOfCredits();
        return;
      }
      const data = (await res.json()) as { taskId?: string; error?: string };
      if (!res.ok || !data.taskId) throw new Error(data.error ?? t("cartoonStudio.generationFailed"));
      await pollTask(`/api/generate-artist-image/${data.taskId}`, (url) => setImageUrl(url));
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : t("cartoonStudio.generationFailed"));
    }
  }

  // ── Tab 3: cartoonize a photo (existing image pipeline, 200 VB) ──
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setUploadPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function cartoonizePhoto() {
    if (!uploadPreview || busy) return;
    resetResult();
    setBusy(true);
    try {
      const token = await getAccessToken();
      const fullPrompt =
        `Redraw the attached photo as a cartoon in ${style.direction}. ` +
        `Keep the same subject, pose, composition and likeness — only the art style changes. ` +
        `Clean bold cartoon finish, no photorealistic remnants.`;
      const res = await confirmedFetch("/api/generate-artist-image", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          promptText: fullPrompt,
          model: "gen4_image",
          referenceImageUrl: uploadPreview,
        }),
        overrideCost: IMAGE_COST,
        overrideFeature: t("cartoonStudio.cartoonizeFeatureName"),
      });
      if (!res) {
        setBusy(false);
        return;
      }
      if (res.status === 402) {
        handleOutOfCredits();
        return;
      }
      const data = (await res.json()) as { taskId?: string; error?: string };
      if (!res.ok || !data.taskId) throw new Error(data.error ?? t("cartoonStudio.generationFailed"));
      await pollTask(`/api/generate-artist-image/${data.taskId}`, (url) => setImageUrl(url));
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : t("cartoonStudio.generationFailed"));
    }
  }

  const canGenerateVideo = prompt.trim().length > 0 && !busy;
  const canGenerateCharacter = prompt.trim().length > 0 && !busy;
  const canCartoonize = !!uploadPreview && !busy;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>
      <div className="relative z-10 max-w-6xl mx-auto px-5 md:px-8 py-10 md:py-14">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          {t("cartoonStudio.backToDashboard")}
        </Link>

        <div className="mb-10">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
              <Clapperboard className="h-5 w-5 text-primary" />
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-bold">
              <Sparkles className="h-3.5 w-3.5" />
              {t("cartoonStudio.costBadge")}
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-3">
            {t("cartoonStudio.title")}
          </h1>
          <p className="text-white/50 text-lg max-w-2xl">{t("cartoonStudio.subtitle")}</p>
        </div>

        {/* tabs */}
        <div
          className="mb-8 flex gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5"
          role="tablist"
          aria-label={t("cartoonStudio.tabsAria")}
        >
          {TABS.map(({ key, icon: Icon }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => switchTab(key)}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition flex items-center justify-center gap-2 ${
                tab === key
                  ? "bg-primary/15 border border-primary/40 text-primary"
                  : "text-white/50 hover:text-white border border-transparent"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t(`cartoonStudio.tab${key[0].toUpperCase()}${key.slice(1)}`)}
            </button>
          ))}
        </div>

        {outOfCredits && (
          <div className="mb-6">
            <OutOfCredits />
          </div>
        )}

        {/* ── shared style preset picker ── */}
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2.5">
            {t("cartoonStudio.styleLabel")}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {STYLE_PRESETS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStyleId(s.id)}
                className={`rounded-xl border px-4 py-3 text-left text-sm font-bold transition ${
                  styleId === s.id
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white hover:border-white/25"
                }`}
              >
                {t(s.nameKey)}
              </button>
            ))}
          </div>
        </div>

        {/* ── TAB: cartoon video ── */}
        {tab === "video" && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-7">
            <label className="block text-xs font-bold uppercase tracking-widest text-white/40 mb-2">
              {t("cartoonStudio.promptLabel")}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder={t("cartoonStudio.videoPromptPlaceholder")}
              className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-primary/50 focus:outline-none resize-y mb-5"
            />

            <div className="flex flex-wrap gap-5 mb-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2">
                  {t("cartoonStudio.durationLabel")}
                </p>
                <div className="flex gap-2">
                  {[5, 10].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDuration(d as 5 | 10)}
                      className={`px-4 py-2 rounded-xl border text-sm font-bold transition ${
                        duration === d
                          ? "border-primary/60 bg-primary/15 text-primary"
                          : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white"
                      }`}
                    >
                      {d}s
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2">
                  {t("cartoonStudio.aspectLabel")}
                </p>
                <div className="flex gap-2">
                  {(["16:9", "9:16"] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAspect(a)}
                      className={`px-4 py-2 rounded-xl border text-sm font-bold transition ${
                        aspect === a
                          ? "border-primary/60 bg-primary/15 text-primary"
                          : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white"
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={generateVideo}
              disabled={!canGenerateVideo}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-black text-sm bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black hover:from-[#e0bc58] hover:to-[#a5853a] transition-all shadow-lg shadow-[#C9A84C]/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
              {busy
                ? t("cartoonStudio.generating")
                : t("cartoonStudio.generateVideo", { cost: VIDEO_COST })}
            </button>

            {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

            {videoUrl && (
              <div className="mt-6">
                <video
                  src={videoUrl}
                  controls
                  playsInline
                  className="w-full max-w-2xl rounded-xl border border-primary/25"
                />
                <a
                  href={videoUrl}
                  download="cartoon-video.mp4"
                  className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary/80"
                >
                  <Download className="h-4 w-4" /> {t("cartoonStudio.download")}
                </a>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: characters ── */}
        {tab === "characters" && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-7">
            <label className="block text-xs font-bold uppercase tracking-widest text-white/40 mb-2">
              {t("cartoonStudio.characterLabel")}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder={t("cartoonStudio.characterPlaceholder")}
              className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-primary/50 focus:outline-none resize-y mb-5"
            />

            <button
              type="button"
              onClick={generateCharacter}
              disabled={!canGenerateCharacter}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-black text-sm bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black hover:from-[#e0bc58] hover:to-[#a5853a] transition-all shadow-lg shadow-[#C9A84C]/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <User className="h-4 w-4" />}
              {busy
                ? t("cartoonStudio.generating")
                : t("cartoonStudio.generateCharacter", { cost: IMAGE_COST })}
            </button>

            {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

            {imageUrl && (
              <div className="mt-6">
                <img
                  src={imageUrl}
                  alt={t("cartoonStudio.characterResultAlt")}
                  className="w-full max-w-2xl rounded-xl border border-primary/25"
                />
                <a
                  href={imageUrl}
                  download="cartoon-character.png"
                  className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary/80"
                >
                  <Download className="h-4 w-4" /> {t("cartoonStudio.download")}
                </a>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: cartoonize ── */}
        {tab === "cartoonize" && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-7">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFile}
            />
            {!uploadPreview ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full rounded-xl border-2 border-dashed border-white/15 hover:border-primary/40 bg-white/[0.02] px-6 py-12 flex flex-col items-center gap-3 transition-colors"
              >
                <Upload className="h-8 w-8 text-white/30" />
                <span className="text-sm font-bold text-white/60">
                  {t("cartoonStudio.uploadPrompt")}
                </span>
              </button>
            ) : (
              <div className="mb-5">
                <div className="relative inline-block">
                  <img
                    src={uploadPreview}
                    alt={t("cartoonStudio.uploadPreviewAlt")}
                    className="max-w-xs rounded-xl border border-white/15"
                  />
                  <button
                    type="button"
                    onClick={() => setUploadPreview(null)}
                    className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-black border border-white/20 flex items-center justify-center text-white/70 hover:text-white"
                    aria-label={t("cartoonStudio.removePhoto")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={cartoonizePhoto}
              disabled={!canCartoonize}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-black text-sm bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black hover:from-[#e0bc58] hover:to-[#a5853a] transition-all shadow-lg shadow-[#C9A84C]/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImageIcon className="h-4 w-4" />
              )}
              {busy
                ? t("cartoonStudio.generating")
                : t("cartoonStudio.cartoonizeButton", { cost: IMAGE_COST })}
            </button>

            {busy && progress !== null && (
              <p className="mt-3 text-xs text-white/50">{Math.round(progress * 100)}%</p>
            )}
            {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

            {imageUrl && (
              <div className="mt-6">
                <img
                  src={imageUrl}
                  alt={t("cartoonStudio.cartoonizeResultAlt")}
                  className="w-full max-w-2xl rounded-xl border border-primary/25"
                />
                <a
                  href={imageUrl}
                  download="cartoonized.png"
                  className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary/80"
                >
                  <Download className="h-4 w-4" /> {t("cartoonStudio.download")}
                </a>
              </div>
            )}
          </div>
        )}

        {/* ── related (existing, not duplicated) ── */}
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-3">
            {t("cartoonStudio.alsoTry")}
          </p>
          <div className="flex flex-wrap gap-2.5">
            <Link
              href="/make-video"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-bold text-white/70 hover:text-white hover:border-primary/40 transition-colors"
            >
              <Film className="h-4 w-4 text-primary" />
              {t("cartoonStudio.alsoTryMusicVideo")}
            </Link>
            <Link
              href="/video-editor?tab=edit-recipes"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-bold text-white/70 hover:text-white hover:border-primary/40 transition-colors"
            >
              <Clapperboard className="h-4 w-4 text-primary" />
              {t("cartoonStudio.alsoTryEditRecipe")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
