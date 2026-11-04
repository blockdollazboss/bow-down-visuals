import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Palette, Clapperboard, Loader2, Tv, Store, Gem, ArrowRight, Camera, Fingerprint, Image } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { BrandKitPanel } from "@/components/branding/BrandKitPanel";
import { BrowseLibraryButton } from "@/pages/library";

/* The seven non-default tab tools ride lazy doors (site-perf,
   stack1300): the kit renders exactly ONE tab at a time, so the
   logo maker, intros/outros, stream pack, headshots, shop,
   jewelry and wallpapers tools — three of them whole sibling
   pages — no longer ride /branding-kit's first load. The
   default brand tab (BrandKitPanel) stays static, so the
   landing's first paint is unchanged. Each tool chunk fetches
   on first tab selection and is cached for later switches. */
const LogoMakerTool = lazy(() => import("@/pages/logo-maker").then((m) => ({ default: m.LogoMakerTool })));
const IntrosOutrosTool = lazy(() => import("@/pages/intros-outros").then((m) => ({ default: m.IntrosOutrosTool })));
const StreamPackTool = lazy(() => import("@/pages/stream-pack").then((m) => ({ default: m.StreamPackTool })));
const BrandingShop = lazy(() => import("@/components/branding/BrandingShop"));
const JewelryStudio = lazy(() => import("@/components/branding/JewelryStudio"));
const HeadshotStudio = lazy(() => import("@/components/photo/HeadshotStudio").then((m) => ({ default: m.HeadshotStudio })));
const WallpapersDesk = lazy(() => import("@/components/wallpapers/WallpapersDesk").then((m) => ({ default: m.WallpapersDesk })));

/* The tab stage's loading frame: gold spinner — a tab switch
   reads as "opening", never a blank hole. */
function BrandingTabFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[240px] items-center justify-center gap-3 text-white/50" role="status">
      <Loader2 className="h-5 w-5 animate-spin text-[#d4a017]" />
      <span className="text-sm">{t("common.loading")}</span>
    </div>
  );
}

/* ─── Branding Kit ──────────────────────────────────────────────────────────
   Hub page for the creator brand-identity tools: Logo Studio, Intro & Outro
   Studio, and Stream Bundle. Each tool lives as a named export on its own
   page so it can be used standalone or embedded here behind tabs. */

/* Tab labels translate inside the component (via t()); icons stay static.
   The blurbs are reference metadata and are not rendered on this page. */
type TabKey = "brand" | "logo" | "intros" | "stream" | "headshots" | "shop" | "jewelry" | "wallpapers";

export default function BrandingKit() {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  usePageTitle(t("brandingKit.pageTitle"), "AI brand identity studio for creators — logos, intros, outros, and stream bundles.");
  const [tab, setTab] = useState<TabKey>(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("tab");
      return q === "logo" || q === "intros" || q === "stream" || q === "headshots" || q === "shop" || q === "jewelry" || q === "wallpapers" ? q : "brand";
    } catch { return "brand"; }
  });

  const TABS = [
    { key: "brand", label: t("brandingKit.tabs.brand.label", { defaultValue: "Brand Kit" }), Icon: Fingerprint },
    { key: "logo", label: t("brandingKit.tabs.logo.label"), Icon: Palette },
    { key: "intros", label: t("brandingKit.tabs.intros.label"), Icon: Clapperboard },
    { key: "stream", label: t("brandingKit.tabs.stream.label"), Icon: Tv },
    { key: "headshots", label: t("brandingKit.tabs.headshots.label", { defaultValue: "Headshots" }), Icon: Camera },
    { key: "shop", label: t("brandingKit.tabs.shop.label", { defaultValue: "Shop" }), Icon: Store },
    { key: "jewelry", label: t("brandingKit.tabs.jewelry.label", { defaultValue: "Jewelry" }), Icon: Gem },
    { key: "wallpapers", label: t("brandingKit.tabs.wallpapers.label", { defaultValue: "Wallpapers & Themes" }), Icon: Image },
  ] as const;

  return (
    <div className="bg-black text-white">

      {/* Hero */}
      <div className="relative mx-auto max-w-5xl px-4 pt-12 pb-6 text-center">
        {/* ambient gold glow */}
        <div className="pointer-events-none absolute inset-x-0 -top-8 flex justify-center" aria-hidden="true">
          <div className="h-[220px] w-[520px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>
        <p className="relative mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-primary">
          {t("brandingKit.eyebrow")}
        </p>
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
          <span className="branding-kit-title bg-gradient-to-r from-[#d4af37] via-[#f7e9b8] to-[#d4af37] bg-clip-text text-transparent">
            {t("brandingKit.title")}
          </span>
        </h1>
        <p className="mt-3 text-sm text-white/45 max-w-xl mx-auto">
          {t("brandingKit.subtitle")}
        </p>
      </div>

      {/* Tab bar */}
      <div className="mx-auto max-w-5xl px-4">
        <div className="flex flex-wrap justify-center gap-2 border-b border-white/[0.08] pb-4">
          {TABS.map(({ key, label, Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`relative flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition border ${
                  active
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : isLight
                      ? "border-[#c9a84c]/30 bg-[#FDFBF5] text-[#4A3B22] hover:text-[#8a6d2f] hover:border-[#c9a84c]/50"
                      : "border-white/10 bg-white/[0.02] text-white/50 hover:text-white/85 hover:border-white/25"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
                {active && (
                  <span className="absolute -bottom-[17px] left-1/2 h-[3px] w-2/3 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#d4af37] to-[#f7e9b8]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active tool */}
      <div className="mx-auto max-w-5xl px-4 mb-4 flex justify-end">
        <BrowseLibraryButton tab="templates" category="Intros & Outros" tool="brand" />
      </div>
      {/* Handoff: brand assets belong in videos — one tap into the editor */}
      {(tab === "brand" || tab === "logo" || tab === "intros") && (
        <div className="mx-auto max-w-5xl px-4 mb-4">
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-primary/25 bg-primary/[0.05] p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/[0.10]">
              <Clapperboard className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <p className="min-w-[200px] flex-1 text-sm text-white/70">
              <span className="font-black text-white">{t("brandingKit.useInEditorTitle", { defaultValue: "Made your brand? Put it in motion." })}</span>{" "}
              <span className="text-white/50">{t("brandingKit.useInEditorSub", { defaultValue: "Drop this straight into the video editor." })}</span>
            </p>
            <Link href="/video-editor">
              <span className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110">
                {t("brandingKit.useInEditor", { defaultValue: "Use in editor" })}<ArrowRight className="h-4 w-4" aria-hidden="true" />
              </span>
            </Link>
          </div>
        </div>
      )}
      <div className="pb-10">
        {tab === "brand" && <BrandKitPanel key="brand" />}
        <Suspense fallback={<BrandingTabFallback />}>
          {tab === "logo" && <LogoMakerTool key="logo" />}
          {tab === "intros" && <IntrosOutrosTool key="intros" />}
          {tab === "stream" && <StreamPackTool key="stream" />}
          {tab === "headshots" && <HeadshotStudio key="headshots" />}
          {tab === "shop" && <BrandingShop key="shop" />}
          {tab === "jewelry" && <JewelryStudio key="jewelry" />}
          {tab === "wallpapers" && <WallpapersDesk key="wallpapers" />}
        </Suspense>
      </div>


    </div>
  );
}
