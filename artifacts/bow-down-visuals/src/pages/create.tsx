import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Layers, Mic2, Music, Video, Clapperboard, Disc3, Users, Link2, Play, type LucideIcon } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { CreateRedirect } from "@/components/create-redirect";
import { MakeSongModule } from "./make-song";
import { MakeVideoModule } from "./make-video";
import CartoonStudio from "@/pages/cartoon-studio";
import CoverArt from "@/pages/cover-art";
import DreamCollabPanel from "@/components/create/DreamCollabPanel";
import LinkToHitPanel from "@/components/create/LinkToHitPanel";
import CoverInMotionPanel from "@/components/create/CoverInMotionPanel";
import { SongAndVideoModule } from "./song-and-video";
import { HubModule } from "./hub";

/* Re-exported for App.tsx's convenience — the implementation lives in
   components/create-redirect.tsx so importing it never pulls this page's
   (heavy) bundle. */
export { CreateRedirect };

/* ─── Create — one unified creation page ─────────────────────────────────
   Merges the four competing start pages (/hub, /song-and-video, /make-song,
   /make-video) into mode panels on a single canonical URL.

   - Canonical URL: /create (the memorable entry).
   - ?panel= selects the mode: song-video (default — preserves the old
     /create → Simple song+video entry), song, video, hub. Named "panel"
     because ?mode= is already taken by /make-song's ?mode=inspo deep link.
   - The old URLs survive as query-preserving redirects (see App.tsx) so
     every existing link, deep link (?mode=inspo, ?tab=mashup&songA=&songB=,
     ?sound=…), and handoff keeps working.
   - Tab pattern follows pages/branding-shop.tsx: mode from URLSearchParams,
     t("create.modes.*") labels.
   - Inactive panels unmount — exactly like the old separate-page navigations,
     so each wizard's mount logic (draft restore, deep-link intake) runs fresh. */

export type CreatePanel = "song-video" | "song" | "video" | "hub" | "cartoon" | "coverart" | "dream-collab" | "link-to-hit" | "cover-motion";

const PANELS: Array<{ key: CreatePanel; labelKey: string; icon: LucideIcon }> = [
  { key: "song-video", labelKey: "songVideo", icon: Mic2 },
  { key: "song", labelKey: "song", icon: Music },
  { key: "video", labelKey: "video", icon: Video },
  { key: "cartoon", labelKey: "cartoon", icon: Clapperboard },
  { key: "coverart", labelKey: "coverArt", icon: Disc3 },
  { key: "dream-collab", labelKey: "dreamCollab", icon: Users },
  { key: "link-to-hit", labelKey: "linkToHit", icon: Link2 },
  { key: "cover-motion", labelKey: "coverMotion", icon: Play },
  { key: "hub", labelKey: "hub", icon: Layers },
];

function isPanel(p: string | null): p is CreatePanel {
  return p === "song-video" || p === "song" || p === "video" || p === "hub" || p === "cartoon" || p === "coverart" || p === "dream-collab" || p === "link-to-hit" || p === "cover-motion";
}

function panelFromSearch(search: string): CreatePanel {
  try {
    const p = new URLSearchParams(search).get("panel");
    if (isPanel(p)) return p;
  } catch {
    /* non-browser or malformed URL — fall through to default */
  }
  return "song-video";
}

export default function Create() {
  const { t } = useTranslation();
  /* wouter's useSearch is SSR-safe here (entry-server passes ssrPath) and
     re-renders on every history change, including same-path ?panel= swaps. */
  const search = useSearch();
  const [panel, setPanel] = useState<CreatePanel>(() => panelFromSearch(search));

  /* Stay in sync when something else navigates to /create?panel=… (sidebar,
     deep links, the old-URL redirects). Only an explicit panel= param moves
     the state — modules consume one-time deep-link params (?mode=inspo,
     ?sound=…) via replaceState on mount, and that must NOT reset the panel. */
  useEffect(() => {
    const next = panelFromSearch(search);
    const hasExplicitPanel = (() => {
      try {
        return isPanel(new URLSearchParams(search).get("panel"));
      } catch {
        return false;
      }
    })();
    if (hasExplicitPanel) setPanel((prev) => (prev === next ? prev : next));
  }, [search]);

  const activeLabel = t(`create.modes.${PANELS.find((p) => p.key === panel)!.labelKey}`);
  usePageTitle(`${t("create.title")} — ${activeLabel}`, t("create.pageDescription"));

  function switchPanel(next: CreatePanel) {
    setPanel(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("panel", next);
      window.history.replaceState(null, "", url.pathname + url.search);
    } catch {
      /* non-browser — ignore */
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="min-h-screen bg-black text-white lux-page">

      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-5 md:px-8 py-10 md:py-14">

        {/* Breadcrumb */}
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          {t("create.backToDashboard")}
        </Link>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-3">
            {t("create.title")}
          </h1>
          <p className="text-white/50 text-base md:text-lg max-w-2xl">
            {t("create.subtitle")}
          </p>
        </div>

        {/* Mode tabs — branding-shop pattern */}
        <div className="mb-10 flex gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5 max-w-3xl">
          {PANELS.map(({ key, labelKey, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => switchPanel(key)}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition flex items-center justify-center gap-2 ${
                panel === key
                  ? "bg-gradient-to-r from-amber-500 to-yellow-400 text-black"
                  : "text-white/50 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t(`create.modes.${labelKey}`)}
            </button>
          ))}
        </div>

        {/* Mode panel — original max-widths preserved per craft */}
        <div className={`mx-auto w-full ${panel === "hub" ? "max-w-7xl" : panel === "song-video" ? "max-w-3xl" : "max-w-4xl"}`}>
          {panel === "song-video" && <SongAndVideoModule />}
          {panel === "song" && <MakeSongModule />}
          {panel === "video" && <MakeVideoModule />}
          {panel === "cartoon" && <CartoonStudio initialTab="video" />}
          {panel === "coverart" && <CoverArt />}
          {panel === "dream-collab" && <DreamCollabPanel />}
          {panel === "link-to-hit" && <LinkToHitPanel />}
          {panel === "cover-motion" && <CoverInMotionPanel />}
          {panel === "hub" && <HubModule />}
        </div>
      </div>
    </div>
  );
}
