import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Loader2, Link2Off, BadgeCheck } from "lucide-react";
import { fetchPublicProfile, themeVars, type CreatorProfile } from "@/lib/artist-profiles";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { ProfileSections, ProfileActions } from "@/components/artist/profile-sections";
import { FloatingThemeToggle } from "@/components/FloatingThemeToggle";
import { JsonLd } from "@/components/seo/json-ld";
import { MAIN_SITE_URL, isMainAppHost, resolveSite } from "@/lib/domains";

/* ─── Site Mode — Worker 10: the creator's OWN website ───────────────────────
   When the app boots on a hostname that ISN'T the main Bow Down Visuals
   domain (a creator's custom domain, or their free <slug>.bowdownvisuals.com),
   we resolve it to a profile slug and render that creator's full page as a
   standalone branded site: their theme, their name in the tab, their content —
   with only a small "Powered by Bow Down Visuals" badge for BDV chrome.

   LINK GRAPH (standing rule — "everything have to link together well"):
   every in-site link stays RELATIVE (the profile section renderer already is:
   /artist/…, /my-shop?artist=…, /tour, /brand-deals…), so profile → store →
   content → social all keep working on whatever domain serves them. The ONLY
   absolute URL is the PoweredBy badge → MAIN_SITE_URL (one constant, in
   @/lib/domains.ts, overridable via VITE_MAIN_SITE_URL).

   MOUNT: the coordinator mounts <SiteModeGate> in App.tsx — see
   SITE_MODE_MOUNT.md for the exact lines. This file is mount-agnostic.
*/

const SOCIAL_ICONS: Record<string, string> = {
  instagram: "📸", tiktok: "🎵", youtube: "▶️", x: "𝕏",
  twitch: "🎮", spotify: "🟢", website: "🌐",
};

/** Tiny gold loader shown while we decide site-mode vs normal app. No app chrome.
    Stack-28 (A4-F1): the splash follows the visitor's theme like every
    other surface — it was hardcoded bg-black in both themes — and it
    carries the floating theme toggle, because SiteModeGate renders
    INSTEAD of AppShell (where the toggle normally lives): without a
    mount here, a custom-domain visitor had no sun/moon anywhere. */
function SiteModeSplash() {
  const isLight = useIsLightTheme();
  return (
    <div
      className={`flex min-h-screen items-center justify-center ${isLight ? "bg-[#FAF7F0]" : "bg-black"}`}
    >
      <FloatingThemeToggle />
      <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
    </div>
  );
}

/**
 * The gate. Render this INSTEAD of <AppShell /> (inside all providers —
 * follow/tip/share on the creator's site need them). Children render when
 * we're on the main app domain or the host doesn't resolve to a creator.
 */
export function SiteModeGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<"checking" | "site" | "app">("checking");
  const [slug, setSlug] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const host = window.location.hostname;
    if (isMainAppHost(host)) {
      setPhase("app");
      return;
    }
    (async () => {
      const r = await resolveSite(host);
      if (cancelled) return;
      if (r?.slug) {
        setSlug(r.slug);
        setPhase("site");
      } else {
        setPhase("app");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === "checking") return <SiteModeSplash />;
  if (phase === "site" && slug) return <SiteMode slug={slug} />;
  return <>{children}</>;
}

/** Small badge pinned to the creator's site — links back to the main site. */
export function PoweredByBadge() {
  return (
    <div className="flex justify-center px-4 pb-10">
      <a
        href={MAIN_SITE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded-full border border-amber-400/30 bg-black/60 px-4 py-2 text-xs font-semibold text-white/60 backdrop-blur transition hover:scale-105 hover:text-amber-300"
      >
        <BadgeCheck className="h-4 w-4 text-amber-400" />
        Powered by Bow Down Visuals — the content creator cheat code
      </a>
    </div>
  );
}

/** The creator's full standalone site, rendered on their domain. */
export function SiteMode({ slug }: { slug: string }) {
  const isLight = useIsLightTheme();
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await fetchPublicProfile(slug);
        if (!cancelled) {
          if (p.is_public) setProfile(p);
          else setNotFound(true);
        }
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Their site, their name in the tab — no BDV suffix on a custom domain.
  useEffect(() => {
    if (profile) document.title = profile.display_name;
  }, [profile]);

  if (loading) return <SiteModeSplash />;

  if (notFound || !profile) {
    return (
      <>
        <FloatingThemeToggle />
        <div
          className={`flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center ${isLight ? "bg-[#FAF7F0]" : "bg-black"}`}
        >
          <Link2Off className="h-10 w-10 text-amber-400/50" />
          <h1 className={`text-xl font-bold ${isLight ? "text-[#1C1712]" : "text-white"}`}>
            This domain isn't connected yet.
          </h1>
          <p className={`max-w-sm text-sm ${isLight ? "text-[#6B6257]" : "text-white/50"}`}>
            The DNS handshake is still in flight, or the creator's page isn't public. Check back soon.
          </p>
          <a
            href={MAIN_SITE_URL}
            className="mt-2 rounded-full bg-amber-400 px-6 py-2.5 text-sm font-bold text-black transition hover:scale-105"
          >
            Build my own site
          </a>
        </div>
      </>
    );
  }

  const socials = Object.entries(profile.social_links ?? {}).filter(([, v]) => v);

  return (
    <>
      {/* A4-F1: the floating toggle mounts in the SiteMode shell itself —
          AppShell (its normal home) never renders on a custom domain. */}
      <FloatingThemeToggle />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          name: profile.display_name,
          description: profile.bio?.split("\n")[0] || `${profile.display_name}'s official site`,
          mainEntity: {
            "@type": "Person",
            name: profile.display_name,
            description: profile.bio || undefined,
            image: profile.avatar_url || undefined,
          },
        }}
      />
      {/* Twin of the /artist/:slug root (pages/artist-public.tsx): the
          profile's panels follow the SITE theme — themeVars' light
          palette (ivory + bronze) when the visitor's theme is light,
          the creator's own colorway in dark — and data-dark-lock +
          ap-profile-root exempt the subtree from the light theme's
          global class remaps (which would otherwise paint the site's
          palace backdrop over the creator's ground). The creator's
          banner art and on-art ink keep their colorway in both. */}
      <div
        className="min-h-screen ap-profile-root"
        data-dark-lock
        style={{
          ...themeVars(profile.theme_config, isLight),
          backgroundColor: "var(--ap-bg)",
          color: "var(--ap-text)",
          fontFamily: "var(--ap-body-font)",
        }}
      >
        {/* Full link graph: the same section renderer as /artist/:slug —
            profile → store → content → social, all relative links. */}
        <ProfileSections profile={profile} mode="public" />
        <ProfileActions profile={profile} />
        {socials.length > 0 && (
          <div className="flex justify-center gap-2 px-4 pb-6">
            {socials.map(([platform, url]) => (
              <a
                key={platform}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={platform}
                title={platform}
                className="flex h-10 w-10 items-center justify-center rounded-full border text-lg transition hover:scale-110"
                style={{ borderColor: "var(--ap-border)", backgroundColor: "var(--ap-card)" }}
              >
                {SOCIAL_ICONS[platform] ?? "🔗"}
              </a>
            ))}
          </div>
        )}
        <PoweredByBadge />
      </div>
    </>
  );
}
