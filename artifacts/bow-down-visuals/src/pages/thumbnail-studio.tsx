import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
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
  Clapperboard,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import type { HubAsset } from "@/lib/hub-project";
import { AttributionToggle } from "@/components/AttributionToggle";
import { ProjectFlowBar } from "@/components/hub/ProjectFlowBar";
import { AssetHandoffs } from "@/components/hub/AssetHandoffs";
import { OutOfCredits } from "@/components/OutOfCredits";
import { GenerationResult } from "@/components/GenerationResult";
import { ArtistVaultSelector, type ArtistVault } from "@/components/ArtistVaultSelector";
import { vaultToPayload } from "@/lib/prompt-improve";
import { callGenerateApi } from "@/lib/generate-api";
import { useTranslation } from "react-i18next";
import { getThumbnailTemplate } from "@/data/thumbnail-templates";
import { PublishToShowcase } from "@/components/PublishToShowcase";

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

/* ── Single-shot artwork mode (merged from /thumbnail) ───────────────────
   The legacy 1-credit single-shot generator: POST /api/generate-thumbnail
   (registry: "/api/generate-thumbnail" = 100 = 1 Visual Buc) with platform
   presets, art-style / mood pickers and an Artist Vault tie-in. Preserved
   here as the "Artwork" mode so the 1-credit path is never lost. */

interface SingleShotFormValues {
  artistName: string;
  songTitle: string;
  platform: string;
  artStyle: string;
  colorTheme: string;
  mood: string;
  featuredText: string;
  specialRequests: string;
}

const SS_PLATFORMS = [
  { value: "YouTube", labelKey: "thumbnail.platformYouTube" },
  { value: "Spotify", labelKey: "thumbnail.platformSpotify" },
  { value: "Apple Music", labelKey: "thumbnail.platformAppleMusic" },
  { value: "SoundCloud", labelKey: "thumbnail.platformSoundCloud" },
  { value: "All Platforms", labelKey: "thumbnail.platformAll" },
];
const SS_ART_STYLES = [
  { value: "Photo-Realistic", labelKey: "thumbnail.artStylePhotoRealistic" },
  { value: "Illustrated", labelKey: "thumbnail.artStyleIllustrated" },
  { value: "Minimalist", labelKey: "thumbnail.artStyleMinimalist" },
  { value: "Bold Graphic", labelKey: "thumbnail.artStyleBoldGraphic" },
  { value: "Vintage", labelKey: "thumbnail.artStyleVintage" },
  { value: "Futuristic", labelKey: "thumbnail.artStyleFuturistic" },
  { value: "Cinematic Dark", labelKey: "thumbnail.artStyleCinematicDark" },
  { value: "Street Art", labelKey: "thumbnail.artStyleStreetArt" },
  { value: "Anime", labelKey: "thumbnail.artStyleAnime" },
  { value: "3D Render", labelKey: "thumbnail.artStyle3DRender" },
];
const SS_MOODS = [
  { value: "Luxury", labelKey: "thumbnail.moodLuxury" },
  { value: "Dark", labelKey: "thumbnail.moodDark" },
  { value: "Emotional", labelKey: "thumbnail.moodEmotional" },
  { value: "Street", labelKey: "thumbnail.moodStreet" },
  { value: "Romantic", labelKey: "thumbnail.moodRomantic" },
  { value: "Energetic", labelKey: "thumbnail.moodEnergetic" },
  { value: "Pain", labelKey: "thumbnail.moodPain" },
  { value: "Victory", labelKey: "thumbnail.moodVictory" },
  { value: "Party", labelKey: "thumbnail.moodParty" },
  { value: "Inspirational", labelKey: "thumbnail.moodInspirational" },
  { value: "Funny", labelKey: "thumbnail.moodFunny" },
  { value: "Kid-Friendly", labelKey: "thumbnail.moodKidFriendly" },
];

const ssSelectClass =
  "h-11 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 text-sm " +
  "focus:outline-none focus:border-primary/50 focus:bg-white/[0.06] focus-visible:ring-2 " +
  "focus-visible:ring-primary/25 focus-visible:ring-offset-0 transition-colors appearance-none cursor-pointer";

function SSStyledSelect({ name, placeholder, options, value, onChange }: {
  name: string; placeholder: string; options: { value: string; labelKey: string }[]; value: string; onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <select name={name} value={value} onChange={(e) => onChange(e.target.value)}
        className={ssSelectClass} style={{ colorScheme: "dark" }}>
        <option value="" disabled style={{ background: "#111" }}>{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value} style={{ background: "#111" }}>{t(o.labelKey)}</option>)}
      </select>
      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 rotate-90 pointer-events-none" />
    </div>
  );
}

function SingleShotCoverArt() {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [thumbnailImageUrl, setThumbnailImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [creditsUsed, setCreditsUsed] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [loadedVault, setLoadedVault] = useState<ArtistVault | null>(null);
  const [recentThumbs, setRecentThumbs] = useState<Array<{ id: string; thumbnail_url: string | null; song_title: string | null }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch("/api/thumbnails", { headers });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setRecentThumbs((data.thumbnails ?? []).slice(0, 8));
      } catch {
        /* Library strip is a nicety — never block the maker on it. */
      }
    })();
    return () => { cancelled = true; };
  }, [getAccessToken, thumbnailImageUrl]);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<SingleShotFormValues>({
    defaultValues: { artistName: "", songTitle: "", platform: "", artStyle: "", colorTheme: "", mood: "", featuredText: "", specialRequests: "" },
  });
  const watched = watch();

  function handleVaultLoad(vault: ArtistVault) {
    if (!watched.artistName) setValue("artistName", vault.artist_name);
    if (!watched.artStyle && vault.visual_style) setValue("artStyle", vault.visual_style);
    if (!watched.colorTheme && vault.brand_colors) setValue("colorTheme", vault.brand_colors);
    setLoadedVault(vault);
  }

  async function onSubmit(values: SingleShotFormValues) {
    setLoading(true);
    setRawResult(null);
    setThumbnailImageUrl(null);
    setImageError(null);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const result = await callGenerateApi("/api/generate-thumbnail", {
        artistName: values.artistName,
        songTitle: values.songTitle,
        platform: values.platform,
        artStyle: values.artStyle,
        colorTheme: values.colorTheme,
        mood: values.mood,
        featuredText: values.featuredText,
        requests: values.specialRequests,
        artistVault: loadedVault ? vaultToPayload(loadedVault) : null,
      }, token, confirmedFetch);
      if (!result) return; // user cancelled the credit confirmation
      const { rawResult, creditsRemaining, creditsUsed: used, thumbnailImageUrl: imageUrl, imageError: imgErr } = result;
      setRawResult(rawResult);
      setThumbnailImageUrl(imageUrl ?? null);
      setImageError(imgErr ?? null);
      if (used !== undefined) setCreditsUsed(used);
      if (creditsRemaining !== undefined) refreshProfile();
      setTimeout(() => {
        document.getElementById("ss-thumb-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("thumbnail.generationFailed");
      if (msg === "out_of_credits") { setOutOfCredits(true); refreshProfile(); }
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2.5">
        <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
          <ImageIcon className="h-5 w-5 text-primary" />
        </div>
        <MarketingBadge variant="muted">{t("thumbnail.costBadge")}</MarketingBadge>
      </div>

      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 md:p-8">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
          <div data-min-stars="2">
            <ArtistVaultSelector onLoad={handleVaultLoad} loadedVaultId={loadedVault?.id} context="thumbnail" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{t("thumbnail.artistNameLabel")}</Label>
              <Input {...register("artistName", { required: true })} placeholder={t("thumbnail.artistNamePlaceholder")} className={inputClass + (errors.artistName ? " border-red-500/50" : "")} />
              {errors.artistName && <p className="text-red-400 text-xs">{t("thumbnail.requiredError")}</p>}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{t("thumbnail.songTitleLabel")}</Label>
              <Input {...register("songTitle")} placeholder={t("thumbnail.songTitlePlaceholder")} className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5" data-min-stars="2">
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{t("thumbnail.platformLabel")}</Label>
              <SSStyledSelect name="platform" placeholder={t("thumbnail.selectPlatform")} options={SS_PLATFORMS} value={watched.platform} onChange={(v) => setValue("platform", v)} />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{t("thumbnail.artStyleLabel")}</Label>
              <SSStyledSelect name="artStyle" placeholder={t("thumbnail.selectStyle")} options={SS_ART_STYLES} value={watched.artStyle} onChange={(v) => setValue("artStyle", v)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5" data-min-stars="2">
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{t("thumbnail.colorThemeLabel")}</Label>
              <Input {...register("colorTheme")} placeholder={t("thumbnail.colorThemePlaceholder")} className={inputClass} />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{t("thumbnail.moodLabel")}</Label>
              <SSStyledSelect name="mood" placeholder={t("thumbnail.selectMood")} options={SS_MOODS} value={watched.mood} onChange={(v) => setValue("mood", v)} />
            </div>
          </div>
          <div className="space-y-2" data-min-stars="3">
            <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{t("thumbnail.featuredTextLabel")}<span className="text-white/25 font-normal normal-case tracking-normal">{t("thumbnail.optionalNote")}</span></Label>
            <Input {...register("featuredText")} placeholder={t("thumbnail.featuredTextPlaceholder")} className={inputClass} />
          </div>
          <div className="space-y-2" data-min-stars="4">
            <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{t("thumbnail.specialRequestsLabel")}<span className="text-white/25 font-normal normal-case tracking-normal">{t("thumbnail.optionalNote")}</span></Label>
            <Textarea {...register("specialRequests")} placeholder={t("thumbnail.specialRequestsPlaceholder")} className={textareaClass} style={{ minHeight: "100px" }} />
          </div>
          <div className="pt-2">
            <Button type="submit" size="lg" disabled={loading} className="w-full sm:w-auto gold-glow font-bold text-base px-12 rounded-xl gap-3" style={{ height: "52px" }}>
              {loading ? <><Loader2 className="h-5 w-5 animate-spin" />{t("thumbnail.buildingPack")}</> : <><ImageIcon className="h-5 w-5" />{t("thumbnail.generateButton")}</>}
            </Button>
            <p className="text-white/25 text-xs mt-3">{t("thumbnail.costNote")}</p>
          </div>
        </form>
      </div>

      {outOfCredits && <OutOfCredits />}

      {recentThumbs.length > 0 && (
        <div className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white">{t("thumbnail.recentTitle")}</h2>
            <Link href="/thumbnails" className="text-xs font-semibold text-primary hover:underline">{t("thumbnail.viewLibrary")}</Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {recentThumbs.map((thumb) => (
              <Link
                key={thumb.id}
                href="/thumbnails"
                className="shrink-0 w-44 rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden hover:border-primary/40 transition-colors"
              >
                {thumb.thumbnail_url ? (
                  <img src={thumb.thumbnail_url} alt={thumb.song_title ?? t("thumbnail.thumbnailFallback")} className="w-44 aspect-video object-cover" loading="lazy" />
                ) : (
                  <div className="w-44 aspect-video flex items-center justify-center bg-black/40">
                    <ImageIcon className="h-6 w-6 text-white/15" />
                  </div>
                )}
                <p className="px-2.5 py-2 text-xs text-white/60 truncate">{thumb.song_title ?? t("thumbnail.untitled")}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
          <p className="text-red-400 text-sm font-medium">{error}</p>
        </div>
      )}

      {rawResult && (
        <div id="ss-thumb-result">
          {thumbnailImageUrl ? (
            <div className="mb-6 rounded-2xl border border-primary/25 bg-primary/[0.04] p-5">
              <p className="text-xs font-bold tracking-widest text-primary uppercase mb-3">{t("thumbnail.generatedHeading")}</p>
              <img
                src={thumbnailImageUrl}
                alt={t("thumbnail.generatedAlt")}
                className="w-full rounded-xl border border-white/10"
                data-testid="img-generated-thumbnail"
              />
              <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
                <div className="flex gap-3 flex-wrap">
                  <Link href="/video-studio">
                    <Button variant="outline" size="sm" className="border-primary/30 bg-primary/[0.06] text-primary hover:bg-primary/[0.12] gap-2">
                      <Clapperboard className="h-4 w-4" />{t("thumbnailMaker.sendToVideoStudio")}</Button>
                  </Link>
                  <Link href="/thumbnails">
                    <Button variant="outline" size="sm" className="border-white/10 bg-white/5 text-white hover:bg-white/10">{t("thumbnail.viewLibrary")}</Button>
                  </Link>
                </div>
                <a href={thumbnailImageUrl} download="thumbnail.png" target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm" className="border-white/10 bg-white/5 text-white hover:bg-white/10">{t("thumbnail.downloadImage")}</Button>
                </a>
              </div>
            </div>
          ) : imageError && (
            <div className="mb-6 p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5">
              <p className="text-yellow-400 text-sm font-medium">{t("thumbnail.imageRenderFailed", { error: imageError })}</p>
            </div>
          )}
          <GenerationResult
            result={rawResult}
            onReset={() => { setRawResult(null); setThumbnailImageUrl(null); setImageError(null); setError(null); setOutOfCredits(false); }}
            saveMetadata={{
              projectType: "Thumbnail Maker",
              artistName: watched.artistName,
              songTitle: watched.songTitle,
              genre: "",
              mood: watched.mood,
              inputData: watched as unknown as Record<string, unknown>,
              creditsUsed,
              thumbnailImageUrl,
            }}
          />
        </div>
      )}
    </div>
  );
}

export function ThumbnailMakerModule() {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const { addAsset } = useHubProject();
  const { confirmedFetch } = useConfirmedApi();  const [mode, setMode] = useState<"simple" | "custom" | "artwork">("simple");
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
  /* Virality: opt-in "Made with Bow Down Visuals" corner credit (paid export → opt-in). */
  const [attribution, setAttribution] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Wave 8: AI Thumbnail A/B Tester — two AI alternates of the generated look. */
  const [abVariants, setAbVariants] = useState<Array<{ url: string; label: string; prompt: string }>>([]);
  const [abLoading, setAbLoading] = useState(false);
  const [abError, setAbError] = useState<string | null>(null);
  const [winnerUrl, setWinnerUrl] = useState<string | null>(null);

  async function onTestVariants() {
    const source = selectedImage?.url ?? images[0]?.url;
    if (!source) return;
    setAbLoading(true);
    setAbError(null);
    setWinnerUrl(null);
    try {
      const res = await confirmedFetch("/api/wave8/thumbnail-ab/variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceImageUrl: source,
          title: (overlayText || prompt).slice(0, 200),
          niche: stylePreset,
        }),
      });
      if (!res) {
        setAbError(t("wave8.thumbnailAb.errorCancelled"));
        return;
      }
      if (res.status === 402) {
        setAbError(t("wave8.thumbnailAb.errorOutOfCredits"));
        return;
      }
      if (!res.ok) throw new Error("variant generation failed");
      const data = (await res.json()) as { variants?: Array<{ url: string; label: string; prompt: string }> };
      setAbVariants(data.variants ?? []);
      refreshProfile();
    } catch {
      setAbError(t("wave8.thumbnailAb.errorFailed"));
    } finally {
      setAbLoading(false);
    }
  }

  function pickWinner(url: string) {
    setWinnerUrl(url);
    /* Handoff into the video packaging flow — read back by Video Studio. */
    try {
      localStorage.setItem("wave8_thumbnail_winner", url);
    } catch {
      /* storage unavailable — winner still rendered on screen */
    }
  }

  /* Spine: pull the project's song/video in — the song title becomes overlay
     text, the video's prompt seeds the art direction. No re-typing. */
  function handleProjectPick(asset: HubAsset) {
    if (asset.kind === "song") {
      const title = asset.meta?.["title"] ?? asset.label;
      if (!overlayText.trim()) setOverlayText(title.slice(0, 60));
      if (!prompt.trim()) setPrompt(`YouTube thumbnail art for the song "${title}" — bold, eye-catching, gold luxury style`);
    } else if (asset.kind === "video" || asset.kind === "clip") {
      const p = asset.meta?.["prompt"];
      if (p && !prompt.trim()) setPrompt(`YouTube thumbnail inspired by: ${p.slice(0, 200)}`);
    }
  }

  /* One-click presets for Simple mode */
  const SIMPLE_PRESETS = [
    { label: "🔥 Viral YouTube", prompt: "eye-catching YouTube thumbnail with bold text and shocked expression", style: "bold-text-pop", ratio: "16:9" as const },
    { label: "😱 Shock Face", prompt: "shocked face thumbnail with dramatic lighting", style: "shocked-face", ratio: "16:9" as const },
    { label: "⚡ Shorts Cover", prompt: "vertical short-form thumbnail with bold text", style: "bold-text-pop", ratio: "9:16" as const },
    { label: "💎 Luxury", prompt: "luxury gold thumbnail with premium aesthetic", style: "luxury", ratio: "16:9" as const },
    { label: "🎮 Gaming", prompt: "epic gaming thumbnail with action scene", style: "gaming", ratio: "16:9" as const },
    { label: "📹 Vlog", prompt: "casual vlog thumbnail with friendly vibe", style: "vlog", ratio: "16:9" as const },
  ];

  /* Template deep-link: ?template=<slug> preloads prompt, style, ratio + text.
     Used by the public template gallery (/templates/thumbnails).
     Video deep-link: ?video=<url> attaches a video as thumbnail reference
     (used by the caption suite's "Make a thumbnail" handoff) — seeds the
     prompt and shows a reference badge. */
  const [videoRef, setVideoRef] = useState<string | null>(null);
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const video = params.get("video");
      if (video) {
        setVideoRef(video);
        if (!prompt.trim()) {
          setPrompt("Eye-catching YouTube thumbnail inspired by the attached video — bold text, high contrast, gold luxury style");
        }
      }
      const slug = params.get("template");
      if (!slug) return;
      const tpl = getThumbnailTemplate(slug);
      if (!tpl) return;
      setPrompt(tpl.prompt);
      setStylePreset(tpl.stylePreset);
      setAspectRatio(tpl.aspectRatio);
      setOverlayText(tpl.overlayText);
    } catch {
      /* non-browser or malformed URL — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      /* Virality: opt-in attribution credit (FormData → "true"/"false" string; server coerces). */
      form.append("attribution", attribution ? "true" : "false");

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
      <ProjectFlowBar
        kinds={["song", "video", "clip"]}
        actionLabel={t("hubSpine.flowBar.useSongInVideo")}
        onPick={handleProjectPick}
      />
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 md:p-8 space-y-8">
          {/* Video reference badge (?video= deep-link from caption suite) */}
          {videoRef && (
            <div className="flex items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
              <span aria-hidden>🎬</span>
              <span className="flex-1 truncate">
                {t("thumbnailMaker.videoReferenceAttached")} — {videoRef}
              </span>
              <button
                type="button"
                onClick={() => setVideoRef(null)}
                className="shrink-0 rounded-lg px-2 py-1 text-amber-300/70 hover:text-amber-200 hover:bg-white/10"
                aria-label={t("thumbnailMaker.removeVideoReference")}
              >
                ✕
              </button>
            </div>
          )}
          {/* Simple / Custom / Artwork toggle — "Artwork" is the merged
              legacy single-shot 1-credit generator (POST /api/generate-thumbnail). */}
          <div className="flex gap-2 flex-wrap">
            {(
              [
                { id: "simple" as const, label: "Simple" },
                { id: "custom" as const, label: "Custom" },
                { id: "artwork" as const, label: t("thumbnailMaker.artworkModeLabel", { defaultValue: "Artwork Pack" }) },
              ]
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`px-5 py-2.5 rounded-xl font-medium transition-all ${
                  mode === m.id ? "bg-primary text-black" : "bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === "artwork" && <SingleShotCoverArt />}

          {mode === "simple" && (
            <div className="space-y-4">
              <p className="text-sm text-white/60">
                Pick a style — we'll handle the rest. One click, done.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {SIMPLE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setPrompt(preset.prompt);
                      setStylePreset(preset.style);
                      setAspectRatio(preset.ratio);
                    }}
                    className="p-4 rounded-xl border border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all text-center"
                  >
                    <span className="text-sm font-semibold text-white">{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === "custom" && (
          <div className="space-y-8">
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
            {/* Attribution — the virality playbook, opt-in for paid exports */}
            <div className="mb-3">
              <AttributionToggle checked={attribution} onChange={setAttribution} disabled={loading} />
            </div>
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
          )}
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
              <Link href={selectedImage ? `/thumbnail-studio?tab=abtest&test=${encodeURIComponent(selectedImage.url)}` : "/thumbnail-studio?tab=abtest"}>
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
                <div className="flex gap-3 flex-wrap">
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
                  {/* Spine reverse handoff: the thumbnail is already in the hub
                      project — Video Studio picks it up as an image reference. */}
                  <Link href="/video-studio">
                    <Button variant="outline" size="sm" className="border-primary/30 bg-primary/[0.06] text-primary hover:bg-primary/[0.12] gap-2">
                      <Clapperboard className="h-4 w-4" />{t("thumbnailMaker.sendToVideoStudio")}
                    </Button>
                  </Link>
                  <PublishToShowcase
                    mediaType="image"
                    mediaUrl={selectedImage.url}
                    defaultTitle={`Thumbnail v${selectedImage.variation}`}
                  />
                </div>
              </div>
            )}

            {selectedImage && (
              <div className="mt-6">
                <AssetHandoffs
                  asset={{
                    id: `thumb-${selectedImage.variation}-${Date.now().toString(36)}`,
                    kind: "thumbnail",
                    url: selectedImage.url,
                    label: overlayText || prompt.slice(0, 80) || "Thumbnail",
                    createdAt: Date.now(),
                    meta: { ...(overlayText ? { title: overlayText } : {}), prompt: prompt.slice(0, 300) },
                  }}
                  handoffs={["thumbnail-ab", "meme"]}
                  prompt={prompt}
                  overlayText={overlayText}
                />
              </div>
            )}

            {/* Wave 8: AI Thumbnail A/B Tester — docked right after results.
                Generates two alternates of the source thumbnail; the picked
                winner travels into the video packaging flow. */}
            <div id="wave8-thumbnail-ab" className="mt-10 rounded-2xl border border-primary/25 bg-black/60 p-5 md:p-6">
              <h3 className="text-lg font-bold text-white">{t("wave8.thumbnailAb.title")}</h3>
              <p className="text-sm text-white/50 mt-1">{t("wave8.thumbnailAb.subtitle")}</p>

              {abError && (
                <div className="mt-4 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
                  <p className="text-red-400 text-sm font-medium">{abError}</p>
                </div>
              )}

              {abVariants.length === 0 ? (
                <div className="mt-4">
                  <Button
                    type="button"
                    disabled={abLoading}
                    onClick={onTestVariants}
                    className="gold-glow font-bold px-10 rounded-xl gap-2"
                  >
                    {abLoading ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" /> {t("wave8.thumbnailAb.buttonBusy")}
                      </>
                    ) : (
                      <>
                        <FlaskConical className="h-5 w-5" /> {t("wave8.thumbnailAb.button")}
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-white/40 mt-4">{t("wave8.thumbnailAb.compareNote")}</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    <div className="rounded-2xl overflow-hidden border-2 border-white/[0.08] bg-white/[0.02]">
                      <img
                        src={selectedImage?.url ?? images[0]?.url}
                        alt={t("wave8.thumbnailAb.originalLabel")}
                        className={`w-full object-cover ${aspectRatio === "16:9" ? "aspect-video" : "aspect-[9/16] max-h-[320px] mx-auto"}`}
                        loading="lazy"
                      />
                      <p className="text-xs font-bold text-white/60 px-3 py-2.5">{t("wave8.thumbnailAb.originalLabel")}</p>
                    </div>
                    {abVariants.map((v, i) => (
                      <div
                        key={`${v.label}-${i}`}
                        className={`rounded-2xl overflow-hidden border-2 transition-all bg-white/[0.02] ${
                          winnerUrl === v.url
                            ? "border-primary shadow-[0_0_32px_rgba(212,175,55,0.25)]"
                            : "border-white/[0.08]"
                        }`}
                      >
                        <img
                          src={v.url}
                          alt={v.label}
                          className={`w-full object-cover ${aspectRatio === "16:9" ? "aspect-video" : "aspect-[9/16] max-h-[320px] mx-auto"}`}
                          loading="lazy"
                        />
                        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                          <p className="text-xs font-bold text-white/60">{v.label}</p>
                          {winnerUrl === v.url ? (
                            <span className="text-xs font-bold text-primary flex items-center gap-1">
                              <Check className="h-3.5 w-3.5" /> {t("wave8.thumbnailAb.winnerLabel")}
                            </span>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => pickWinner(v.url)}
                              className="border-primary/30 bg-primary/[0.06] text-primary hover:bg-primary/[0.12] text-xs"
                            >
                              {t("wave8.thumbnailAb.pickWinner")}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {winnerUrl && (
                    <div className="mt-4 rounded-2xl border border-primary/25 bg-primary/[0.04] p-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-white/60">
                        <span className="text-primary font-bold">{t("wave8.thumbnailAb.winnerLabel")}</span> — {t("wave8.thumbnailAb.winnerSaved")}
                      </p>
                      <Link href="/video-studio">
                        <Button variant="outline" size="sm" className="border-primary/30 bg-primary/[0.06] text-primary hover:bg-primary/[0.12] gap-2">
                          <Clapperboard className="h-4 w-4" /> {t("wave8.thumbnailAb.useInVideoPackaging")}
                        </Button>
                      </Link>
                    </div>
                  )}
                </>
              )}
            </div>
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

import { useCallback } from "react";
import {
  AlertTriangle, CheckCircle2, Trophy, Sparkles, RefreshCw, Wand2, Trash2, Calendar,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/hooks/use-page-title";
import { scoreBand, scoreBandClass, filterImageFiles } from "@/lib/thumbnail-test";

/* ─── Thumbnail A/B Tester ────────────────────────────────────────────────
   Upload 2-4 thumbnail variants, AI predicts which one gets the most clicks
   and explains why. 200 Visual Bucs per test (vision analysis — it burns GPU,
   so it charges). Honest framing throughout: this is a PREDICTION based on
   thumbnail best practices, not a guarantee of real click-through. */

const CREDIT_COST = 200;
const IMPROVE_COST = 200;
const MAX_FILES = 4;
const MIN_FILES = 2;

interface Scores {
  curiosityGap: number;
  readability: number;
  emotionalImpact: number;
  colorContrast: number;
  facePresence: number;
  overall: number;
}

interface Analysis {
  index: number;
  scores: Scores;
  strengths: string[];
  weaknesses: string[];
  tips: string[];
}

interface TestResult {
  analyses: Analysis[];
  winnerIndex: number;
  confidence: number;
  reasoning: string;
  disclaimer: string;
}

const SCORE_LABELS: Array<{ key: keyof Scores; labelKey: string }> = [
  { key: "curiosityGap", labelKey: "thumbnailTest.scoreCuriosity" },
  { key: "readability", labelKey: "thumbnailTest.scoreReadability" },
  { key: "emotionalImpact", labelKey: "thumbnailTest.scoreEmotion" },
  { key: "colorContrast", labelKey: "thumbnailTest.scoreContrast" },
  { key: "facePresence", labelKey: "thumbnailTest.scoreFace" },
];

function scoreColor(v: number): string {
  return scoreBandClass(scoreBand(v));
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-zinc-400">{label}</span>
        <span className="text-zinc-200 font-semibold tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full ${scoreColor(value)}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function ThumbnailAbTester() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { addAsset } = useHubProject();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [niche, setNiche] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [improving, setImproving] = useState<number | null>(null);
  const [improvedUrls, setImprovedUrls] = useState<Record<number, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Deep-link protocol: /thumbnail-test?test=<imageUrl> loads a thumbnail made
     in thumbnail-maker directly — no re-upload. */
  useEffect(() => {
    try {
      const testUrl = new URLSearchParams(window.location.search).get("test");
      if (!testUrl || files.length > 0) return;
      (async () => {
        try {
          const res = await fetch(testUrl);
          const blob = await res.blob();
          const f = new File([blob], "thumbnail.png", { type: blob.type || "image/png" });
          setFiles([f]);
          setPreviews([URL.createObjectURL(f)]);
          window.history.replaceState(null, "", window.location.pathname);
        } catch {
          setError(t("thumbnailTest.improveFailed"));
        }
      })();
    } catch { /* non-browser — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(list: FileList | File[]) {
    const combined = [...files, ...filterImageFiles(Array.from(list), MAX_FILES)].slice(0, MAX_FILES);
    setFiles(combined);
    setPreviews(combined.map((f) => URL.createObjectURL(f)));
    setResult(null);
    setError(null);
  }

  function removeFile(i: number) {
    const next = files.filter((_, idx) => idx !== i);
    setFiles(next);
    setPreviews(next.map((f) => URL.createObjectURL(f)));
    setResult(null);
  }

  async function runTest() {
    if (files.length < MIN_FILES || testing) return;
    setTesting(true);
    setError(null);
    setOutOfCredits(false);
    setResult(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("thumbnails", f));
      if (title.trim()) form.append("title", title.trim());
      if (niche.trim()) form.append("niche", niche.trim());
      const res = await fetch("/api/thumbnail-test", { method: "POST", body: form });
      const data = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) throw new Error(data.message || data.error || t("thumbnailTest.testFailed"));
      setResult(data.result as TestResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("thumbnailTest.testFailed"));
    } finally {
      setTesting(false);
    }
  }

  async function applySuggestions(index: number) {
    const analysis = result?.analyses[index];
    if (!analysis || improving !== null) return;
    setImproving(index);
    setError(null);
    try {
      const form = new FormData();
      form.append("thumbnail", files[index]!);
      form.append("tips", analysis.tips.join("\n"));
      const res = await fetch("/api/thumbnail-test/improve", { method: "POST", body: form });
      const data = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) throw new Error(data.message || data.error || t("thumbnailTest.improveFailedLong"));
      setImprovedUrls((prev) => ({ ...prev, [index]: data.imageUrl as string }));
      /* The improved winner flows into the hub project — scheduler picks it up. */
      if (data.imageUrl) {
        try { addAsset({ kind: "thumbnail", url: data.imageUrl as string, label: `Improved thumbnail${title ? ` — ${title}` : ""}`, detail: "A/B test winner" }); } catch { /* non-fatal */ }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("thumbnailTest.improveFailed"));
    } finally {
      setImproving(null);
    }
  }

  return (
    <div>
        <div className="flex items-center gap-3 mb-2">
          <Trophy className="w-7 h-7 text-amber-400" />
          <h2 className="text-2xl font-bold bg-gradient-to-r from-amber-200 via-amber-400 to-amber-200 bg-clip-text text-transparent">{t("thumbnailTest.pageTitle")}</h2>
        </div>
        <p className="text-zinc-400 max-w-2xl mb-8">{t("thumbnailTest.pageSubtitle")}<span className="text-zinc-500">{t("thumbnailTest.subtitleNote")}</span>
        </p>

        {outOfCredits && <OutOfCredits />}

        {/* Upload zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors mb-6 ${
            dragOver ? "border-amber-400 bg-amber-400/5" : "border-zinc-800 hover:border-zinc-700 bg-zinc-950"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
          />
          <Upload className="w-8 h-8 text-amber-400 mx-auto mb-3" />
          <p className="text-zinc-300 font-medium">{t("thumbnailTest.uploadCta")}</p>
          <p className="text-zinc-500 text-sm mt-1">{t("thumbnailTest.uploadFormats", { uploaded: files.length, max: MAX_FILES })}</p>
        </div>

        {/* Previews */}
        {previews.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {previews.map((src, i) => (
              <div key={i} className="relative rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950">
                <img src={src} alt={t("thumbnailTest.thumbnailAlt", { n: i + 1 })} className="w-full aspect-video object-cover" />
                <span className="absolute top-2 left-2 text-xs font-bold bg-black/70 text-amber-300 px-2 py-0.5 rounded">
                  {i + 1}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                  className="absolute top-2 right-2 p-1 rounded-full bg-black/70 text-zinc-300 hover:text-red-400"
                  aria-label={t("thumbnailTest.removeThumbnailAria", { n: i + 1 })}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Context inputs */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("thumbnailTest.titlePlaceholder")}
            maxLength={200}
            className="rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-3 text-sm placeholder:text-zinc-600 focus:border-amber-400/60 focus:outline-none"
          />
          <input
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder={t("thumbnailTest.nichePlaceholder")}
            maxLength={100}
            className="rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-3 text-sm placeholder:text-zinc-600 focus:border-amber-400/60 focus:outline-none"
          />
        </div>

        <button
          onClick={runTest}
          disabled={files.length < MIN_FILES || testing || !user}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-3 font-semibold text-black disabled:opacity-40 disabled:cursor-not-allowed hover:from-amber-400 hover:to-amber-500 transition-colors"
        >
          {testing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
          {testing ? t("thumbnailTest.analyzing") : t("thumbnailTest.runTestButton", { cost: CREDIT_COST })}
        </button>
        {!user && <p className="text-zinc-500 text-sm mt-2">{t("thumbnailTest.signInPrompt")}</p>}

        {error && (
          <div className="mt-6 flex items-start gap-2 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <section className="mt-10">
            <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-400/10 to-transparent p-6 mb-8">
              <div className="flex items-center gap-3 mb-2">
                <Trophy className="w-6 h-6 text-amber-400" />
                <h2 className="text-xl font-bold text-amber-200">
                  {t("thumbnailTest.predictedWinner", { n: result.winnerIndex + 1 })}
                </h2>
                <span className="text-xs font-semibold bg-amber-400/20 text-amber-300 px-2 py-1 rounded-full">
                  {t("thumbnailTest.confidence", { confidence: result.confidence })}
                </span>
              </div>
              <p className="text-zinc-300 text-sm">{result.reasoning}</p>
              <p className="text-zinc-500 text-xs mt-3 italic">{result.disclaimer}</p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {result.analyses.map((a) => {
                const isWinner = a.index === result.winnerIndex;
                return (
                  <div
                    key={a.index}
                    className={`rounded-2xl border p-5 bg-zinc-950 ${
                      isWinner ? "border-amber-400/50" : "border-zinc-800"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-zinc-200">{t("thumbnailTest.thumbnailAlt", { n: a.index + 1 })}</span>
                        {isWinner && (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-300">
                            <CheckCircle2 className="w-4 h-4" />{t("thumbnailTest.winnerBadge")}</span>
                        )}
                      </div>
                      <span className="text-2xl font-black text-amber-300 tabular-nums">{a.scores.overall}</span>
                    </div>
                    {previews[a.index] && (
                      <img
                        src={previews[a.index]}
                        alt={t("thumbnailTest.thumbnailAlt", { n: a.index + 1 })}
                        className="w-full aspect-video object-cover rounded-lg border border-zinc-800 mb-4"
                      />
                    )}
                    <div className="space-y-2.5 mb-4">
                      {SCORE_LABELS.map(({ key, labelKey }) => (
                        <ScoreBar key={key} label={t(labelKey)} value={a.scores[key]} />
                      ))}
                    </div>
                    {a.strengths.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-emerald-300 mb-1">{t("thumbnailTest.strengthsLabel")}</p>
                        <ul className="text-xs text-zinc-400 list-disc list-inside space-y-0.5">
                          {a.strengths.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {a.weaknesses.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-red-300 mb-1">{t("thumbnailTest.weaknessesLabel")}</p>
                        <ul className="text-xs text-zinc-400 list-disc list-inside space-y-0.5">
                          {a.weaknesses.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {a.tips.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-amber-300 mb-1">{t("thumbnailTest.fixesLabel")}</p>
                        <ul className="text-xs text-zinc-300 list-disc list-inside space-y-0.5">
                          {a.tips.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {improvedUrls[a.index] ? (
                      <div>
                        <p className="text-xs font-semibold text-emerald-300 mb-2">{t("thumbnailTest.improvedHeading")}</p>
                        <img
                          src={improvedUrls[a.index]}
                          alt={t("thumbnailTest.improvedAlt")}
                          className="w-full aspect-video object-cover rounded-lg border border-emerald-800 mb-2"
                        />
                        <a
                          href={improvedUrls[a.index]}
                          download={`thumbnail-${a.index + 1}-improved.png`}
                          className="inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200"
                        >{t("thumbnailTest.downloadLink")}</a>
                      </div>
                    ) : (
                      <button
                        onClick={() => applySuggestions(a.index)}
                        disabled={improving !== null}
                        className="inline-flex items-center gap-2 rounded-lg border border-amber-400/40 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-400/10 disabled:opacity-40 transition-colors"
                      >
                        {improving === a.index ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Wand2 className="w-4 h-4" />
                        )}
                        {improving === a.index ? t("thumbnailTest.generating") : t("thumbnailTest.applySuggestions", { cost: IMPROVE_COST })}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => { setResult(null); setImprovedUrls({}); }}
              className="mt-8 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200"
            >
              <RefreshCw className="w-4 h-4" />{t("thumbnailTest.testDifferent")}</button>
          </section>
        )}

        {/* How it works */}
        <section className="mt-12 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <h3 className="font-bold text-zinc-200 mb-3 flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-amber-400" />{t("thumbnailTest.howItWorks")}</h3>
          <ul className="text-sm text-zinc-400 space-y-2 list-disc list-inside">
            <li><span className="text-zinc-200">{t("thumbnailTest.scoreCuriosity")}</span> — {t("thumbnailTest.scoreCuriosityText")}</li>
            <li><span className="text-zinc-200">{t("thumbnailTest.scoreReadability")}</span> — {t("thumbnailTest.scoreReadabilityText")}</li>
            <li><span className="text-zinc-200">{t("thumbnailTest.scoreEmotion")}</span> — {t("thumbnailTest.scoreEmotionText")}</li>
            <li><span className="text-zinc-200">{t("thumbnailTest.scoreContrast")}</span> — {t("thumbnailTest.scoreContrastText")}</li>
            <li><span className="text-zinc-200">{t("thumbnailTest.scoreFace")}</span> — {t("thumbnailTest.scoreFaceText")}</li>
          </ul>
          <p className="text-xs text-zinc-500 mt-4">{t("thumbnailTest.costNote")}</p>
        </section>
    </div>
  );
}

interface LibraryThumbnail {
  id: string;
  thumbnail_url: string | null;
  artist_name: string | null;
  song_title: string | null;
  action_label: string | null;
  credits_used: number | null;
  created_at: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function ThumbnailLibrary({ onGoGenerate }: { onGoGenerate: () => void }) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const { project } = useHubProject();
  const [thumbnails, setThumbnails] = useState<LibraryThumbnail[]>([]);
  const [loading, setLoading] = useState(true);
  /* Hub thumbnails (from thumbnail-maker, repurpose, A/B tests) live alongside
     the saved library — one shelf, not two stores. */
  const hubThumbnails: LibraryThumbnail[] = (project.assets ?? [])
    .filter((a) => a.kind === "thumbnail")
    .map((a) => ({
      id: `hub-${a.id}`,
      thumbnail_url: a.url,
      artist_name: null,
      song_title: a.label,
      action_label: a.detail ?? null,
      credits_used: null,
      created_at: new Date(a.createdAt).toISOString(),
    }));
  const allThumbnails = [...hubThumbnails, ...thumbnails];
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<LibraryThumbnail | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/thumbnails", { headers });
      if (!res.ok) throw new Error(t("thumbnails.loadFailed"));
      const data = await res.json();
      setThumbnails(data.thumbnails ?? []);
    } catch {
      setError(t("thumbnails.loadError"));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/thumbnails/${id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error("Delete failed");
      setThumbnails((prev) => prev.filter((thumb) => thumb.id !== id));
      if (lightbox?.id === id) setLightbox(null);
      setConfirmDeleteId(null);
      toast({ title: t("thumbnails.removedToast") });
    } catch {
      toast({ title: t("thumbnails.deleteFailedToast"), variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
        <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight mb-2">{t("thumbnails.libraryTitle")}</h2>
            <p className="text-white/50 max-w-2xl">{t("thumbnails.librarySubtitle")}</p>
          </div>
          <Button onClick={onGoGenerate} className="gold-glow font-bold rounded-xl gap-2">
            <Sparkles className="h-4 w-4" />{t("thumbnails.makeThumbnail")}</Button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
          </div>
        )}

        {error && (
          <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        {!loading && !error && thumbnails.length === 0 && (
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-12 text-center">
            <ImageIcon className="h-10 w-10 text-white/20 mx-auto mb-4" />
            <p className="text-white/60 font-medium mb-2">{t("thumbnails.emptyTitle")}</p>
            <p className="text-white/30 text-sm mb-6">{t("thumbnails.emptyBody")}</p>
            <Button onClick={onGoGenerate} className="gold-glow font-bold rounded-xl">{t("thumbnails.openMaker")}</Button>
          </div>
        )}

        {!loading && !error && allThumbnails.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {allThumbnails.map((thumb) => (
              <div
                key={thumb.id}
                className="group rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden hover:border-primary/30 transition-colors"
              >
                <button
                  onClick={() => setLightbox(thumb)}
                  className="block w-full aspect-video bg-black/40 overflow-hidden cursor-pointer"
                  aria-label={t("thumbnails.viewFullSize", { title: thumb.song_title ?? t("thumbnails.defaultTitle") })}
                >
                  {thumb.thumbnail_url ? (
                    <img
                      src={thumb.thumbnail_url}
                      alt={thumb.action_label ?? t("thumbnails.generatedAlt")}
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="h-8 w-8 text-white/15" />
                    </div>
                  )}
                </button>
                <div className="p-4">
                  <p className="text-white font-semibold text-sm truncate">
                    {thumb.song_title ?? thumb.action_label ?? t("thumbnails.untitled")}
                  </p>
                  <p className="text-white/40 text-xs mt-1 flex items-center gap-1.5">
                    <Calendar className="h-3 w-3" /> {formatDate(thumb.created_at)}
                    {thumb.artist_name && <span className="text-white/25">· {thumb.artist_name}</span>}
                  </p>
                  <div className="flex items-center gap-2 mt-3">
                    {thumb.thumbnail_url && (
                      <a href={thumb.thumbnail_url} download target="_blank" rel="noreferrer">
                        <Button variant="outline" size="sm" className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-1.5">
                          <Download className="h-3.5 w-3.5" />{t("thumbnails.download")}</Button>
                      </a>
                    )}
                    {thumb.id.startsWith("hub-") ? (
                      <span className="ml-auto text-[11px] font-bold text-primary/70 px-2 py-1.5">{t("thumbnails.fromProject", { defaultValue: "From this project" })}</span>
                    ) : confirmDeleteId === thumb.id ? (
                      <span className="flex items-center gap-2 ml-auto">
                        <button
                          onClick={() => handleDelete(thumb.id)}
                          disabled={deletingId === thumb.id}
                          className="text-xs font-bold text-red-400 hover:text-red-300 px-2 py-1"
                        >
                          {deletingId === thumb.id ? t("thumbnails.removing") : t("thumbnails.confirmRemove")}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs text-white/40 hover:text-white px-2 py-1"
                        >{t("thumbnails.keep")}</button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(thumb.id)}
                        title={t("thumbnails.removeTitle")}
                        className="ml-auto flex items-center gap-1.5 text-xs text-white/35 hover:text-red-400 transition-colors px-2 py-1.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />{t("thumbnails.remove")}</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative max-w-5xl w-full rounded-2xl border border-white/10 bg-zinc-950 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLightbox(null)}
              className="absolute top-3 right-3 z-10 h-9 w-9 rounded-full bg-black/60 border border-white/10 flex items-center justify-center text-white/60 hover:text-white transition-colors"
              aria-label={t("thumbnails.closeAria")}
            >
              <X className="h-4 w-4" />
            </button>
            {lightbox.thumbnail_url && (
              <img
                src={lightbox.thumbnail_url}
                alt={lightbox.action_label ?? t("thumbnails.generatedAlt")}
                className="w-full max-h-[75vh] object-contain bg-black"
              />
            )}
            <div className="p-4 md:p-5 flex items-center gap-3 flex-wrap border-t border-white/[0.06]">
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm truncate">
                  {lightbox.song_title ?? lightbox.action_label ?? t("thumbnails.untitled")}
                </p>
                <p className="text-white/40 text-xs mt-0.5">
                  {formatDate(lightbox.created_at)}
                  {lightbox.artist_name && ` · ${lightbox.artist_name}`}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {lightbox.thumbnail_url && (
                  <a href={lightbox.thumbnail_url} download target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm" className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-1.5">
                      <Download className="h-3.5 w-3.5" />{t("thumbnails.download")}</Button>
                  </a>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(lightbox.id)}
                  disabled={deletingId === lightbox.id}
                  className="border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" /> {deletingId === lightbox.id ? t("thumbnails.removing") : t("thumbnails.remove")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* ─── Thumbnail Studio — one page, three tabs ─────────────────────────────
   Merged from thumbnail-maker.tsx (Generate, incl. the Wave 8 AI Thumbnail
   A/B Tester docked after results), thumbnail-test.tsx (A/B Test panel) and
   thumbnails.tsx (Library panel). Tab deep-links: ?tab=generate | abtest |
   library. The A/B Test panel keeps its ?test=<imageUrl> deep-link protocol
   (used by the Generate tab's "A/B Test" button). */

type StudioTabKey = "generate" | "abtest" | "library";

const STUDIO_TABS: StudioTabKey[] = ["generate", "abtest", "library"];

function studioTabLabel(t: (k: string, o?: Record<string, unknown>) => string, key: StudioTabKey): string {
  return t(`thumbnailStudio.tabs.${key}`, {
    defaultValue: key === "generate" ? "Generate" : key === "abtest" ? "A/B Test" : "Library",
  });
}

export default function ThumbnailStudio({ defaultTab, embedded }: { defaultTab?: StudioTabKey; embedded?: boolean } = {}) {
  const { t } = useTranslation();
  usePageTitle(
    t("thumbnailStudio.title", { defaultValue: "Thumbnail Studio" }),
    t("thumbnailStudio.subtitle", {
      defaultValue: "Generate scroll-stopping thumbnails, A/B test them with AI, and browse your library — all in one studio.",
    })
  );
  const [tab, setTab] = useState<StudioTabKey>(() => {
    try {
      const param = new URLSearchParams(window.location.search).get("tab");
      if (param === "generate" || param === "abtest" || param === "library") return param;
    } catch {
      /* non-browser — ignore */
    }
    return defaultTab ?? "generate";
  });

  function switchTab(next: StudioTabKey) {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* non-browser — ignore */
    }
  }

  return (
    <div className={embedded ? "text-white" : "min-h-screen bg-black text-white"}>
      {!embedded && (
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>
      )}
      <div className={embedded ? "" : "relative z-10 max-w-6xl mx-auto px-5 md:px-8 py-10 md:py-14"}>
        {/* Back link + hero (standalone page only; the shell provides them when embedded) */}
        {!embedded && (
        <>
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
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-3">
            {t("thumbnailStudio.title", { defaultValue: "Thumbnail Studio" })}
          </h1>
          <p className="text-white/50 text-lg max-w-2xl">
            {t("thumbnailStudio.subtitle", {
              defaultValue: "Generate scroll-stopping thumbnails, A/B test them with AI, and browse your library — all in one studio.",
            })}
          </p>
        </div>
        </>
        )}

        {/* tabs */}
        <div className="mb-8 flex gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5" role="tablist" aria-label={t("thumbnailStudio.tabs.aria", { defaultValue: "Thumbnail studio sections" })}>
          {STUDIO_TABS.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => switchTab(key)}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                tab === key
                  ? "bg-gradient-to-r from-amber-500 to-yellow-400 text-black"
                  : "text-white/50 hover:text-white"
              }`}
            >
              {studioTabLabel(t, key)}
            </button>
          ))}
        </div>

        {tab === "generate" && <ThumbnailMakerModule />}
        {tab === "abtest" && <ThumbnailAbTester />}
        {tab === "library" && <ThumbnailLibrary onGoGenerate={() => switchTab("generate")} />}
      </div>
    </div>
  );
}
