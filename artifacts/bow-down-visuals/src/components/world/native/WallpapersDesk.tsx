/**
 * WallpapersDesk — the Create Wing's native Wallpapers desk
 * (stack1500 world parity wave #3, census item 34).
 *
 * The full wallpaper flow without leaving the World: describe a
 * piece of art and generate it, render it to the EXACT size of a
 * phone / tablet / desktop — stamped with your own logo and name
 * (free) or clean — take ten clean wallpapers for one flat pack
 * price, and make a LIVING wallpaper: a short generated clip
 * rendered as a looping screensaver. Finished renders collect in
 * the session strip and download as one free .zip.
 *
 * Spend discipline mirrors the 2D desk rail for rail: generation
 * and renders ride confirmedFetch with the wallpapers-prices
 * constants as the confirmation quote (the clip rides the registry
 * quote directly); the branded render is FREE and rides
 * skipConfirm. A decline runs nothing; a 402 names the Treasury's
 * Visual Buc Packs desk. The brand stamp is the member's own brand
 * kit logo, sent whole — never cropped, never baked into the art.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { plainErrorText } from "../../../lib/api-error";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import type { CreateDeskProps } from "./CreateDesks";
import { fetchAssetLibrary, libraryAssetsOfKind, type LibraryAsset } from "@/lib/asset-library";
import { fetchBrandKit, type BrandKit } from "@/lib/brand-kit";
import {
  WALLPAPERS_CLIP_REGISTRY_COST,
  WALLPAPERS_PACK10_REGISTRY_COST,
  WALLPAPERS_SCREENSAVER_COST,
  WALLPAPER_ART_PATH,
  WALLPAPER_CLIP_PATH,
  WALLPAPER_PACK10_PATH,
  WALLPAPER_PACK_DOWNLOAD_PATH,
  WALLPAPER_PRESETS,
  WALLPAPER_RENDER_PATH,
  WALLPAPER_SCREENSAVER_PATH,
  WALLPAPER_CLEAN_RENDER_COST,
  WALLPAPER_GENERATE_COST,
  WALLPAPER_PACK_OF_10_COST,
  WALLPAPER_PACK_OF_10_COUNT,
  buildArtRequest,
  buildClipRequest,
  buildPack10Request,
  buildPackDownloadRequest,
  buildRenderRequest,
  buildScreensaverRequest,
  generationPollOf,
  generationSubmitOf,
  packOfResponse,
  packReady,
  prependRenders,
  renderOfResponse,
  screensaverOfResponse,
  togglePackSelection,
  wallpaperPresetByKeyIn,
  type ScreensaverRender,
  type WallpaperBrandInputs,
  type WallpaperRender,
} from "@/lib/world/wallpapers-desk";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function apiErrorText(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    if (typeof rec["message"] === "string" && rec["message"]) return rec["message"];
    if (typeof rec["error"] === "string" && rec["error"] && rec["error"] !== "out_of_credits") {
      return rec["error"];
    }
  }
  return fallback;
}

export function WallpapersDesk(props: CreateDeskProps) {
  const { t, i18n } = useTranslation();
  const { isLight } = props;
  const { confirmedFetch } = useConfirmedApi();
  const { getAccessToken, refreshProfile } = useAuth();
  const deskHeaders = useDeskAuthHeaders();

  const [brandKit, setBrandKit] = useState<BrandKit | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [assetsError, setAssetsError] = useState<string | null>(null);

  const [presetKey, setPresetKey] = useState<string>(WALLPAPER_PRESETS[0]!.key);
  const preset = useMemo(() => wallpaperPresetByKeyIn(WALLPAPER_PRESETS, presetKey), [presetKey]);
  const [branded, setBranded] = useState(true);
  const [aiDisclosure, setAiDisclosure] = useState(true);

  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [artError, setArtError] = useState<string | null>(null);
  const [currentArt, setCurrentArt] = useState<string | null>(null);
  const [sessionArt, setSessionArt] = useState<string[]>([]);

  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renders, setRenders] = useState<WallpaperRender[]>([]);

  const [packSelected, setPackSelected] = useState<string[]>([]);
  const [packBusy, setPackBusy] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);

  const [videoPrompt, setVideoPrompt] = useState("");
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [ssPresetKey, setSsPresetKey] = useState<string>(
    WALLPAPER_PRESETS.find((p) => p.kind === "desktop")?.key ?? WALLPAPER_PRESETS[0]!.key,
  );
  const ssPreset = useMemo(
    () => wallpaperPresetByKeyIn(WALLPAPER_PRESETS, ssPresetKey),
    [ssPresetKey],
  );
  const [ssSeconds, setSsSeconds] = useState(60);
  const [ssBusy, setSsBusy] = useState(false);
  const [ssError, setSsError] = useState<string | null>(null);
  const [ssResult, setSsResult] = useState<ScreensaverRender | null>(null);

  const [zipBusy, setZipBusy] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  const loadAssets = useCallback(async () => {
    try {
      setAssets(await fetchAssetLibrary(getAccessToken));
      setAssetsError(null);
    } catch {
      setAssetsError(t("wallpapers.libraryFailed"));
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    let alive = true;
    void fetchBrandKit(getAccessToken).then((kit) => {
      if (alive) setBrandKit(kit);
    });
    return () => {
      alive = false;
    };
  }, [getAccessToken]);

  const brand: WallpaperBrandInputs = useMemo(
    () => ({
      branded,
      logoUrl: brandKit?.logoUrl ?? null,
      brandName: brandKit?.brandName || null,
      aiDisclosure,
    }),
    [branded, brandKit, aiDisclosure],
  );

  const libraryImages = useMemo(() => libraryAssetsOfKind(assets, "image"), [assets]);
  const packChoices = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const url of [...sessionArt, ...libraryImages.map((a) => a.url)]) {
      if (!seen.has(url)) {
        seen.add(url);
        out.push(url);
      }
    }
    return out;
  }, [sessionArt, libraryImages]);

  const outOfBucs = (text: string) =>
    /out_of_credits|Not enough Visual Bucs/i.test(text)
      ? t("worldCatalogLibrary.wpOutOfBucs")
      : text;

  async function pollGeneration(path: string, taskId: string): Promise<string> {
    const headers = await deskHeaders();
    for (let i = 0; i < 60; i++) {
      await sleep(3000);
      const poll = await fetch(`${path}/${taskId}`, { headers });
      const pdata: unknown = await poll.json().catch(() => ({}));
      const verdict = generationPollOf(pdata);
      if (verdict.kind === "done") return verdict.url;
      if (verdict.kind === "failed") {
        throw new Error(apiErrorText(pdata, t("wallpapers.generateFailed")));
      }
    }
    throw new Error(t("wallpapers.generateFailed"));
  }

  async function generateArt() {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setArtError(null);
    try {
      const res = await confirmedFetch(WALLPAPER_ART_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildArtRequest(prompt, preset)),
        overrideCost: WALLPAPER_GENERATE_COST,
        overrideFeature: "Generate Artist Image (Turbo)",
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorText(data, t("wallpapers.generateFailed")));
      const submit = generationSubmitOf(data);
      if (!submit) throw new Error(t("wallpapers.generateFailed"));
      const url = submit.kind === "done" ? submit.url : await pollGeneration(WALLPAPER_ART_PATH, submit.taskId);
      setCurrentArt(url);
      setSessionArt((prev) => [url, ...prev.filter((u) => u !== url)]);
      refreshProfile();
      void loadAssets();
    } catch (e) {
      setArtError(outOfBucs(e instanceof Error ? e.message : t("wallpapers.generateFailed")));
    } finally {
      setGenerating(false);
    }
  }

  async function renderCurrent() {
    if (!currentArt || rendering) return;
    setRendering(true);
    setRenderError(null);
    try {
      const res = await confirmedFetch(WALLPAPER_RENDER_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRenderRequest(currentArt, presetKey, brand)),
        ...(branded
          ? { skipConfirm: true }
          : { overrideCost: WALLPAPER_CLEAN_RENDER_COST, overrideFeature: "Clean Wallpaper Render" }),
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorText(data, t("wallpapers.renderFailed")));
      const render = renderOfResponse(data, preset);
      if (!render) throw new Error(t("wallpapers.renderFailed"));
      setRenders((prev) => prependRenders(prev, [render]));
      refreshProfile();
    } catch (e) {
      setRenderError(outOfBucs(e instanceof Error ? e.message : t("wallpapers.renderFailed")));
    } finally {
      setRendering(false);
    }
  }

  async function makePackOf10() {
    if (packBusy || !packReady(packSelected)) return;
    setPackBusy(true);
    setPackError(null);
    try {
      const body = buildPack10Request(packSelected, presetKey, aiDisclosure);
      if (!body) return;
      const res = await confirmedFetch(WALLPAPER_PACK10_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        overrideCost: WALLPAPER_PACK_OF_10_COST,
        overrideFeature: "Wallpaper Pack of 10 (clean)",
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(apiErrorText(data, t("wallpapers.pack10Failed")));
      }
      const pack = packOfResponse(data);
      if (!pack) throw new Error(t("wallpapers.pack10Failed"));
      setRenders((prev) => prependRenders(prev, pack));
      refreshProfile();
    } catch (e) {
      setPackError(outOfBucs(e instanceof Error ? e.message : t("wallpapers.pack10Failed")));
    } finally {
      setPackBusy(false);
    }
  }

  async function generateVideo() {
    if (!videoPrompt.trim() || generatingVideo) return;
    setGeneratingVideo(true);
    setVideoError(null);
    try {
      const res = await confirmedFetch(WALLPAPER_CLIP_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildClipRequest(videoPrompt)),
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorText(data, t("wallpapers.videoGenerateFailed")));
      const submit = generationSubmitOf(data);
      if (!submit) throw new Error(t("wallpapers.videoGenerateFailed"));
      const url = submit.kind === "done" ? submit.url : await pollGeneration(WALLPAPER_CLIP_PATH, submit.taskId);
      setVideoUrl(url);
      refreshProfile();
      void loadAssets();
    } catch (e) {
      setVideoError(outOfBucs(e instanceof Error ? e.message : t("wallpapers.videoGenerateFailed")));
    } finally {
      setGeneratingVideo(false);
    }
  }

  async function renderScreensaver() {
    if (!videoUrl || ssBusy) return;
    setSsBusy(true);
    setSsError(null);
    try {
      const res = await confirmedFetch(WALLPAPER_SCREENSAVER_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildScreensaverRequest(videoUrl, ssPresetKey, ssSeconds, brand)),
        overrideCost: WALLPAPERS_SCREENSAVER_COST,
        overrideFeature: "Screensaver Loop Render",
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorText(data, t("wallpapers.screensaverRenderFailed")));
      const render = screensaverOfResponse(data, ssPreset);
      if (!render) throw new Error(t("wallpapers.screensaverRenderFailed"));
      setSsResult(render);
      refreshProfile();
    } catch (e) {
      setSsError(outOfBucs(e instanceof Error ? e.message : t("wallpapers.screensaverRenderFailed")));
    } finally {
      setSsBusy(false);
    }
  }

  async function downloadPackZip() {
    const body = buildPackDownloadRequest(renders.map((r) => r.url), t("worldCatalogLibrary.wpZipName"));
    if (!body || zipBusy) return;
    setZipBusy(true);
    setZipError(null);
    try {
      const headers = await deskHeaders();
      const res = await fetch(WALLPAPER_PACK_DOWNLOAD_PATH, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(t("worldCatalogLibrary.wpZipError"));
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = "my-wallpapers.zip";
      a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      setZipError(plainErrorText(e, t("worldCatalogLibrary.wpZipError")));
    } finally {
      setZipBusy(false);
    }
  }

  const sub = isLight ? "text-[#6B5B36]" : "text-white/50";
  const card = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/70 text-[#3D2E0A] placeholder:text-[#6B5B36]/60"
      : "border-white/15 bg-black/30 text-white placeholder:text-white/35"
  }`;
  const chip = (active: boolean) =>
    `bdv-touch-target rounded-full border px-3 py-1.5 text-xs font-semibold ${
      active
        ? "border-[#d4af37] bg-[#d4af37]/20 text-[#d4af37]"
        : isLight
          ? "border-[#C9A84C]/40 text-[#6B5B36]"
          : "border-white/15 text-white/60"
    }`;
  const goldBtn =
    "bdv-touch-target rounded-lg bg-[#d4af37] px-4 py-2 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50";
  const err = "text-xs font-semibold text-rose-500";

  return (
    <div className="space-y-4" data-testid="world-wallpapers-desk">
      {/* ── 1 · Make the art ─────────────────────────────────────── */}
      <section className={`rounded-xl border p-3 ${card}`}>
        <p className="text-sm font-bold">{t("worldCatalogLibrary.wpSectionArt")}</p>
        <p className={`mt-0.5 text-xs ${sub}`}>
          {t("worldCatalogLibrary.wpArtCostLine", { cost: WALLPAPER_GENERATE_COST.toLocaleString(i18n.language) })}
        </p>
        <div className="mt-2 flex gap-2">
          <input
            data-testid="world-wallpapers-desk-prompt"
            aria-label={t("worldCatalogLibrary.wpAriaPrompt")}
            className={inputCls}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("worldCatalogLibrary.wpPromptPlaceholder")}
            maxLength={600}
          />
          <button
            type="button"
            data-testid="world-wallpapers-desk-generate"
            className={goldBtn}
            disabled={generating || !prompt.trim()}
            onClick={() => void generateArt()}
          >
            {generating ? t("worldCatalogLibrary.wpMaking") : t("worldCatalogLibrary.wpMakeIt")}
          </button>
        </div>
        {artError ? (
          <p className={`mt-2 ${err}`} data-testid="world-wallpapers-desk-art-error">{artError}</p>
        ) : null}
        {assetsError ? <p className={`mt-2 text-xs ${sub}`}>{assetsError}</p> : null}
        {packChoices.length > 0 ? (
          <div className="mt-3">
            <p className={`text-[11px] font-semibold ${sub}`}>{t("worldCatalogLibrary.wpYourArt")}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {packChoices.slice(0, 12).map((url, i) => (
                <button
                  key={url}
                  type="button"
                  data-testid={`world-wallpapers-desk-art-${i}`}
                  aria-pressed={currentArt === url}
                  className={chip(currentArt === url)}
                  onClick={() => setCurrentArt(url)}
                >
                  {currentArt === url ? t("worldCatalogLibrary.wpWorkingPiece") : t("worldCatalogLibrary.wpPiece", { n: i + 1 })}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* ── 2 · Size + brand, render ─────────────────────────────── */}
      <section className={`rounded-xl border p-3 ${card}`}>
        <p className="text-sm font-bold">{t("worldCatalogLibrary.wpSectionSize")}</p>
        <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label={t("worldCatalogLibrary.wpAriaDeviceSize")}>
          {WALLPAPER_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={presetKey === p.key}
              data-testid={`world-wallpapers-desk-preset-${p.key}`}
              className={chip(presetKey === p.key)}
              onClick={() => setPresetKey(p.key)}
            >
              {p.label} · {p.width}×{p.height}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="world-wallpapers-desk-branded"
            aria-pressed={branded}
            className={chip(branded)}
            onClick={() => setBranded(true)}
          >
            {t("worldCatalogLibrary.wpBrandedFree")}
          </button>
          <button
            type="button"
            data-testid="world-wallpapers-desk-clean"
            aria-pressed={!branded}
            className={chip(!branded)}
            onClick={() => setBranded(false)}
          >
            {t("worldCatalogLibrary.wpCleanCost", { cost: WALLPAPER_CLEAN_RENDER_COST.toLocaleString(i18n.language) })}
          </button>
          <button
            type="button"
            data-testid="world-wallpapers-desk-disclosure"
            aria-pressed={aiDisclosure}
            className={chip(aiDisclosure)}
            onClick={() => setAiDisclosure((v) => !v)}
          >
            {t("worldCatalogLibrary.wpDisclosure", { state: aiDisclosure ? t("worldCatalogLibrary.wpOn") : t("worldCatalogLibrary.wpOff") })}
          </button>
        </div>
        <p className={`mt-2 text-xs ${sub}`} data-testid="world-wallpapers-desk-cost">
          {branded
            ? brandKit?.logoUrl
              ? t("worldCatalogLibrary.wpCostBrandedLogo")
              : t("worldCatalogLibrary.wpCostBrandedName")
            : t("worldCatalogLibrary.wpCostClean", { cost: WALLPAPER_CLEAN_RENDER_COST.toLocaleString(i18n.language) })}
        </p>
        <button
          type="button"
          data-testid="world-wallpapers-desk-render"
          className={`mt-2 ${goldBtn}`}
          disabled={rendering || !currentArt}
          onClick={() => void renderCurrent()}
        >
          {rendering ? t("worldCatalogLibrary.wpRendering") : t("worldCatalogLibrary.wpRenderAt", { width: preset.width, height: preset.height })}
        </button>
        {renderError ? (
          <p className={`mt-2 ${err}`} data-testid="world-wallpapers-desk-render-error">{renderError}</p>
        ) : null}
      </section>

      {/* ── 3 · Pack of 10 ───────────────────────────────────────── */}
      <section className={`rounded-xl border p-3 ${card}`}>
        <p className="text-sm font-bold">{t("worldCatalogLibrary.wpSectionPack")}</p>
        <p className={`mt-0.5 text-xs ${sub}`}>
          {t("worldCatalogLibrary.wpPackIntro", {
            count: WALLPAPER_PACK_OF_10_COUNT,
            cost: WALLPAPER_PACK_OF_10_COST.toLocaleString(i18n.language),
            picked: packSelected.length,
          })}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {packChoices.slice(0, 12).map((url, i) => (
            <button
              key={url}
              type="button"
              data-testid={`world-wallpapers-desk-pack-${i}`}
              aria-pressed={packSelected.includes(url)}
              className={chip(packSelected.includes(url))}
              onClick={() => setPackSelected((prev) => togglePackSelection(prev, url))}
            >
              {t("worldCatalogLibrary.wpPiece", { n: i + 1 })}
              {packSelected.includes(url) ? " ✓" : ""}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="world-wallpapers-desk-pack-run"
          className={`mt-2 ${goldBtn}`}
          disabled={packBusy || !packReady(packSelected)}
          onClick={() => void makePackOf10()}
        >
          {packBusy ? t("worldCatalogLibrary.wpPackBusy") : t("worldCatalogLibrary.wpMakePack", { cost: WALLPAPERS_PACK10_REGISTRY_COST.toLocaleString(i18n.language) })}
        </button>
        {packError ? (
          <p className={`mt-2 ${err}`} data-testid="world-wallpapers-desk-pack-error">{packError}</p>
        ) : null}
      </section>

      {/* ── 4 · Living wallpaper ─────────────────────────────────── */}
      <section className={`rounded-xl border p-3 ${card}`}>
        <p className="text-sm font-bold">{t("worldCatalogLibrary.wpSectionLiving")}</p>
        <p className={`mt-0.5 text-xs ${sub}`}>
          {t("worldCatalogLibrary.wpLivingIntro", {
            clip: WALLPAPERS_CLIP_REGISTRY_COST.toLocaleString(i18n.language),
            render: WALLPAPERS_SCREENSAVER_COST.toLocaleString(i18n.language),
          })}
        </p>
        <div className="mt-2 flex gap-2">
          <input
            data-testid="world-wallpapers-desk-video-prompt"
            aria-label={t("worldCatalogLibrary.wpAriaVideoPrompt")}
            className={inputCls}
            value={videoPrompt}
            onChange={(e) => setVideoPrompt(e.target.value)}
            placeholder={t("worldCatalogLibrary.wpVideoPlaceholder")}
            maxLength={600}
          />
          <button
            type="button"
            data-testid="world-wallpapers-desk-video-generate"
            className={goldBtn}
            disabled={generatingVideo || !videoPrompt.trim()}
            onClick={() => void generateVideo()}
          >
            {generatingVideo ? t("worldCatalogLibrary.wpFilming") : t("worldCatalogLibrary.wpFilmClip")}
          </button>
        </div>
        {videoError ? (
          <p className={`mt-2 ${err}`} data-testid="world-wallpapers-desk-video-error">{videoError}</p>
        ) : null}
        {videoUrl ? (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("worldCatalogLibrary.wpAriaSsSize")}>
              {WALLPAPER_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={ssPresetKey === p.key}
                  data-testid={`world-wallpapers-desk-ss-preset-${p.key}`}
                  className={chip(ssPresetKey === p.key)}
                  onClick={() => setSsPresetKey(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <label className={`block text-xs ${sub}`}>
              {t("worldCatalogLibrary.wpLoopLabel")}
              <input
                data-testid="world-wallpapers-desk-ss-seconds"
                type="number"
                min={10}
                max={120}
                className={`${inputCls} mt-1`}
                value={ssSeconds}
                onChange={(e) => setSsSeconds(Number(e.target.value))}
              />
            </label>
            <button
              type="button"
              data-testid="world-wallpapers-desk-ss-render"
              className={goldBtn}
              disabled={ssBusy}
              onClick={() => void renderScreensaver()}
            >
              {ssBusy ? t("worldCatalogLibrary.wpLooping") : t("worldCatalogLibrary.wpMakeLoop", { cost: WALLPAPERS_SCREENSAVER_COST.toLocaleString(i18n.language) })}
            </button>
            {ssError ? (
              <p className={err} data-testid="world-wallpapers-desk-ss-error">{ssError}</p>
            ) : null}
            {ssResult ? (
              <p className={`text-xs ${sub}`} data-testid="world-wallpapers-desk-ss-result">
                {t("worldCatalogLibrary.wpSsResult", { width: ssResult.width, height: ssResult.height, seconds: ssResult.seconds })}{" "}
                <a
                  href={ssResult.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-[#d4af37] underline"
                >
                  {t("worldCatalogLibrary.wpOpenLoop")}
                </a>
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* ── 5 · This session ─────────────────────────────────────── */}
      {renders.length > 0 ? (
        <section className={`rounded-xl border p-3 ${card}`} data-testid="world-wallpapers-desk-session">
          <p className="text-sm font-bold">{t("worldCatalogLibrary.wpSectionSession")}</p>
          <ul className="mt-2 space-y-1.5">
            {renders.map((r, i) => (
              <li key={`${r.url}-${i}`} className={`flex items-center justify-between gap-2 text-xs ${sub}`}>
                <span>
                  {wallpaperPresetByKeyIn(WALLPAPER_PRESETS, r.presetKey).label} · {r.width}×{r.height}
                </span>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-[#d4af37] underline"
                >
                  {t("worldCatalogLibrary.wpOpen")}
                </a>
              </li>
            ))}
          </ul>
          <button
            type="button"
            data-testid="world-wallpapers-desk-zip"
            className={`mt-2 ${goldBtn}`}
            disabled={zipBusy}
            onClick={() => void downloadPackZip()}
          >
            {zipBusy ? t("worldCatalogLibrary.wpZipBusy") : t("worldCatalogLibrary.wpZipButton")}
          </button>
          {zipError ? <p className={`mt-2 ${err}`}>{zipError}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
