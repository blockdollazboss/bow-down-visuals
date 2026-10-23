import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  Check, Crown, Download, Image as ImageIcon, Loader2, Monitor, Package,
  Palette, Smartphone, Sparkles, Store, Tablet, User, Video,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useToast } from "@/hooks/use-toast";
import { fetchAssetLibrary, libraryAssetsOfKind, type LibraryAsset } from "@/lib/asset-library";
import { fetchBrandKit, type BrandKit } from "@/lib/brand-kit";
import { fetchMyProfile, saveMyProfile } from "@/lib/artist-profiles";
import {
  THEME_PACK_PRESET_KEYS, buildThemeConfigFromPalette,
  extractPalette, wallpaperPresetByKey, wallpaperPresetsByKind, type WallpaperKind,
} from "@/lib/wallpapers";
import { KINGS_SET } from "@/lib/kings-set";

/* ─── Wallpapers, Screensavers & Themes desk ─────────────────────────────
   One desk, two homes: a panel on /create and a tab on /branding-kit.
   Pick or generate art (subject-led — the creator, their character or
   their product front and center), render it at exact device pixels,
   and turn it into a matched theme pack: phone wallpaper + lock screen
   + desktop wallpaper + a profile theme built from the art's palette.

   Branding is ON by default (owner law: everything is promotional) —
   branded renders are free and carry the creator's logo + name; turning
   branding off makes image renders clean at the site's clean-export
   price (400 Visual Bucs), stated on the switch before any spend.
   Screensaver loop renders are 400 Visual Bucs branded or clean.

   LOGO RULE (owner law): a logo is composited ONLY as the complete,
   intact artwork — never cropped, never sliced into parts, never
   redrawn. The desk passes logoUrl to the render endpoints untouched
   (no transformation params, no client-side re-render) and shows the
   full lockup with object-contain; compositing happens server-side
   under the same rule. Pinned by wallpapers-logo.test.ts. */

const GENERATE_COST = 100;
const CLEAN_RENDER_COST = 400;
const KIND_ICONS: Record<WallpaperKind, typeof Smartphone> = { phone: Smartphone, tablet: Tablet, desktop: Monitor };
const KIND_ORDER: WallpaperKind[] = ["phone", "tablet", "desktop"];

interface RenderedImage { url: string; presetKey: string; label: string; width: number; height: number }
interface PackState { phoneUrl: string; desktopUrl: string; palette: string[] }
interface ScreensaverResult { url: string; width: number; height: number; seconds: number; creditCost: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function WallpapersDesk() {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();

  /* Source */
  const [sourceTab, setSourceTab] = useState<"generate" | "myart" | "brand">("generate");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [artError, setArtError] = useState<string | null>(null);
  const [currentArt, setCurrentArt] = useState<string | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [brandKit, setBrandKit] = useState<BrandKit | null>(null);
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [branded, setBranded] = useState(true);
  const [useBrandPalette, setUseBrandPalette] = useState(false);

  /* Device render */
  const [presetKey, setPresetKey] = useState<string>(THEME_PACK_PRESET_KEYS.phone);
  const [renders, setRenders] = useState<RenderedImage[]>([]);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  /* Theme pack */
  const [pack, setPack] = useState<PackState | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [listTitle, setListTitle] = useState("");
  const [listPrice, setListPrice] = useState("0");
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [listedId, setListedId] = useState<string | null>(null);
  const [zipBusy, setZipBusy] = useState(false);

  /* Screensaver */
  const [videoPrompt, setVideoPrompt] = useState("");
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [ssPresetKey, setSsPresetKey] = useState<string>(THEME_PACK_PRESET_KEYS.desktop);
  const [ssBusy, setSsBusy] = useState(false);
  const [ssError, setSsError] = useState<string | null>(null);
  const [ssResult, setSsResult] = useState<ScreensaverResult | null>(null);
  const [slideshowBusy, setSlideshowBusy] = useState(false);
  const [livingId, setLivingId] = useState<string | null>(null);

  const brandName = brandKit?.brandName || profileName || undefined;
  const preset = wallpaperPresetByKey(presetKey);
  const imageAssets = libraryAssetsOfKind(assets, "image");
  const videoAssets = libraryAssetsOfKind(assets, "video");

  const loadAssets = useCallback(async () => {
    setAssetsLoading(true);
    setAssetsError(null);
    try {
      setAssets(await fetchAssetLibrary(getAccessToken));
    } catch {
      setAssetsError(t("wallpapers.libraryFailed", { defaultValue: "Your art library could not load. Try again in a moment." }));
    } finally {
      setAssetsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAccessToken]);

  useEffect(() => { void loadAssets(); }, [loadAssets]);

  useEffect(() => {
    let alive = true;
    setBrandLoading(true);
    fetchBrandKit(getAccessToken)
      .then((kit) => { if (alive) setBrandKit(kit); })
      .catch(() => { if (alive) setBrandError(t("wallpapers.brandFailed", { defaultValue: "Your brand kit could not load. Renders still work — branding just uses your profile name." })); })
      .finally(() => { if (alive) setBrandLoading(false); });
    fetchMyProfile()
      .then((p) => { if (alive) setProfileName(p?.display_name || null); })
      .catch(() => { /* the name is a fallback only — never block the desk */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAccessToken]);

  /* ── Generate art (subject-led) ────────────────────────────────────── */
  async function generateArt() {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setArtError(null);
    try {
      const ratio = preset.height >= preset.width ? "1080:1920" : "1920:1080";
      const res = await confirmedFetch("/api/generate-artist-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptText: prompt.trim(), model: "nano-banana-2.1", ratio }),
        overrideCost: GENERATE_COST,
        overrideFeature: "Generate Artist Image (Turbo)",
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as {
        status?: string; url?: string | null; taskId?: string; error?: string; message?: string;
      };
      if (!res.ok) throw new Error(data.message ?? data.error ?? t("wallpapers.generateFailed", { defaultValue: "Generation failed. Visual Bucs were not charged." }));
      if (data.status === "succeeded" && data.url) {
        setCurrentArt(data.url);
        refreshProfile();
        void loadAssets();
        return;
      }
      if (!data.taskId) throw new Error(t("wallpapers.generateFailed", { defaultValue: "Generation failed. Visual Bucs were not charged." }));
      /* Async rail — poll the task until it lands. */
      const token = await getAccessToken();
      for (let i = 0; i < 60; i++) {
        await sleep(3000);
        const poll = await fetch(`/api/generate-artist-image/${data.taskId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const pdata = (await poll.json().catch(() => ({}))) as { status?: string; url?: string | null; error?: string };
        if (pdata.status === "succeeded" && pdata.url) {
          setCurrentArt(pdata.url);
          refreshProfile();
          void loadAssets();
          return;
        }
        if (pdata.status === "failed" || pdata.status === "cancelled") {
          throw new Error(pdata.error ?? t("wallpapers.generateFailed", { defaultValue: "Generation failed. Visual Bucs were not charged." }));
        }
      }
      throw new Error(t("wallpapers.generateFailed", { defaultValue: "Generation failed. Visual Bucs were not charged." }));
    } catch (e) {
      setArtError(e instanceof Error ? e.message : t("wallpapers.generateFailed", { defaultValue: "Generation failed. Visual Bucs were not charged." }));
    } finally {
      setGenerating(false);
    }
  }

  /* ── Exact-size render (branded free / clean 400) ──────────────────── */
  async function renderOne(targetPresetKey: string, sourceUrl: string): Promise<RenderedImage | null> {
    const target = wallpaperPresetByKey(targetPresetKey);
    const res = await confirmedFetch("/api/wallpapers/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUrl,
        presetKey: targetPresetKey,
        branded,
        ...(branded ? { logoUrl: brandKit?.logoUrl ?? undefined, brandName } : {}),
      }),
      ...(branded
        ? { skipConfirm: true }
        : { overrideCost: CLEAN_RENDER_COST, overrideFeature: "Clean Wallpaper Render" }),
    });
    if (!res) return null; // user cancelled the credit confirmation
    const data = (await res.json().catch(() => ({}))) as {
      url?: string; width?: number; height?: number; error?: string; message?: string;
    };
    if (!res.ok || !data.url) {
      throw new Error(data.message ?? data.error ?? t("wallpapers.renderFailed", { defaultValue: "That render could not be made. Try again in a moment." }));
    }
    return {
      url: data.url,
      presetKey: targetPresetKey,
      label: target.label,
      width: typeof data.width === "number" ? data.width : target.width,
      height: typeof data.height === "number" ? data.height : target.height,
    };
  }

  async function renderSelected() {
    if (!currentArt || rendering) return;
    setRendering(true);
    setRenderError(null);
    try {
      const out = await renderOne(presetKey, currentArt);
      if (out) setRenders((prev) => [out, ...prev]);
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : t("wallpapers.renderFailed", { defaultValue: "That render could not be made. Try again in a moment." }));
    } finally {
      setRendering(false);
    }
  }

  /* ── Theme pack ────────────────────────────────────────────────────── */
  async function makePack() {
    if (!currentArt || packBusy) return;
    setPackBusy(true);
    setPackError(null);
    setApplied(false);
    setListedId(null);
    try {
      const phone = await renderOne(THEME_PACK_PRESET_KEYS.phone, currentArt);
      if (!phone) return; // cancelled at the confirmation
      const desktop = await renderOne(THEME_PACK_PRESET_KEYS.desktop, currentArt);
      if (!desktop) return;
      const brandPalette = (brandKit?.colors ?? []).map((c) => c.hex).filter(Boolean);
      const palette = useBrandPalette && brandPalette.length > 0
        ? brandPalette
        : await extractPalette(currentArt);
      setPack({ phoneUrl: phone.url, desktopUrl: desktop.url, palette });
      setRenders((prev) => [phone, desktop, ...prev]);
      if (!listTitle) setListTitle(t("wallpapers.listDefaultTitle", { defaultValue: "My wallpaper & theme pack" }));
    } catch (e) {
      setPackError(e instanceof Error ? e.message : t("wallpapers.renderFailed", { defaultValue: "That render could not be made. Try again in a moment." }));
    } finally {
      setPackBusy(false);
    }
  }

  async function applyPack() {
    if (!pack || applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      const theme_config = buildThemeConfigFromPalette(pack.palette);
      await saveMyProfile({ theme_config, banner_url: pack.desktopUrl });
      setApplied(true);
      toast({ title: t("wallpapers.appliedToast", { defaultValue: "Theme applied to your profile" }) });
    } catch {
      setApplyError(t("wallpapers.applyFailed", { defaultValue: "Your profile theme could not be saved. Make sure you have a profile, then try again." }));
    } finally {
      setApplying(false);
    }
  }

  async function listPack() {
    if (!pack || listing) return;
    setListing(true);
    setListError(null);
    try {
      const dollars = Number.parseFloat(listPrice);
      const priceCents = Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0;
      const token = await getAccessToken();
      const res = await fetch("/api/storefront/products", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          kind: "download",
          title: listTitle.trim() || t("wallpapers.listDefaultTitle", { defaultValue: "My wallpaper & theme pack" }),
          description: t("wallpapers.listDescription", { defaultValue: "The full set: phone wallpaper, lock screen and desktop wallpaper, matched to one palette." }),
          priceCents,
          mediaUrls: [pack.phoneUrl],
          inventory: -1,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { product?: { id?: string }; error?: string; message?: string };
      if (!res.ok || !data.product?.id) {
        throw new Error(data.message ?? data.error ?? t("wallpapers.listFailed", { defaultValue: "The listing could not be created. Try again in a moment." }));
      }
      setListedId(data.product.id);
      toast({ title: t("wallpapers.listedToast", { defaultValue: "Listed in your store" }) });
    } catch (e) {
      setListError(e instanceof Error ? e.message : t("wallpapers.listFailed", { defaultValue: "The listing could not be created. Try again in a moment." }));
    } finally {
      setListing(false);
    }
  }

  async function downloadZip(urls: string[], name: string, setBusy: (b: boolean) => void, errorKey: string) {
    setBusy(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/wallpapers/pack-download", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ urls, name }),
      });
      if (!res.ok) throw new Error("zip failed");
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${name}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
      toast({ title: t(errorKey, { defaultValue: "The download could not be prepared. Try again in a moment." }), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  /* ── Screensaver ───────────────────────────────────────────────────── */
  async function generateVideo() {
    if (!videoPrompt.trim() || generatingVideo) return;
    setGeneratingVideo(true);
    setVideoError(null);
    try {
      const res = await confirmedFetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: videoPrompt.trim(), duration: 5, aspectRatio: "16:9" }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data.message === "string" ? data.message : t("wallpapers.videoGenerateFailed", { defaultValue: "Video generation failed. Visual Bucs were not charged." }));
      const direct = [data.url, data.videoUrl, data.thumbnailImageUrl].find((v) => typeof v === "string") as string | undefined;
      if (direct) {
        setVideoUrl(direct);
        refreshProfile();
        void loadAssets();
        return;
      }
      const taskId = typeof data.taskId === "string" ? data.taskId : typeof data.id === "string" ? data.id : null;
      if (!taskId) throw new Error(t("wallpapers.videoGenerateFailed", { defaultValue: "Video generation failed. Visual Bucs were not charged." }));
      const token = await getAccessToken();
      for (let i = 0; i < 60; i++) {
        await sleep(3000);
        const poll = await fetch(`/api/generate-video/${taskId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const pdata = (await poll.json().catch(() => ({}))) as Record<string, unknown>;
        const url = [pdata.url, pdata.videoUrl].find((v) => typeof v === "string") as string | undefined;
        if ((pdata.status === "succeeded" || pdata.status === "completed") && url) {
          setVideoUrl(url);
          refreshProfile();
          void loadAssets();
          return;
        }
        if (pdata.status === "failed" || pdata.status === "cancelled") {
          throw new Error(t("wallpapers.videoGenerateFailed", { defaultValue: "Video generation failed. Visual Bucs were not charged." }));
        }
      }
      throw new Error(t("wallpapers.videoGenerateFailed", { defaultValue: "Video generation failed. Visual Bucs were not charged." }));
    } catch (e) {
      setVideoError(e instanceof Error ? e.message : t("wallpapers.videoGenerateFailed", { defaultValue: "Video generation failed. Visual Bucs were not charged." }));
    } finally {
      setGeneratingVideo(false);
    }
  }

  async function renderScreensaver() {
    if (!videoUrl || ssBusy) return;
    setSsBusy(true);
    setSsError(null);
    try {
      const res = await confirmedFetch("/api/wallpapers/screensaver-render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl,
          presetKey: ssPresetKey,
          branded,
          ...(branded ? { logoUrl: brandKit?.logoUrl ?? undefined, brandName } : {}),
        }),
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as {
        url?: string; width?: number; height?: number; seconds?: number; creditCost?: number; error?: string; message?: string;
      };
      if (!res.ok || !data.url) {
        throw new Error(data.message ?? data.error ?? t("wallpapers.screensaverRenderFailed", { defaultValue: "The screensaver render could not be made. Try again in a moment." }));
      }
      const target = wallpaperPresetByKey(ssPresetKey);
      setSsResult({
        url: data.url,
        width: typeof data.width === "number" ? data.width : target.width,
        height: typeof data.height === "number" ? data.height : target.height,
        seconds: typeof data.seconds === "number" ? data.seconds : 0,
        creditCost: typeof data.creditCost === "number" ? data.creditCost : 400,
      });
      refreshProfile();
    } catch (e) {
      setSsError(e instanceof Error ? e.message : t("wallpapers.screensaverRenderFailed", { defaultValue: "The screensaver render could not be made. Try again in a moment." }));
    } finally {
      setSsBusy(false);
    }
  }

  /* ── Styling helpers (house look: gold accents, lux panels) ────────── */
  const panel = isLight
    ? "rounded-3xl border border-[#c9a84c]/30 bg-[#FCF7EA] p-6 md:p-7"
    : "rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-7";
  const inputClass = isLight
    ? "w-full rounded-xl border border-[#c9a84c]/30 bg-white px-4 py-3 text-sm text-stone-800 placeholder:text-stone-400 focus:border-[#d4a017]/60 focus:outline-none"
    : "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none";
  const goldButton = "inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";
  const ghostButton = isLight
    ? "inline-flex items-center gap-2 rounded-xl border border-[#c9a84c]/40 bg-white px-4 py-2.5 text-sm font-bold text-stone-700 transition hover:border-[#d4a017]/70 disabled:opacity-40"
    : "inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-bold text-white/80 transition hover:border-white/25 disabled:opacity-40";
  const tabButton = (active: boolean) =>
    `rounded-full border px-4 py-2 text-xs font-bold transition ${
      active
        ? "border-primary/60 bg-primary/15 text-primary"
        : isLight
          ? "border-[#c9a84c]/30 bg-white text-stone-600 hover:border-[#d4a017]/60"
          : "border-white/10 bg-white/5 text-white/50 hover:text-white/85"
    }`;
  const sectionTitle = "flex items-center gap-2 text-base font-black";
  const packUrls = pack ? [pack.phoneUrl, pack.phoneUrl, pack.desktopUrl] : renders.map((r) => r.url);
  const chips = [
    { key: "chipMe", label: t("wallpapers.chipMe", { defaultValue: "Me, larger than life" }) },
    { key: "chipCharacter", label: t("wallpapers.chipCharacter", { defaultValue: "My character, front and center" }) },
    { key: "chipProduct", label: t("wallpapers.chipProduct", { defaultValue: "My product, hero shot" }) },
    { key: "chipCover", label: t("wallpapers.chipCover", { defaultValue: "My cover art, extended" }) },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className={panel}>
        <div className="mb-2 flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-black">{t("wallpapers.title", { defaultValue: "Wallpapers & Themes" })}</h2>
        </div>
        <p className={`text-sm ${isLight ? "text-stone-500" : "text-white/50"}`}>
          {t("wallpapers.subtitle", { defaultValue: "Wallpapers, lock screens, screensavers and matched theme packs for phones, tablets and computers — your art at the center, sized exactly for the device." })}
        </p>
      </div>

      {/* THE KING'S SET — the house starter pack. Owner-approved pieces:
          the King subject-led, the full logo lockup baked in whole at
          emblem size. Free to use as art, free to download; the living
          versions feed the screensaver rail below. */}
      <section className={panel} aria-label={t("wallpapers.kingset.title", { defaultValue: "The King's Set" })}>
        <h3 className={sectionTitle}>
          <Crown className="h-4 w-4 text-primary" />
          {t("wallpapers.kingset.title", { defaultValue: "The King's Set" })}
        </h3>
        <p className={`mt-1 text-sm ${isLight ? "text-stone-500" : "text-white/50"}`}>
          {t("wallpapers.kingset.sub", { defaultValue: "The house starter pack — the King himself, front and center, with the full Bow Down Visuals lockup already on every piece. Free to use and free to download." })}
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {KINGS_SET.map((piece) => {
            const living = livingId === piece.id;
            return (
              <div key={piece.id} className={`overflow-hidden rounded-2xl border ${isLight ? "border-stone-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
                <div className={piece.orientation === "portrait" ? "aspect-[9/16]" : "aspect-video"}>
                  {living ? (
                    <video
                      src={piece.loopUrl}
                      className="h-full w-full object-cover"
                      autoPlay
                      muted
                      loop
                      playsInline
                      aria-label={t(`wallpapers.kingset.${piece.titleKey}`, { defaultValue: piece.id })}
                    />
                  ) : (
                    <img
                      src={piece.stillUrl}
                      alt={t(`wallpapers.kingset.${piece.titleKey}`, { defaultValue: piece.id })}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                <div className="p-3">
                  <p className="text-sm font-bold">
                    {t(`wallpapers.kingset.${piece.titleKey}`, {
                      defaultValue: piece.id === "plaza" ? "The King on the Plaza" : piece.id === "throne" ? "The King on His Throne" : "The King on Stage",
                    })}
                  </p>
                  <p className={`text-xs ${isLight ? "text-stone-500" : "text-white/40"}`}>
                    {piece.stillWidth} × {piece.stillHeight}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => { setCurrentArt(piece.stillUrl); setPresetKey(piece.presetKey); }}
                      className="rounded-full bg-[#d4a017] px-3 py-1.5 text-xs font-black text-black transition hover:bg-[#e8c86a]"
                    >
                      {t("wallpapers.kingset.useArt", { defaultValue: "Use this art" })}
                    </button>
                    <button
                      type="button"
                      onClick={() => setLivingId(living ? null : piece.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${isLight ? "border-stone-300 text-stone-600 hover:border-[#d4a017]/60" : "border-white/15 text-white/70 hover:border-white/35"}`}
                    >
                      {living
                        ? t("wallpapers.kingset.still", { defaultValue: "Still" })
                        : t("wallpapers.kingset.living", { defaultValue: "Living version" })}
                    </button>
                    <button
                      type="button"
                      onClick={() => setVideoUrl(piece.loopUrl)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${isLight ? "border-stone-300 text-stone-600 hover:border-[#d4a017]/60" : "border-white/15 text-white/70 hover:border-white/35"}`}
                    >
                      {t("wallpapers.kingset.useForScreensaver", { defaultValue: "Use as screensaver" })}
                    </button>
                    <a
                      href={piece.stillUrl}
                      download
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold transition ${isLight ? "border-stone-300 text-stone-600 hover:border-[#d4a017]/60" : "border-white/15 text-white/70 hover:border-white/35"}`}
                    >
                      <Download className="h-3 w-3" />
                      {t("wallpapers.kingset.download", { defaultValue: "Download" })}
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* SOURCE */}
      <section className={panel} aria-label={t("wallpapers.sourceTitle", { defaultValue: "Your art" })}>
        <h3 className={sectionTitle}>
          <Sparkles className="h-4 w-4 text-primary" />
          {t("wallpapers.sourceTitle", { defaultValue: "Your art" })}
        </h3>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={tabButton(sourceTab === "generate")} onClick={() => setSourceTab("generate")}>
            {t("wallpapers.tabGenerate", { defaultValue: "Generate" })}
          </button>
          <button type="button" className={tabButton(sourceTab === "myart")} onClick={() => setSourceTab("myart")}>
            {t("wallpapers.tabMyArt", { defaultValue: "My Art" })}
          </button>
          <button type="button" className={tabButton(sourceTab === "brand")} onClick={() => setSourceTab("brand")}>
            {t("wallpapers.tabBrand", { defaultValue: "Brand" })}
          </button>
        </div>

        {sourceTab === "generate" && (
          <div className="mt-5">
            <p className={`text-sm ${isLight ? "text-stone-500" : "text-white/50"}`}>
              {t("wallpapers.generateHint", { defaultValue: "Put yourself at the center — you, your character or your product front and center, with scenery only as the backdrop." })}
            </p>
            {currentArt && (
              <p className={`mt-2 text-sm ${isLight ? "text-stone-500" : "text-white/50"}`}>
                {t("wallpapers.generateCenterNote", { defaultValue: "Art is selected — a new generation keeps that piece, or you, at the center of the frame." })}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {chips.map((chip) => (
                <button key={chip.key} type="button" onClick={() => setPrompt(chip.label)} className={tabButton(prompt === chip.label)}>
                  {chip.label}
                </button>
              ))}
            </div>
            <label className="mt-4 block text-[11px] font-bold uppercase tracking-widest text-primary/80">
              {t("wallpapers.promptLabel", { defaultValue: "Describe your wallpaper" })}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={t("wallpapers.promptPlaceholder", { defaultValue: "You as the main character — your look, your crown, your city behind you…" })}
              className={`${inputClass} mt-1.5`}
            />
            {artError && <p className="mt-3 text-sm text-red-400">{artError}</p>}
            <button type="button" onClick={generateArt} disabled={generating || !prompt.trim()} className={`${goldButton} mt-4`}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating
                ? t("wallpapers.generating", { defaultValue: "Generating…" })
                : `${t("wallpapers.generateButton", { defaultValue: "Generate" })} — 100 Visual Bucs`}
            </button>
          </div>
        )}

        {sourceTab === "myart" && (
          <div className="mt-5">
            {assetsLoading && (
              <p className={`flex items-center gap-2 text-sm ${isLight ? "text-stone-500" : "text-white/40"}`}>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("wallpapers.myArtLoading", { defaultValue: "Loading your art…" })}
              </p>
            )}
            {assetsError && <p className="text-sm text-red-400">{assetsError}</p>}
            {!assetsLoading && !assetsError && imageAssets.length === 0 && (
              <p className={`text-sm ${isLight ? "text-stone-500" : "text-white/40"}`}>
                {t("wallpapers.myArtEmpty", { defaultValue: "No art yet — generate your first piece and it will be waiting here." })}
              </p>
            )}
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {imageAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => setCurrentArt(asset.url)}
                  className={`relative aspect-square overflow-hidden rounded-xl border transition ${
                    currentArt === asset.url ? "border-primary ring-2 ring-primary/50" : "border-white/10 hover:border-primary/50"
                  }`}
                  title={asset.label}
                >
                  <img src={asset.url} alt={asset.label} className="h-full w-full object-cover" loading="lazy" />
                  {currentArt === asset.url && (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-0.5 text-black"><Check className="h-3 w-3" /></span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {sourceTab === "brand" && (
          <div className="mt-5">
            <h4 className="text-sm font-black">
              {t("wallpapers.brandSectionTitle", { defaultValue: "Your branding — on every piece by default" })}
            </h4>
            {brandLoading && (
              <p className={`mt-3 flex items-center gap-2 text-sm ${isLight ? "text-stone-500" : "text-white/40"}`}>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("wallpapers.brandLoading", { defaultValue: "Loading your brand kit…" })}
              </p>
            )}
            {brandError && <p className="mt-3 text-sm text-amber-400">{brandError}</p>}
            {!brandLoading && !brandKit && !brandError && (
              <p className={`mt-3 text-sm ${isLight ? "text-stone-500" : "text-white/50"}`}>
                {t("wallpapers.brandNoKit", { defaultValue: "No brand kit yet — build one in the Branding Kit and your logo will ride on every render. Until then, renders carry your profile name." })}
              </p>
            )}
            {brandKit?.logoUrl && (
              <img
                src={brandKit.logoUrl}
                alt={t("wallpapers.brandLogoAlt", { defaultValue: "Your brand logo" })}
                className="mt-4 max-h-28 w-auto max-w-[240px] rounded-2xl border border-white/10 object-contain"
              />
            )}
            {brandName && <p className="mt-3 text-sm font-bold">{brandName}</p>}
            <p className={`mt-2 text-xs ${isLight ? "text-stone-500" : "text-white/40"}`}>
              {t("wallpapers.logoWholeNote", { defaultValue: "Your logo goes on whole — never cropped, never cut apart. We only scale it and place it." })}
            </p>
            {(brandKit?.colors?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {brandKit!.colors.map((c, i) => (
                  <span key={`${c.hex}-${i}`} className="h-8 w-8 rounded-full border border-white/20" style={{ backgroundColor: c.hex }} title={c.name || c.hex} />
                ))}
                <button type="button" className={`${ghostButton} ml-2`} onClick={() => setUseBrandPalette(true)}>
                  <Palette className="h-4 w-4 text-primary" />
                  {t("wallpapers.useBrandPaletteButton", { defaultValue: "Use my brand palette for the pack" })}
                </button>
                {useBrandPalette && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-primary">
                    <Check className="h-3.5 w-3.5" />
                    {t("wallpapers.brandPaletteReady", { defaultValue: "Brand palette set for the pack" })}
                  </span>
                )}
              </div>
            )}
            {/* Branding switch — ON by default; off = clean renders at 400. */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={branded}
                onClick={() => setBranded((b) => !b)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${branded ? "bg-primary" : isLight ? "bg-stone-300" : "bg-white/15"}`}
              >
                <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${branded ? "left-[22px]" : "left-0.5"}`} />
              </button>
              <span className="text-sm font-bold">
                {t("wallpapers.brandToggleLabel", { defaultValue: "Brand my wallpapers, screensavers & themes" })}
              </span>
            </div>
            <p className={`mt-2 text-xs ${isLight ? "text-stone-500" : "text-white/40"}`}>
              {branded
                ? t("wallpapers.brandOnNote", { defaultValue: "Branding is on — your logo and name go on every render, free." })
                : t("wallpapers.brandCleanNote", { defaultValue: "Clean (unbranded) renders cost 400 Visual Bucs — branded renders are free." })}
            </p>
          </div>
        )}
      </section>

      {/* DEVICE */}
      <section className={panel} aria-label={t("wallpapers.deviceTitle", { defaultValue: "Device size" })}>
        <h3 className={sectionTitle}>
          <Monitor className="h-4 w-4 text-primary" />
          {t("wallpapers.deviceTitle", { defaultValue: "Device size" })}
        </h3>
        {KIND_ORDER.map((kind) => {
          const Icon = KIND_ICONS[kind];
          return (
            <div key={kind} className="mt-5">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                <Icon className="h-3.5 w-3.5" />
                {t(`wallpapers.group${kind === "phone" ? "Phone" : kind === "tablet" ? "Tablet" : "Desktop"}`, {
                  defaultValue: kind === "phone" ? "Phone" : kind === "tablet" ? "Tablet" : "Desktop",
                })}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {wallpaperPresetsByKind(kind).map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPresetKey(p.key)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${
                      presetKey === p.key
                        ? "border-primary/60 bg-primary/10"
                        : isLight
                          ? "border-[#c9a84c]/25 bg-white hover:border-[#d4a017]/60"
                          : "border-white/10 bg-white/[0.04] hover:border-white/25"
                    }`}
                  >
                    <span className="block text-sm font-bold">{p.label}</span>
                    <span className={`block text-xs ${isLight ? "text-stone-500" : "text-white/40"}`}>{p.width} × {p.height}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {/* Current art in a device-shaped frame — subject-led empty state */}
        <div className="mt-6">
          <div
            className={`relative mx-auto overflow-hidden rounded-[1.75rem] border ${isLight ? "border-[#c9a84c]/40 bg-white" : "border-white/15 bg-black/40"}`}
            style={{
              aspectRatio: `${preset.width} / ${preset.height}`,
              width: preset.kind === "desktop" ? "100%" : undefined,
              maxWidth: preset.kind === "phone" ? 240 : preset.kind === "tablet" ? 340 : 560,
              maxHeight: 460,
            }}
          >
            {currentArt ? (
              <img src={currentArt} alt={t("wallpapers.currentArtAlt", { defaultValue: "Your selected art" })} className="h-full w-full object-cover" />
            ) : (
              <div className={`flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center ${isLight ? "text-stone-400" : "text-white/30"}`}>
                <span className="relative flex items-end justify-center">
                  <User className="h-16 w-16" />
                  <Crown className="absolute -top-4 h-7 w-7 text-primary" />
                </span>
                <p className="text-sm">
                  {t("wallpapers.previewEmpty", { defaultValue: "You belong front and center — generate your art, pick it from My Art, or bring your brand art and it fills this frame." })}
                </p>
              </div>
            )}
          </div>
          <p className={`mt-2 text-center text-xs ${isLight ? "text-stone-500" : "text-white/40"}`}>
            {preset.label} — {preset.width} × {preset.height}
          </p>
        </div>

        {renderError && <p className="mt-3 text-sm text-red-400">{renderError}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={renderSelected} disabled={rendering || !currentArt} className={goldButton}>
            {rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {rendering
              ? t("wallpapers.rendering", { defaultValue: "Rendering…" })
              : branded
                ? t("wallpapers.renderButton", { defaultValue: "Render exact size — Free" })
                : `${t("wallpapers.renderCleanButton", { defaultValue: "Render clean, exact size" })} — 400 Visual Bucs`}
          </button>
          {!currentArt && (
            <span className={`text-xs ${isLight ? "text-stone-500" : "text-white/40"}`}>
              {t("wallpapers.needArt", { defaultValue: "Pick or generate art first." })}
            </span>
          )}
        </div>
        <p className={`mt-2 text-xs ${isLight ? "text-stone-500" : "text-white/40"}`}>
          {branded
            ? t("wallpapers.brandOnNote", { defaultValue: "Branding is on — your logo and name go on every render, free." })
            : t("wallpapers.brandCleanNote", { defaultValue: "Clean (unbranded) renders cost 400 Visual Bucs — branded renders are free." })}
        </p>

        {renders.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-black">{t("wallpapers.renderedTitle", { defaultValue: "Your renders" })}</h4>
            <ul className="mt-3 space-y-2">
              {renders.map((r, i) => (
                <li key={`${r.url}-${i}`} className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${isLight ? "border-[#c9a84c]/25 bg-white" : "border-white/10 bg-white/[0.04]"}`}>
                  <img src={r.url} alt={r.label} className="h-12 w-12 rounded-lg object-cover" loading="lazy" />
                  <span className="min-w-0 flex-1 text-sm font-bold">{r.label} — {r.width} × {r.height}</span>
                  <a href={r.url} download className={ghostButton}>
                    <Download className="h-4 w-4" />
                    {t("wallpapers.download", { defaultValue: "Download" })}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* THEME PACK */}
      <section className={panel} aria-label={t("wallpapers.packTitle", { defaultValue: "Theme pack" })}>
        <h3 className={sectionTitle}>
          <Package className="h-4 w-4 text-primary" />
          {t("wallpapers.packTitle", { defaultValue: "Theme pack" })}
        </h3>
        <p className={`mt-2 text-sm ${isLight ? "text-stone-500" : "text-white/50"}`}>
          {t("wallpapers.packBlurb", { defaultValue: "One piece of art becomes the whole set — phone wallpaper, lock screen and desktop wallpaper, plus a profile theme matched to its colors." })}
        </p>
        {packError && <p className="mt-3 text-sm text-red-400">{packError}</p>}
        <button type="button" onClick={makePack} disabled={packBusy || !currentArt} className={`${goldButton} mt-4`}>
          {packBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
          {packBusy
            ? t("wallpapers.packMaking", { defaultValue: "Building the set…" })
            : branded
              ? t("wallpapers.packMakeButton", { defaultValue: "Make the whole set — Free" })
              : `${t("wallpapers.packMakeCleanButton", { defaultValue: "Make the whole set, clean" })} — 800 Visual Bucs`}
        </button>
        {!branded && (
          <p className={`mt-2 text-xs ${isLight ? "text-stone-500" : "text-white/40"}`}>
            {t("wallpapers.packCleanNote", { defaultValue: "Clean pack: the phone and desktop renders are charged once each — the lock screen reuses the phone render and is never charged twice." })}
          </p>
        )}

        {pack && (
          <div className="mt-6 space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <figure>
                <img src={pack.phoneUrl} alt={t("wallpapers.packPhoneLabel", { defaultValue: "Phone wallpaper" })} className="aspect-[9/19] w-full rounded-xl border border-white/10 object-cover" loading="lazy" />
                <figcaption className={`mt-1.5 text-center text-xs font-bold ${isLight ? "text-stone-500" : "text-white/50"}`}>
                  {t("wallpapers.packPhoneLabel", { defaultValue: "Phone wallpaper" })}
                </figcaption>
              </figure>
              <figure>
                <img src={pack.phoneUrl} alt={t("wallpapers.packLockLabel", { defaultValue: "Lock screen" })} className="aspect-[9/19] w-full rounded-xl border border-white/10 object-cover" loading="lazy" />
                <figcaption className={`mt-1.5 text-center text-xs font-bold ${isLight ? "text-stone-500" : "text-white/50"}`}>
                  {t("wallpapers.packLockLabel", { defaultValue: "Lock screen" })}
                </figcaption>
              </figure>
              <figure>
                <img src={pack.desktopUrl} alt={t("wallpapers.packDesktopLabel", { defaultValue: "Desktop wallpaper" })} className="aspect-video w-full self-start rounded-xl border border-white/10 object-cover" loading="lazy" />
                <figcaption className={`mt-1.5 text-center text-xs font-bold ${isLight ? "text-stone-500" : "text-white/50"}`}>
                  {t("wallpapers.packDesktopLabel", { defaultValue: "Desktop wallpaper" })}
                </figcaption>
              </figure>
            </div>
            <p className={`text-xs ${isLight ? "text-stone-500" : "text-white/40"}`}>
              {t("wallpapers.packLockNote", { defaultValue: "The lock screen reuses the phone render — same pixels, framed calm at the top so your clock stays readable." })}
            </p>
            {pack.palette.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-primary/80">
                  {t("wallpapers.packPaletteTitle", { defaultValue: "Pack palette" })}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {pack.palette.map((hex) => (
                    <span key={hex} className="flex items-center gap-1.5 rounded-full border border-white/15 py-1 pl-1 pr-3 text-xs font-bold">
                      <span className="h-5 w-5 rounded-full border border-white/20" style={{ backgroundColor: hex }} />
                      {hex}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={applyPack} disabled={applying} className={goldButton}>
                {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Palette className="h-4 w-4" />}
                {applying
                  ? t("wallpapers.applying", { defaultValue: "Applying…" })
                  : t("wallpapers.applyButton", { defaultValue: "Apply to my profile" })}
              </button>
              <button
                type="button"
                onClick={() => void downloadZip(packUrls, "wallpaper-theme-pack", setZipBusy, "wallpapers.zipFailed")}
                disabled={zipBusy}
                className={ghostButton}
              >
                {zipBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {zipBusy
                  ? t("wallpapers.zipMaking", { defaultValue: "Preparing…" })
                  : t("wallpapers.zipButton", { defaultValue: "Download the set (.zip)" })}
              </button>
            </div>
            {applied && (
              <p className="flex items-center gap-1.5 text-sm font-bold text-primary">
                <Check className="h-4 w-4" />
                {t("wallpapers.appliedToast", { defaultValue: "Theme applied to your profile" })}
              </p>
            )}
            {applyError && <p className="text-sm text-red-400">{applyError}</p>}

            {/* List in my store */}
            <div className={`rounded-2xl border p-4 ${isLight ? "border-[#c9a84c]/25 bg-white" : "border-white/10 bg-white/[0.04]"}`}>
              <h4 className="flex items-center gap-2 text-sm font-black">
                <Store className="h-4 w-4 text-primary" />
                {t("wallpapers.listHeading", { defaultValue: "List in my store" })}
              </h4>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-widest text-primary/80">
                    {t("wallpapers.listTitleLabel", { defaultValue: "Listing title" })}
                  </label>
                  <input value={listTitle} onChange={(e) => setListTitle(e.target.value)} maxLength={120} className={`${inputClass} mt-1.5`} />
                </div>
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-widest text-primary/80">
                    {t("wallpapers.listPriceLabel", { defaultValue: "Price (dollars)" })}
                  </label>
                  <input value={listPrice} onChange={(e) => setListPrice(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className={`${inputClass} mt-1.5`} />
                  <p className={`mt-1 text-xs ${isLight ? "text-stone-500" : "text-white/40"}`}>
                    {t("wallpapers.listPriceHint", { defaultValue: "Set zero and the pack is free for your fans." })}
                  </p>
                </div>
              </div>
              {listError && <p className="mt-3 text-sm text-red-400">{listError}</p>}
              <button type="button" onClick={listPack} disabled={listing} className={`${goldButton} mt-4`}>
                {listing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}
                {listing
                  ? t("wallpapers.listing", { defaultValue: "Listing…" })
                  : t("wallpapers.listButton", { defaultValue: "List in my store" })}
              </button>
              {listedId && (
                <p className="mt-3 flex flex-wrap gap-4 text-sm font-bold">
                  <Link href={`/storefront/product/${listedId}`} className="text-primary underline underline-offset-4">
                    {t("wallpapers.viewProduct", { defaultValue: "View the product" })}
                  </Link>
                  <Link href="/my-shop" className="text-primary underline underline-offset-4">
                    {t("wallpapers.openShop", { defaultValue: "Open my shop" })}
                  </Link>
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* SCREENSAVER */}
      <section className={panel} aria-label={t("wallpapers.screensaverTitle", { defaultValue: "Screensaver" })}>
        <h3 className={sectionTitle}>
          <Video className="h-4 w-4 text-primary" />
          {t("wallpapers.screensaverTitle", { defaultValue: "Screensaver" })}
        </h3>
        <p className={`mt-2 text-sm ${isLight ? "text-stone-500" : "text-white/50"}`}>
          {t("wallpapers.screensaverBlurb", { defaultValue: "Turn a video into a looping screensaver at exact desktop size — your motion, your brand, on every screen you own." })}
        </p>

        <label className="mt-4 block text-[11px] font-bold uppercase tracking-widest text-primary/80">
          {t("wallpapers.screensaverPickVideoLabel", { defaultValue: "Pick one of your videos" })}
        </label>
        {videoAssets.length > 0 ? (
          <select value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} className={`${inputClass} mt-1.5`}>
            <option value="">{t("wallpapers.screensaverPickVideoLabel", { defaultValue: "Pick one of your videos" })}</option>
            {videoAssets.map((a) => (
              <option key={a.id} value={a.url}>{a.label}</option>
            ))}
          </select>
        ) : (
          <p className={`mt-1.5 text-sm ${isLight ? "text-stone-500" : "text-white/40"}`}>
            {t("wallpapers.screensaverNoVideos", { defaultValue: "No videos in your library yet — generate one below and it lands here." })}
          </p>
        )}
        {videoUrl && <video src={videoUrl} className="mt-3 aspect-video w-full rounded-xl border border-white/10 object-cover" muted loop playsInline controls />}

        <label className="mt-4 block text-[11px] font-bold uppercase tracking-widest text-primary/80">
          {t("wallpapers.screensaverVideoPromptLabel", { defaultValue: "Or generate a video" })}
        </label>
        <textarea
          value={videoPrompt}
          onChange={(e) => setVideoPrompt(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder={t("wallpapers.screensaverVideoPromptPlaceholder", { defaultValue: "You in motion — your stage, your city lights moving behind you…" })}
          className={`${inputClass} mt-1.5`}
        />
        {videoError && <p className="mt-3 text-sm text-red-400">{videoError}</p>}
        <button type="button" onClick={generateVideo} disabled={generatingVideo || !videoPrompt.trim()} className={`${ghostButton} mt-3`}>
          {generatingVideo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
          {generatingVideo
            ? t("wallpapers.screensaverGeneratingVideo", { defaultValue: "Generating video…" })
            : `${t("wallpapers.screensaverGenerateVideoButton", { defaultValue: "Generate video" })} — 400 Visual Bucs`}
        </button>

        <label className="mt-5 block text-[11px] font-bold uppercase tracking-widest text-primary/80">
          {t("wallpapers.screensaverPresetLabel", { defaultValue: "Screensaver size" })}
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {wallpaperPresetsByKind("desktop").map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setSsPresetKey(p.key)}
              className={`rounded-xl border px-3 py-2.5 text-left transition ${
                ssPresetKey === p.key
                  ? "border-primary/60 bg-primary/10"
                  : isLight
                    ? "border-[#c9a84c]/25 bg-white hover:border-[#d4a017]/60"
                    : "border-white/10 bg-white/[0.04] hover:border-white/25"
              }`}
            >
              <span className="block text-sm font-bold">{p.label}</span>
              <span className={`block text-xs ${isLight ? "text-stone-500" : "text-white/40"}`}>{p.width} × {p.height}</span>
            </button>
          ))}
        </div>

        {ssError && <p className="mt-3 text-sm text-red-400">{ssError}</p>}
        <button type="button" onClick={renderScreensaver} disabled={ssBusy || !videoUrl} className={`${goldButton} mt-4`}>
          {ssBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Monitor className="h-4 w-4" />}
          {ssBusy
            ? t("wallpapers.screensaverRendering", { defaultValue: "Rendering the loop…" })
            : `${t("wallpapers.screensaverRenderButton", { defaultValue: "Render loop" })} — 400 Visual Bucs`}
        </button>
        {!videoUrl && (
          <span className={`ml-3 text-xs ${isLight ? "text-stone-500" : "text-white/40"}`}>
            {t("wallpapers.needVideo", { defaultValue: "Pick or generate a video first." })}
          </span>
        )}
        <p className={`mt-3 text-xs ${isLight ? "text-stone-500" : "text-white/40"}`}>
          {t("wallpapers.screensaverCaption", { defaultValue: "The export is a looping video file — set it as a video wallpaper or screensaver in your system settings or a player." })}
        </p>
        {ssResult && (
          <div className={`mt-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${isLight ? "border-[#c9a84c]/25 bg-white" : "border-white/10 bg-white/[0.04]"}`}>
            <span className="flex-1 text-sm font-bold">
              {t("wallpapers.screensaverResultLabel", { defaultValue: "Your screensaver loop" })} — {ssResult.width} × {ssResult.height}
            </span>
            <a href={ssResult.url} download className={ghostButton}>
              <Download className="h-4 w-4" />
              {t("wallpapers.download", { defaultValue: "Download" })}
            </a>
          </div>
        )}

        {/* Slideshow pack — honest folder-of-images offering */}
        <div className={`mt-6 rounded-2xl border p-4 ${isLight ? "border-[#c9a84c]/25 bg-white" : "border-white/10 bg-white/[0.04]"}`}>
          <h4 className="text-sm font-black">{t("wallpapers.slideshowTitle", { defaultValue: "Slideshow pack" })}</h4>
          <p className={`mt-1 text-sm ${isLight ? "text-stone-500" : "text-white/50"}`}>
            {t("wallpapers.slideshowBlurb", { defaultValue: "A folder of your set's images, ready to point a slideshow screensaver at — no video, just your art rotating on screen." })}
          </p>
          <button
            type="button"
            onClick={() => void downloadZip(packUrls, "slideshow-pack", setSlideshowBusy, "wallpapers.zipFailed")}
            disabled={slideshowBusy || packUrls.length === 0}
            className={`${ghostButton} mt-3`}
          >
            {slideshowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t("wallpapers.slideshowButton", { defaultValue: "Download the slideshow pack (.zip)" })}
          </button>
        </div>
      </section>
    </div>
  );
}

export default WallpapersDesk;
