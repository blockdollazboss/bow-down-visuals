import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { Loader2, Link2Off, Crown, BadgeCheck, AlertTriangle, RotateCcw } from "lucide-react";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import type { CreatorProfile, ProfileSection } from "@/lib/artist-profiles";
import { fetchPublicProfile, themeVars } from "@/lib/artist-profiles";
import {
  ProfileActions, ProfileSectionByType, MadeWithBadge,
} from "@/components/artist/profile-sections";
import TrophyShelf from "@/components/artist/TrophyShelf";
import RoyalCourtSection from "@/components/artist/RoyalCourtSection";
import SpotlightPinSection from "@/components/artist/SpotlightPinSection";
import ProfileStoreSection from "@/components/artist/ProfileStoreSection";
import ProfileMembershipsSection from "@/components/artist/ProfileMembershipsSection";
import {
  fetchPublicLayout,
  grandStageFallbackBlocks,
  type ProfileBlockDto,
} from "@/lib/profile-website";
import { EmbedButton } from "@/components/player/EmbedButton";

/* ─── Recruiter badge (virality wave) — the creator's Kingpin referral rank,
   rendered on their public profile so visitors see proof of their pull. */
function RecruiterBadge({ badge }: { badge: NonNullable<CreatorProfile["recruiter_badge"]> }) {
  return (
    <div className="flex justify-center px-4 pb-4">
      <a
        href="/referrals"
        className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-4 py-1.5 text-xs font-bold text-amber-300 transition hover:bg-amber-400/20"
        title={`${badge.signups} creators recruited · ${badge.ratePct}% referral cut`}
      >
        <Crown className="h-3.5 w-3.5" />
        {badge.title} Recruiter · {"★".repeat(badge.stars)}
        <span className="text-amber-300/60 font-semibold">{badge.signups} recruited</span>
      </a>
    </div>
  );
}

/* ─── Official badge — house/company accounts (migration 0125). Today this
   is Thy Cheat Code: the site's host and everybody's first friend. ── */
function OfficialBadge() {
  return (
    <div className="flex justify-center px-4 pb-4">
      <span
        className="inline-flex items-center gap-2 rounded-full border border-[#d4af37]/50 bg-[#d4af37]/10 px-4 py-1.5 text-xs font-bold text-[#e8c86a]"
        title="The official Bow Down Visuals account — Thy Cheat Code is everybody's first friend 🦈"
      >
        <BadgeCheck className="h-3.5 w-3.5" />
        Official · Bow Down Visuals
      </span>
    </div>
  );
}

/* ─── Live now badge — the creator is broadcasting natively on the site
   (GET /api/live-streams/profile/:slug). Links straight to the watch page. */
function LiveNowBadge({ slug }: { slug: string }) {
  const [live, setLive] = useState<{ id: string; title: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/live-streams/profile/${encodeURIComponent(slug)}`);
        if (!res.ok) return;
        const d = (await res.json()) as { stream: { id: string; title: string } | null };
        if (!cancelled) setLive(d.stream);
      } catch {
        /* badge just stays hidden — the profile itself already loaded */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);
  if (!live) return null;
  return (
    <div className="flex justify-center px-4 pb-4">
      <Link
        href={`/live/${live.id}`}
        className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-1.5 text-xs font-black uppercase tracking-wider text-white shadow-[0_0_20px_rgba(220,38,38,0.45)] transition hover:bg-red-500"
        title={live.title}
        data-testid="profile-live-badge"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
        </span>
        Live now — watch
      </Link>
    </div>
  );
}

/* ─── Public creator profile — /artist/:slug (coordinator wires the route) ──
   The profile IS the website: the page renders the creator's block
   layout in order — for an untouched profile that's the Grand Stage
   composition (The Stage → The Front Row → Music → Videos → Store →
   Memberships under the masthead, Royal Gold house theme), and an
   owner's saved arrangement wins when one exists. If the layout read
   fails, the page falls back to the same Grand Stage order built from
   the profile's own sections — it never breaks over a layout call.
   Themed head-to-toe via safe CSS tokens. Featured media is
   CLICK-TO-PLAY (never autoplay with sound). Includes follow, tip jar,
   share (?ref=), and the "Made with Bow Down Visuals" badge. */

const SOCIAL_ICONS: Record<string, string> = {
  instagram: "📸", tiktok: "🎵", youtube: "▶️", x: "𝕏",
  twitch: "🎮", spotify: "🟢", website: "🌐",
};

export default function ArtistPublic() {
  const [, params] = useRoute("/artist/:slug");
  const slug = params?.slug ?? "";
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [blocks, setBlocks] = useState<ProfileBlockDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setLoadError(false);
    (async () => {
      try {
        const p = await fetchPublicProfile(slug);
        if (!cancelled) setProfile(p.is_public ? p : null);
        if (!cancelled && !p.is_public) setNotFound(true);
      } catch (err) {
        // Only a genuine 404 is "doesn't exist". The API 404s solely for
        // a missing/private profile; 500s and network failures are load
        // errors and must not render the not-found state.
        const status = (err as { status?: number })?.status;
        if (!cancelled) {
          if (status === 404) setNotFound(true);
          else setLoadError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug, retryNonce]);

  /* The block layout drives the page. Its failure is NOT a page failure:
     fall back to the Grand Stage order over the profile's own sections. */
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    (async () => {
      try {
        const dto = await fetchPublicLayout(slug);
        if (!cancelled) {
          setBlocks(
            dto.layout.length > 0
              ? dto.layout
              : grandStageFallbackBlocks(profile.sections),
          );
        }
      } catch {
        if (!cancelled) setBlocks(grandStageFallbackBlocks(profile.sections));
      }
    })();
    return () => { cancelled = true; };
  }, [profile, slug]);

  usePageTitle(
    profile ? `${profile.display_name}` : "Creator Profile",
    profile ? `${profile.display_name}. ${profile.bio?.split("\n")[0] ?? "Music, videos, merch, and more — all in one place."}` : "A creator profile on Bow Down Visuals."
  );

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 bg-black px-4 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-400" />
        <h1 className="text-xl font-bold text-white">Couldn't load this profile.</h1>
        <p className="max-w-sm text-sm text-white/50">
          Something went wrong on our end — this creator's page may well exist, it just couldn't load right now.
        </p>
        <button type="button" onClick={() => setRetryNonce((n) => n + 1)} className="mt-2 inline-flex items-center gap-2 rounded-full bg-amber-400 px-6 py-2.5 text-sm font-bold text-black transition hover:scale-105">
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
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

  /* One layout block → its section. Page blocks are their own data-
     fetching components; section blocks render through the shared
     section switch with the BLOCK's title (an editor retitle wins over
     the stored section title). */
  const renderBlock = (block: ProfileBlockDto) => {
    switch (block.type) {
      case "spotlight":
        /* The Stage: the live badge rides on the stage block — a creator
           who is live right now is ON STAGE, above their featured pin. */
        return (
          <>
            <LiveNowBadge slug={slug} />
            <SpotlightPinSection slug={slug} title={block.title} />
          </>
        );
      case "court":
        return <RoyalCourtSection slug={slug} title={block.title} />;
      case "store":
        return <ProfileStoreSection slug={slug} title={block.title} />;
      case "memberships":
        return <ProfileMembershipsSection creatorUserId={profile.user_id} title={block.title} />;
      case "achievements":
        return (
          <TrophyShelf slug={slug} displayName={profile.display_name} avatarUrl={profile.avatar_url} />
        );
      case "links":
        return socials.length > 0 ? (
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
        ) : null;
      default: {
        const stored = profile.sections.find((s) => s.type === block.type);
        const section: ProfileSection = stored
          ? { ...stored, title: block.title }
          : {
              id: `block-${block.type}`,
              type: block.type as ProfileSection["type"],
              title: block.title,
              visible: true,
            };
        return <ProfileSectionByType profile={profile} section={section} mode="public" />;
      }
    }
  };

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
      {/* The profile is a self-themed surface (the creator's own
          colorway, resolved into --ap-* tokens): data-dark-lock keeps
          the site light theme's palace backdrop repaint off it, the
          same exemption the players and cinema surfaces carry — the
          creator's stage keeps its own lighting in both site themes,
          and its cream-on-marble text stays readable in each. */}
      <div
        className="min-h-screen"
        data-dark-lock
        style={{
          ...themeVars(profile.theme_config),
          backgroundColor: "var(--ap-bg)",
          color: "var(--ap-text)",
          fontFamily: "var(--ap-body-font)",
        }}
      >
        {/* The block layout, in order. Until it lands, the Grand Stage
            fallback over the profile's sections stands in — same order. */}
        {(blocks ?? grandStageFallbackBlocks(profile.sections)).map((block, i) => (
          <div key={block.type}>
            {renderBlock(block)}
            {/* Identity badges ride directly under the masthead. */}
            {i === 0 && (
              <>
                {profile.is_official && <OfficialBadge />}
                {profile.recruiter_badge && <RecruiterBadge badge={profile.recruiter_badge} />}
              </>
            )}
          </div>
        ))}
        <ProfileActions profile={profile} />
        <div className="flex justify-center px-4 pb-4">
          <EmbedButton
            kind="profile"
            id={profile.slug}
            refCode={profile.referral_code ?? undefined}
            title={profile.display_name}
          />
        </div>
        {/* Free-tier branding rule (Stack 3, item 7): profiles whose
            owner is NOT on a paid plan carry the "Powered by Bow Down
            Visuals" mark in the footer; paid-plan profiles are clean. */}
        {profile.paid_plan !== true && <MadeWithBadge referralCode={profile.referral_code} />}
      </div>
    </>
  );
}
