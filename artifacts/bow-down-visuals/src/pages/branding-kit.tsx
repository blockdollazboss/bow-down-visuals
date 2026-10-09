import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Palette, Clapperboard, Tv, Store, Gem } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { LogoMakerTool } from "@/pages/logo-maker";
import { IntrosOutrosTool } from "@/pages/intros-outros";
import { StreamPackTool } from "@/pages/stream-pack";
import BrandingShop from "@/pages/branding-shop";
import JewelryStudio from "@/pages/jewelry";

/* ─── Branding Kit ──────────────────────────────────────────────────────────
   Hub page for the creator brand-identity tools: Logo Studio, Intro & Outro
   Studio, and Stream Bundle. Each tool lives as a named export on its own
   page so it can be used standalone or embedded here behind tabs. */

/* Tab labels translate inside the component (via t()); icons stay static.
   The blurbs are reference metadata and are not rendered on this page. */
type TabKey = "logo" | "intros" | "stream" | "shop" | "jewelry";

export default function BrandingKit() {
  const { t } = useTranslation();
  usePageTitle(t("brandingKit.pageTitle"), "AI brand identity studio for creators — logos, intros, outros, and stream bundles.");
  const [tab, setTab] = useState<TabKey>(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("tab");
      return q === "intros" || q === "stream" || q === "shop" || q === "jewelry" ? q : "logo";
    } catch { return "logo"; }
  });

  const TABS = [
    { key: "logo", label: t("brandingKit.tabs.logo.label"), Icon: Palette },
    { key: "intros", label: t("brandingKit.tabs.intros.label"), Icon: Clapperboard },
    { key: "stream", label: t("brandingKit.tabs.stream.label"), Icon: Tv },
    { key: "shop", label: t("brandingKit.tabs.shop.label", { defaultValue: "Shop" }), Icon: Store },
    { key: "jewelry", label: t("brandingKit.tabs.jewelry.label", { defaultValue: "Jewelry" }), Icon: Gem },
  ] as const;

  return (
    <div className="min-h-screen bg-black text-white">

      {/* Hero */}
      <div className="mx-auto max-w-5xl px-4 pt-12 pb-6 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-primary/70 mb-3">
          {t("brandingKit.eyebrow")}
        </p>
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
          <span className="bg-gradient-to-r from-[#d4af37] via-[#f7e9b8] to-[#d4af37] bg-clip-text text-transparent">
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
      <div className="pb-10">
        {tab === "logo" && <LogoMakerTool key="logo" />}
        {tab === "intros" && <IntrosOutrosTool key="intros" />}
        {tab === "stream" && <StreamPackTool key="stream" />}
        {tab === "shop" && <BrandingShop key="shop" />}
        {tab === "jewelry" && <JewelryStudio key="jewelry" />}
      </div>


    </div>
  );
}
