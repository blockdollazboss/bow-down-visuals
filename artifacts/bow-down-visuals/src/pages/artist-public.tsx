import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { Loader2, Link2Off } from "lucide-react";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import type { CreatorProfile } from "@/lib/artist-profiles";
import { fetchPublicProfile, themeVars } from "@/lib/artist-profiles";
import {
  HeroSection, ProfileActions, ProfileSections, MadeWithBadge,
} from "@/components/artist/profile-sections";

/* ─── Public creator profile — /artist/:slug (coordinator wires the route) ──
   Renders the creator's theme_config + sections. Themed head-to-toe via
   safe CSS tokens. Featured media is CLICK-TO-PLAY (never autoplay with
   sound). Includes follow, tip jar, share (?ref=), and the
   "Made with Bow Down Visuals" badge. */

const SOCIAL_ICONS: Record<string, string> = {
  instagram: "📸", tiktok: "🎵", youtube: "▶️", x: "𝕏",
  twitch: "🎮", spotify: "🟢", website: "🌐",
};

export default function ArtistPublic() {
  const [, params] = useRoute("/artist/:slug");
  const slug = params?.slug ?? "";
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await fetchPublicProfile(slug);
        if (!cancelled) setProfile(p.is_public ? p : null);
        if (!cancelled && !p.is_public) setNotFound(true);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  usePageTitle(
    profile ? `${profile.display_name} — Bow Down Visuals` : "Creator Profile — Bow Down Visuals",
    profile ? `${profile.display_name}. ${profile.bio?.split("\n")[0] ?? "Music, videos, merch, and more — all in one place."}` : "A creator profile on Bow Down Visuals."
  );

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 bg-black px-4 text-center">
        <Link2Off className="h-10 w-10 text-white/30" />
        <h1 className="text-xl font-bold text-white">This page doesn't exist — yet.</h1>
        <p className="max-w-sm text-sm text-white/50">
          The creator hasn't published their page, or the link is off. Build yours in minutes.
        </p>
        <Link href="/artist-setup" className="mt-2 rounded-full bg-amber-400 px-6 py-2.5 text-sm font-bold text-black transition hover:scale-105">
          Build my page
        </Link>
      </div>
    );
  }

  const socials = Object.entries(profile.social_links ?? {}).filter(([, v]) => v);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          name: `${profile.display_name} — Bow Down Visuals`,
          description: profile.bio?.split("\n")[0] || `${profile.display_name}'s creator page`,
          url: `/artist/${profile.slug}`,
          mainEntity: {
            "@type": "Person",
            name: profile.display_name,
            description: profile.bio || undefined,
            image: profile.avatar_url || undefined,
          },
        }}
      />
      <div
        className="min-h-screen"
        style={{
          ...themeVars(profile.theme_config),
          backgroundColor: "var(--ap-bg)",
          color: "var(--ap-text)",
          fontFamily: "var(--ap-body-font)",
        }}
      >
        {/* Hero is rendered first by the sections renderer (hero is always first) */}
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
        <MadeWithBadge referralCode={profile.referral_code} />
      </div>
    </>
  );
}
