import { useState } from "react";
import { Palette, Clapperboard, Tv } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { usePageTitle } from "@/hooks/use-page-title";
import { LogoMakerTool } from "@/pages/logo-maker";
import { IntrosOutrosTool } from "@/pages/intros-outros";
import { StreamPackTool } from "@/pages/stream-pack";

/* ─── Branding Kit ──────────────────────────────────────────────────────────
   Hub page for the creator brand-identity tools: Logo Studio, Intro & Outro
   Studio, and Stream Bundle. Each tool lives as a named export on its own
   page so it can be used standalone or embedded here behind tabs. */

const TABS = [
  { key: "logo", label: "Logo Studio", blurb: "AI brand marks in seconds", Icon: Palette },
  { key: "intros", label: "Intro & Outro Studio", blurb: "Branded 5-second video stings", Icon: Clapperboard },
  { key: "stream", label: "Stream Bundle", blurb: "Overlays, alerts & panels", Icon: Tv },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function BrandingKit() {
  usePageTitle("Branding Kit", "AI brand identity studio for creators — logos, intros, outros, and stream bundles.");
  const [tab, setTab] = useState<TabKey>("logo");

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      {/* Hero */}
      <div className="mx-auto max-w-5xl px-4 pt-12 pb-6 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-primary/70 mb-3">
          Brand Identity
        </p>
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
          <span className="bg-gradient-to-r from-[#d4af37] via-[#f7e9b8] to-[#d4af37] bg-clip-text text-transparent">
            Branding Kit
          </span>
        </h1>
        <p className="mt-3 text-sm text-white/45 max-w-xl mx-auto">
          Everything your channel needs to look premium — logos, video stings,
          and a full stream bundle, all generated in one matching identity.
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
      </div>

      <SiteFooter />
    </div>
  );
}
