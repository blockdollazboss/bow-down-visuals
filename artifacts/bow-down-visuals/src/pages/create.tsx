import { useEffect, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Layers, Mic2, Music, Video, Clapperboard, Disc3, Users, Link2, Play, Sparkles, ScanSearch, Image as ImageIcon, type LucideIcon } from "lucide-react";
import { buildSchedulerHref } from "@/lib/scheduler-handoff";
import { usePageTitle } from "@/hooks/use-page-title";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { getLibraryTemplate, type LibraryTemplate } from "@/data/library-templates";
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
import { WallpapersDesk } from "@/components/wallpapers/WallpapersDesk";

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

export type CreatePanel = "song-video" | "song" | "video" | "hub" | "cartoon" | "coverart" | "dream-collab" | "link-to-hit" | "cover-motion" | "wallpapers";

const PANELS: Array<{ key: CreatePanel; labelKey: string; blurbKey: string; icon: LucideIcon }> = [
  { key: "song-video", labelKey: "songVideo", blurbKey: "songVideoBlurb", icon: Mic2 },
  { key: "song", labelKey: "song", blurbKey: "songBlurb", icon: Music },
  { key: "video", labelKey: "video", blurbKey: "videoBlurb", icon: Video },
  { key: "cartoon", labelKey: "cartoon", blurbKey: "cartoonBlurb", icon: Clapperboard },
  { key: "coverart", labelKey: "coverArt", blurbKey: "coverArtBlurb", icon: Disc3 },
  { key: "dream-collab", labelKey: "dreamCollab", blurbKey: "dreamCollabBlurb", icon: Users },
  { key: "link-to-hit", labelKey: "linkToHit", blurbKey: "linkToHitBlurb", icon: Link2 },
  { key: "cover-motion", labelKey: "coverMotion", blurbKey: "coverMotionBlurb", icon: Play },
  { key: "wallpapers", labelKey: "wallpapers", blurbKey: "wallpapersBlurb", icon: ImageIcon },
  { key: "hub", labelKey: "hub", blurbKey: "hubBlurb", icon: Layers },
];

function isPanel(p: string | null): p is CreatePanel {
  return p === "song-video" || p === "song" || p === "video" || p === "hub" || p === "cartoon" || p === "coverart" || p === "dream-collab" || p === "link-to-hit" || p === "cover-motion" || p === "wallpapers";
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
  const isLight = useIsLightTheme();
  /* wouter's useSearch is SSR-safe here (entry-server passes ssrPath) and
     re-renders on every history change, including same-path ?panel= swaps. */
  const search = useSearch();
  const [panel, setPanel] = useState<CreatePanel>(() => panelFromSearch(search));

  /* Social template deep-link: ?template=<slug> from Thy Library. The /create
     hub has no social-visual tool — social posts are drafted in the social
     composer (Feed / Scheduler). We surface the template as a banner with a
     one-tap handoff that pre-drafts the post in the scheduler. */
  const [socialTemplate, setSocialTemplate] = useState<LibraryTemplate | null>(null);
  useEffect(() => {
    try {
      const slug = new URLSearchParams(window.location.search).get("template");
      if (!slug) return;
      const tpl = getLibraryTemplate(slug);
      if (tpl && tpl.category === "Social Posts") setSocialTemplate(tpl);
    } catch {
      /* non-browser or malformed URL — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /* Tab-pattern keyboard support (WCAG/ARIA tabs): roving tabindex —
     only the active tab is in the Tab order; Arrow keys move between
     tabs (automatic activation, matching the click behaviour), Home/End
     jump to the ends. Refs keyed by panel so focus follows selection. */
  const tabRefs = useRef<Partial<Record<CreatePanel, HTMLButtonElement | null>>>({});
  function onTablistKeyDown(e: React.KeyboardEvent) {
    const idx = PANELS.findIndex((p) => p.key === panel);
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIdx = (idx + 1) % PANELS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") nextIdx = (idx - 1 + PANELS.length) % PANELS.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = PANELS.length - 1;
    if (nextIdx === null) return;
    e.preventDefault();
    const next = PANELS[nextIdx]!;
    switchPanel(next.key);
    tabRefs.current[next.key]?.focus();
  }

  return (
    <div className="min-h-screen bg-black text-white lux-page">

      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-5 md:px-8 py-10 md:py-14">

        {/* Breadcrumb */}
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          {t("create.backToDashboard")}
        </Link>

        {/* Header */}
        <div className="mb-10">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-[#d4a017]/40 bg-[#d4a017]/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-primary">
            <Sparkles className="h-3 w-3" />
            {t("create.kicker", { defaultValue: "Thy Lab" })}
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">
            {t("create.title")}
          </h1>
          <p className="text-white/50 text-base md:text-lg max-w-2xl">
            {t("create.subtitle")}
          </p>
        </div>

        {/* Social template handoff banner */}
        {socialTemplate && (
          <div className="mb-8 flex flex-wrap items-center gap-3 rounded-2xl border border-[#c9a84c]/40 bg-[#c9a84c]/[0.07] px-5 py-4">
            <span className="text-2xl" aria-hidden="true">{socialTemplate.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">
                {t("create.socialTemplateReady", { defaultValue: "Template ready" })}: {socialTemplate.title}
              </p>
              <p className="text-xs text-white/50 mt-0.5">{socialTemplate.blurb}</p>
            </div>
            <Link
              href={buildSchedulerHref({ caption: `${socialTemplate.emoji} ${socialTemplate.title} — ${socialTemplate.blurb}` })}
              className="rounded-full bg-[#c9a84c] text-black text-xs font-black px-4 py-2 hover:bg-[#e8c86a] transition shrink-0"
            >
              {t("create.draftSocialPost", { defaultValue: "Draft this post" })}
            </Link>
            <button
              type="button"
              onClick={() => setSocialTemplate(null)}
              aria-label={t("create.dismiss", { defaultValue: "Dismiss" })}
              className="flex h-10 w-10 items-center justify-center text-white/50 hover:text-white text-lg leading-none shrink-0"
            >
              ×
            </button>
          </div>
        )}

        {/* Lane picker — responsive card grid (9 lanes need room; the old
            tab strip crushed labels and overflowed its pill) */}
        <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 max-w-4xl" role="tablist" aria-label={t("create.title")} onKeyDown={onTablistKeyDown}>
          {PANELS.map(({ key, labelKey, blurbKey, icon: Icon }) => {
            const active = panel === key;
            return (
              <button
                key={key}
                ref={(el) => { tabRefs.current[key] = el; }}
                id={`create-tab-${key}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="create-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => switchPanel(key)}
                className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition ${
                  active
                    ? "border-transparent bg-gradient-to-br from-[#fbbf24] to-[#d4a017] text-black shadow-[0_0_24px_rgba(212,160,23,0.35)]"
                    : isLight
                      ? "border-stone-200 bg-white text-stone-800 shadow-sm hover:border-[#d4a017]/60 hover:shadow"
                      : "border-white/10 bg-white/[0.04] text-white hover:border-white/25 hover:bg-white/[0.08]"
                }`}
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  active
                    ? "bg-black/15 text-black"
                    : "bg-[#d4a017]/15 text-[#fbbf24]"
                }`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">
                    {t(`create.modes.${labelKey}`)}
                  </span>
                  <span className={`block truncate text-xs ${
                    active ? "text-black/70" : isLight ? "text-stone-500" : "text-white/50"
                  }`}>
                    {t(`create.modes.${blurbKey}`)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Mode panel — original max-widths preserved per craft */}
        <div
          id="create-panel"
          role="tabpanel"
          aria-labelledby={`create-tab-${panel}`}
          tabIndex={0}
          className={`mx-auto w-full ${panel === "hub" ? "max-w-7xl" : panel === "song-video" ? "max-w-3xl" : "max-w-4xl"}`}
        >
          {panel === "song-video" && <SongAndVideoModule />}
          {panel === "song" && <MakeSongModule />}
          {panel === "video" && <MakeVideoModule />}
          {panel === "cartoon" && <CartoonStudio initialTab="video" />}
          {panel === "coverart" && <CoverArt />}
          {panel === "dream-collab" && <DreamCollabPanel />}
          {panel === "link-to-hit" && <LinkToHitPanel />}
          {panel === "cover-motion" && <CoverInMotionPanel />}
          {panel === "wallpapers" && <WallpapersDesk />}
          {panel === "hub" && <HubModule />}
        </div>

        {/* Phase 3 orphan rescue: the Media Detector's only inbound path
            was a hub workflow — the Create front door names it too. */}
        <div className="mx-auto mt-10 w-full max-w-4xl px-1 text-center">
          <Link
            href="/detector"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/55 transition hover:border-[#d4a017]/50 hover:text-[#fbbf24]"
          >
            <ScanSearch className="h-4 w-4" />
            {t("create.moreTools.detector", { defaultValue: "Media Detector — check a file's story before you post it" })}
          </Link>
        </div>
      </div>
    </div>
  );
}
