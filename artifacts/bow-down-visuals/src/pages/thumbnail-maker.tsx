import { useState, useRef } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MarketingBadge } from "@/components/MarketingBadge";
import {
  Image as ImageIcon,
  ArrowLeft,
  Loader2,
  Download,
  FlaskConical,
  Upload,
  X,
  Check,
  MonitorPlay,
  Smartphone,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useTranslation } from "react-i18next";

interface GeneratedImage {
  url: string;
  variation: number;
}

const STYLE_PRESETS = [
  {
    id: "bold-text-pop",
    nameKey: "thumbnailMaker.styleBoldTextPopName",
    descriptionKey: "thumbnailMaker.styleBoldTextPopDesc",
    emoji: "💥",
  },
  {
    id: "shocked-face",
    nameKey: "thumbnailMaker.styleShockedFaceName",
    descriptionKey: "thumbnailMaker.styleShockedFaceDesc",
    emoji: "😱",
  },
  {
    id: "before-after",
    nameKey: "thumbnailMaker.styleBeforeAfterName",
    descriptionKey: "thumbnailMaker.styleBeforeAfterDesc",
    emoji: "⚖️",
  },
  {
    id: "luxury",
    nameKey: "thumbnailMaker.styleLuxuryName",
    descriptionKey: "thumbnailMaker.styleLuxuryDesc",
    emoji: "👑",
  },
  {
    id: "gaming",
    nameKey: "thumbnailMaker.styleGamingName",
    descriptionKey: "thumbnailMaker.styleGamingDesc",
    emoji: "🎮",
  },
  {
    id: "vlog",
    nameKey: "thumbnailMaker.styleVlogName",
    descriptionKey: "thumbnailMaker.styleVlogDesc",
    emoji: "☀️",
  },
] as const;

const inputClass =
  "h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 " +
  "focus:border-primary/50 focus:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/25 " +
  "focus-visible:ring-offset-0 transition-colors rounded-xl";
const textareaClass =
  "bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 " +
  "focus:border-primary/50 focus:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/25 " +
  "focus-visible:ring-offset-0 transition-colors rounded-xl resize-none";

export function ThumbnailMakerModule() {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { addAsset } = useHubProject();
  const { confirmedFetch } = useConfirmedApi();
  const [prompt, setPrompt] = useState("");
  const [stylePreset, setStylePreset] = useState<string>("bold-text-pop");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [overlayText, setOverlayText] = useState("");
  const [facePhoto, setFacePhoto] = useState<File | null>(null);
  const [facePreview, setFacePreview] = useState<string | null>(null);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [progress, setProgress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFaceSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(t("thumbnailMaker.facePhotoImageError"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(t("thumbnailMaker.facePhotoSizeError"));
      return;
    }
    setFacePhoto(file);
    setFacePreview(URL.createObjectURL(file));
    setError(null);
  }

  function clearFacePhoto() {
    setFacePhoto(null);
    if (facePreview) URL.revokeObjectURL(facePreview);
    setFacePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onGenerate() {
    if (prompt.trim().length < 3) {
      setError(t("thumbnailMaker.promptRequiredError"));
      return;
    }
    setLoading(true);
    setImages([]);
    setSelected(null);
    setError(null);
    setOutOfCredits(false);
    setProgress(t("thumbnailMaker.progressDreaming"));

    try {
      const token = await getAccessToken();
      const form = new FormData();
      form.append("prompt", prompt.trim());
      form.append("stylePreset", stylePreset);
      form.append("aspectRatio", aspectRatio);
      if (overlayText.trim()) form.append("overlayText", overlayText.trim());
      if (facePhoto) form.append("facePhoto", facePhoto);

      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      setProgress(t("thumbnailMaker.progressRendering"));
      const res = await confirmedFetch("/api/thumbnail-generator", {
        method: "POST",
        headers,
        body: form,
      });
      if (!res) return;

      if (res.status === 402) {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error || t("thumbnailMaker.generationFailed"),
        );
      }

      const data = (await res.json()) as {
        images: GeneratedImage[];
        creditsRemaining?: number;
      };
      setImages(data.images ?? []);
      setSelected(data.images?.[0]?.variation ?? null);
      const first = data.images?.[0];
      if (first?.url) {
        addAsset({
          kind: "thumbnail",
          url: first.url,
          label: overlayText ? t("thumbnailMaker.thumbnailWithText", { text: overlayText }) : t("thumbnailMaker.thumbnailDefault"),
          detail: t("thumbnailMaker.variationDetail", { count: data.images.length, suffix: data.images.length === 1 ? "" : "s", aspectRatio }),
        });
      }
      refreshProfile();
      setTimeout(() => {
        document.getElementById("tg-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("thumbnailMaker.generationFailed"));
    } finally {
      setLoading(false);
      setProgress("");
    }
  }

  const selectedImage = images.find((i) => i.variation === selected) ?? images[0] ?? null;

  return (
    <>
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 md:p-8 space-y-8">
          {/* Prompt */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{t("thumbnailMaker.promptLabel")}</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("thumbnailMaker.promptPlaceholder")}
              className={textareaClass}
              style={{ minHeight: "96px" }}
            />
          </div>

          {/* Style presets */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{t("thumbnailMaker.stylePresetLabel")}</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {STYLE_PRESETS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStylePreset(s.id)}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    stylePreset === s.id
                      ? "border-primary/60 bg-primary/[0.08] shadow-[0_0_24px_rgba(212,175,55,0.15)]"
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                  }`}
                >
                  <div className="text-2xl mb-2">{s.emoji}</div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-bold text-white">{t(s.nameKey)}</p>
                    {stylePreset === s.id && <Check className="h-4 w-4 text-primary" />}
                  </div>
                  <p className="text-xs text-white/40 mt-1">{t(s.descriptionKey)}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Aspect ratio */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{t("thumbnailMaker.formatLabel")}</Label>
            <div className="grid grid-cols-2 gap-3 max-w-md">
              <button
                type="button"
                onClick={() => setAspectRatio("16:9")}
                className={`rounded-xl border p-4 flex items-center gap-3 transition-all ${
                  aspectRatio === "16:9"
                    ? "border-primary/60 bg-primary/[0.08]"
                    : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                }`}
              >
                <MonitorPlay className="h-6 w-6 text-primary shrink-0" />
                <div className="text-left">
                  <p className="text-sm font-bold text-white">{t("thumbnailMaker.landscapeLabel")}</p>
                  <p className="text-xs text-white/40">{t("thumbnailMaker.landscapeBlurb")}</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setAspectRatio("9:16")}
                className={`rounded-xl border p-4 flex items-center gap-3 transition-all ${
                  aspectRatio === "9:16"
                    ? "border-primary/60 bg-primary/[0.08]"
                    : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                }`}
              >
                <Smartphone className="h-6 w-6 text-primary shrink-0" />
                <div className="text-left">
                  <p className="text-sm font-bold text-white">{t("thumbnailMaker.portraitLabel")}</p>
                  <p className="text-xs text-white/40">{t("thumbnailMaker.portraitBlurb")}</p>
                </div>
              </button>
            </div>
          </div>

          {/* Overlay text + face photo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">
                {t("thumbnailMaker.headlineLabel")} <span className="text-white/25 font-normal normal-case tracking-normal">{t("thumbnailMaker.optionalNote")}</span>
              </Label>
              <Input
                value={overlayText}
                onChange={(e) => setOverlayText(e.target.value)}
                placeholder={t("thumbnailMaker.headlinePlaceholder")}
                className={inputClass}
                maxLength={80}
              />
              <p className="text-xs text-white/25">{t("thumbnailMaker.headlineHint")}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">
                {t("thumbnailMaker.faceLabel")} <span className="text-white/25 font-normal normal-case tracking-normal">{t("thumbnailMaker.identityLockNote")}</span>
              </Label>
              {facePreview ? (
                <div className="relative inline-block">
                  <img
                    src={facePreview}
                    alt={t("thumbnailMaker.faceAlt")}
                    className="h-24 w-24 rounded-xl object-cover border border-primary/40"
                  />
                  <button
                    type="button"
                    onClick={clearFacePhoto}
                    className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600"
                    aria-label={t("thumbnailMaker.removeFaceAria")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-[68px] rounded-xl border border-dashed border-white/15 bg-white/[0.02] flex items-center justify-center gap-2 text-sm text-white/40 hover:border-primary/40 hover:text-white/70 transition-colors"
                >
                  <Upload className="h-4 w-4" />{t("thumbnailMaker.uploadFace")}</button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFaceSelect}
              />
              <p className="text-xs text-white/25">{t("thumbnailMaker.faceHint")}</p>
            </div>
          </div>

          {/* Generate */}
          <div className="pt-2">
            <Button
              type="button"
              size="lg"
              disabled={loading || prompt.trim().length < 3}
              onClick={onGenerate}
              className="w-full sm:w-auto gold-glow font-bold text-base px-12 rounded-xl gap-3"
              style={{ height: "52px" }}
            >
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" /> {progress || t("thumbnailMaker.generatingFallback")}
                </>
              ) : (
                <>
                  <ImageIcon className="h-5 w-5" />{t("thumbnailMaker.generateButton")}</>
              )}
            </Button>
            <p className="text-white/25 text-xs mt-3">{t("thumbnailMaker.costNote")}</p>
          </div>
        </div>

        {outOfCredits && <OutOfCredits />}

        {error && (
          <div className="mt-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Results */}
        {images.length > 0 && (
          <div id="tg-results" className="mt-10">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h2 className="text-lg font-bold text-white">{t("thumbnailMaker.resultsTitle")}</h2>
              <Link href="/thumbnail-test">
                <Button variant="outline" size="sm" className="border-primary/30 bg-primary/[0.06] text-primary hover:bg-primary/[0.12] gap-2">
                  <FlaskConical className="h-4 w-4" />{t("thumbnailMaker.abTestButton")}</Button>
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {images.map((img) => (
                <button
                  key={img.variation}
                  type="button"
                  onClick={() => setSelected(img.variation)}
                  className={`relative rounded-2xl overflow-hidden border-2 transition-all text-left ${
                    selected === img.variation
                      ? "border-primary shadow-[0_0_32px_rgba(212,175,55,0.25)]"
                      : "border-white/[0.08] hover:border-white/25"
                  }`}
                >
                  <img
                    src={img.url}
                    alt={t("thumbnailMaker.variationAlt", { n: img.variation })}
                    className={`w-full object-cover ${aspectRatio === "16:9" ? "aspect-video" : "aspect-[9/16] max-h-[480px] mx-auto"}`}
                    loading="lazy"
                  />
                  <span className="absolute top-3 left-3 text-xs font-bold bg-black/70 text-white px-2.5 py-1 rounded-full border border-white/10">
                    {t("thumbnailMaker.variationBadge", { n: img.variation })}
                  </span>
                  {selected === img.variation && (
                    <span className="absolute top-3 right-3 h-7 w-7 rounded-full bg-primary text-black flex items-center justify-center">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                </button>
              ))}
            </div>

            {selectedImage && (
              <div className="mt-6 rounded-2xl border border-primary/25 bg-primary/[0.04] p-5 flex flex-wrap items-center justify-between gap-4">
                <p className="text-sm text-white/60">
                  <span className="text-primary font-bold">{t("thumbnailMaker.variationBadge", { n: selectedImage.variation })}</span> {t("thumbnailMaker.selectedSummary")}
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLightbox(selectedImage.url)}
                    className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                  >{t("thumbnailMaker.previewButton")}</Button>
                  <a href={selectedImage.url} download={`thumbnail-v${selectedImage.variation}.png`} target="_blank" rel="noreferrer">
                    <Button size="sm" className="gold-glow font-bold gap-2">
                      <Download className="h-4 w-4" />{t("thumbnailMaker.downloadButton")}</Button>
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20"
            onClick={() => setLightbox(null)}
            aria-label={t("thumbnailMaker.closePreviewAria")}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightbox}
            alt={t("thumbnailMaker.fullPreviewAlt")}
            className="max-h-[90vh] max-w-full rounded-xl border border-white/10"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

export default function ThumbnailMaker() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>
      <div className="relative z-10 max-w-4xl mx-auto px-5 md:px-8 py-10 md:py-14">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />{t("thumbnailMaker.backToDashboard")}</Link>

        <div className="mb-10">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
              <ImageIcon className="h-5 w-5 text-primary" />
            </div>
            <MarketingBadge variant="muted">{t("thumbnailMaker.costBadge")}</MarketingBadge>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-3">{t("thumbnailMaker.pageTitle")}</h1>
          <p className="text-white/50 text-lg max-w-2xl">{t("thumbnailMaker.pageSubtitle")}</p>
        </div>

        <ThumbnailMakerModule />
      </div>
    </div>
  );
}
