import { useEffect, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import { Loader2, Link2Off, Crown, BadgeCheck, AlertTriangle, RotateCcw, Play, Pause } from "lucide-react";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import type { CreatorProfile, ProfileSection } from "@/lib/artist-profiles";
import { fetchPublicProfile, themeVars } from "@/lib/artist-profiles";
import {
  ProfileActions, ProfileSectionByType, MadeWithBadge,
} from "@/components/artist/profile-sections";
import TrophyShelf from "@/components/artist/TrophyShelf";
import SocialProofStrip from "@/components/artist/SocialProofStrip";
import PartyTableSection from "@/components/artist/PartyTableSection";
import RoyalCourtSection from "@/components/artist/RoyalCourtSection";
import SpotlightPinSection from "@/components/artist/SpotlightPinSection";
import ProfileStoreSection from "@/components/artist/ProfileStoreSection";
import FanArtWallSection from "@/components/artist/FanArtWallSection";
import ProfileMembershipsSection from "@/components/artist/ProfileMembershipsSection";
import ProfileTutorialsSection from "@/components/artist/ProfileTutorialsSection";
import SupporterBoardSection from "@/components/artist/SupporterBoardSection";
import SponsorCreatorSection from "@/components/artist/SponsorCreatorSection";
import BookArtistSection from "@/components/artist/BookArtistSection";
import {
  fetchPublicLayout,
  grandStageFallbackBlocks,
  type ProfileBlockDto,
} from "@/lib/profile-website";
import { EmbedButton } from "@/components/player/EmbedButton";

/* ─── Recruiter badge (virality wave) — the creator's Kingpin referral rank,
   rendered on their public profile so visitors see proof of their pull. */
function RecruiterBadge({ badge }: { badge: NonNullable<CreatorProfile["recruiter_badge"]> }) {
  const isLight = useIsLightTheme();
  return (
    <div className="flex justify-center px-4 pb-4">
      <a
        href="/referrals"
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-bold transition ${
          isLight
            ? "border-[#7A5A12]/45 bg-[#C9A84C]/15 text-[#7A5A12] hover:bg-[#C9A84C]/25"
            : "border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20"
        }`}
        title={`${badge.signups} creators recruited · ${badge.ratePct}% referral cut`}
      >
        <Crown className="h-3.5 w-3.5" />
        {badge.title} Recruiter · {"★".repeat(badge.stars)}
        <span className={`${isLight ? "text-[#7A5A12]/70" : "text-amber-300/60"} font-semibold`}>{badge.signups} recruited</span>
      </a>
    </div>
  );
}

/* ─── The Crowns badge (N8) — the yearly house awards this creator
   currently wears (GET /api/crowns/worn/:userId). The crown is a pure
   read over the frozen awards: it appears when the year's deciding
   lands and comes off by itself at expiry (Jan 1 of year+2). Renders
   nothing when the creator wears no crown — same self-hiding shape
   as the live badge. */
interface WornCrown {
  category: string;
  categoryTitle: string;
  metricLabel: string;
  metricValue: number;
  expiresAt: string;
}
function CrownsBadge({ userId }: { userId: string }) {
  const isLight = useIsLightTheme();
  const [crowns, setCrowns] = useState<WornCrown[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/crowns/worn/${encodeURIComponent(userId)}`);
        if (!res.ok) return;
        const d = (await res.json()) as { crowns: WornCrown[] };
        if (!cancelled) setCrowns(d.crowns);
      } catch {
        /* badge just stays hidden — the profile itself already loaded */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);
  if (!crowns || crowns.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-center gap-2 px-4 pb-4" data-testid="profile-crowns-badge">
      {crowns.map((c) => {
        const winYear = new Date(c.expiresAt).getUTCFullYear() - 2;
        return (
          <span
            key={c.category}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-bold ${
              isLight
                ? "border-[#7A5A12]/45 bg-[#C9A84C]/15 text-[#7A5A12]"
                : "border-amber-400/40 bg-amber-400/10 text-amber-300"
            }`}
            title={`${c.metricValue.toLocaleString("en-US")} ${c.metricLabel} — The Crowns of ${winYear}, worn for the year`}
          >
            <Crown className="h-3.5 w-3.5" />
            {c.categoryTitle} · {winYear}
          </span>
        );
      })}
    </div>
  );
}

/* ─── Official badge — house/company accounts (migration 0125). Today this
   is Thy Cheat Code: the site's host and everybody's first friend. ── */
function OfficialBadge() {
  const isLight = useIsLightTheme();
  return (
    <div className="flex justify-center px-4 pb-4">
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-bold ${
          isLight
            ? "border-[#7A5A12]/45 bg-[#C9A84C]/15 text-[#7A5A12]"
            : "border-[#d4af37]/50 bg-[#d4af37]/10 text-[#e8c86a]"
        }`}
        title="The official Bow Down Visuals account — Thy Cheat Code is everybody's first friend 🦈"
      >
        <BadgeCheck className="h-3.5 w-3.5" />
        Official · Bow Down Visuals
      </span>
    </div>
  );
}

/* ─── Feature Verse badge (Stack-200 N7) — this creator has listed
   their OWN feature price and is buyable. Renders NOTHING when they
   have no active listing: no listing = not buyable, stated by absence.
   The buy flow itself docks on the Collabs page's Feature Verse tab. */
function FeatureVerseBadge({ userId }: { userId: string }) {
  const isLight = useIsLightTheme();
  const [listing, setListing] = useState<{ priceVb: number; title: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/feature-verse/listings/by-creator/${encodeURIComponent(userId)}`);
        if (!res.ok) return;
        const d = (await res.json()) as { listing: { price_vb?: number; priceVb?: number; title: string } | null };
        const l = d.listing;
        if (!cancelled && l) setListing({ priceVb: l.priceVb ?? l.price_vb ?? 0, title: l.title });
      } catch {
        /* badge just stays hidden — no listing, not buyable */
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);
  if (!listing || !listing.priceVb) return null;
  return (
    <div className="flex justify-center px-4 pb-4">
      <Link
        href="/collabs?tab=featureverse"
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-bold transition ${
          isLight
            ? "border-[#7A5A12]/45 bg-[#C9A84C]/15 text-[#7A5A12] hover:bg-[#C9A84C]/25"
            : "border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20"
        }`}
        title="Splits written and signed before anyone records — the fee is held in escrow and releases on delivery."
        data-testid="profile-feature-verse-badge"
      >
        Book a feature verse · {listing.priceVb.toLocaleString("en-US")} VB
      </Link>
    </div>
  );
}

/* ─── Producer tag (#159 Your Own Tag) — the creator's approved signature
   tag sounds right on the profile: one tap plays it (spoken tag or the
   two-second sonic logo), tap again to stop. Renders nothing without an
   approved tag (the payload carries producer_tag_url only then). ── */
function ProducerTagBadge({ url, kind, name }: { url: string; kind?: string | null; name: string }) {
  const isLight = useIsLightTheme();
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      void el.play().catch(() => setPlaying(false));
    }
  };
  return (
    <div className="flex justify-center px-4 pb-4">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? `Stop ${name}'s producer tag` : `Play ${name}'s producer tag`}
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-bold transition ${
          isLight
            ? "border-[#7A5A12]/45 bg-[#C9A84C]/15 text-[#7A5A12] hover:bg-[#C9A84C]/25"
            : "border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20"
        }`}
        title={kind === "sonic" ? "This creator's sonic logo" : "This creator's producer tag"}
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        {playing ? "Playing the tag…" : "Hear my tag"}
        <span className={`${isLight ? "text-[#7A5A12]/70" : "text-amber-300/60"} font-semibold`}>
          {kind === "sonic" ? "Sonic logo" : "Producer tag"}
        </span>
      </button>
      <audio
        ref={audioRef}
        src={url}
        preload="none"
        onEnded={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
    </div>
  );
}

/* ─── Live now badge — the creator is broadcasting natively on the site
   (GET /api/live-streams/profile/:slug). Links straight to the watch page. */
function LiveNowBadge({ slug }: { slug: string }) {
  const [live, setLive] = useState<{ id: string; title: string; ticket?: { price_vb: number } | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/live-streams/profile/${encodeURIComponent(slug)}`);
        if (!res.ok) return;
        const d = (await res.json()) as { stream: { id: string; title: string; ticket?: { price_vb: number } | null } | null };
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
        Live now — watch{live.ticket ? ` · ${live.ticket.price_vb.toLocaleString("en-US")} VB ticket` : ""}
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
  const isLight = useIsLightTheme();
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
            {/* The host's open party table lives at their place too
                (program 2.25): it stands on the Stage beside the live
                badge and hides itself when no table is open. */}
            <PartyTableSection slug={slug} />
            <SpotlightPinSection slug={slug} title={block.title} />
          </>
        );
      case "court":
        return <RoyalCourtSection slug={slug} title={block.title} />;
      case "store":
        return <ProfileStoreSection slug={slug} title={block.title} />;
      case "gallery":
        /* Fan Art Wall (#157): fan-submitted art the creator approved
           piece by piece, artist credit on every piece. The section
           fetches its own (approved-only) data like the store block. */
        return <FanArtWallSection slug={slug} title={block.title} creatorName={profile.display_name} />;
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
          same exemption the players and cinema surfaces carry. Panel
          tokens follow the SITE theme (themeVars' light palette:
          ivory + bronze in light, the creator's walnut + gold in
          dark); the banner art and the ink that sits on it
          (--ap-onart-*) keep the creator's colorway in both. */}
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
                {profile.user_id && <FeatureVerseBadge userId={profile.user_id} />}
                {/* N8: The Crowns the creator currently wears (renders
                    nothing when they wear none). */}
                <CrownsBadge userId={profile.user_id} />
                {profile.producer_tag_url && (
                  <ProducerTagBadge url={profile.producer_tag_url} kind={profile.producer_tag_kind} name={profile.display_name} />
                )}
                {/* C5: verified social proof from connected accounts
                    (renders nothing when no figure is live). */}
                <SocialProofStrip figures={profile.social_proof} />
              </>
            )}
          </div>
        ))}
        {/* Top Supporters (Wave-4 #49 + N6): the recognition board
            docks on every public profile under the creator's layout —
            hidden only when the creator turned it off. */}
        <SupporterBoardSection slug={slug} />
        {/* Tutorials shelf (V1): the creator's how-tos live on the
            profile too — it renders nothing until they have one. */}
        <ProfileTutorialsSection slug={slug} />
        {/* Sponsor this creator (payfix sponsor-purchase lane): direct
            sponsorship at the sponsor's own amount on the sponsor escrow
            rail — price + 15%/85% split shown before paying, funded
            on-site, and funded sponsors are recognised in the section. */}
        <SponsorCreatorSection slug={slug} displayName={profile.display_name} />
        {/* Book the Artist (#158): the promoter-facing booking door —
            offer form + the escrow walk for both sides, docked on the
            profile beside the store (MONEY step), never a standalone
            page. */}
        <BookArtistSection profile={profile} />
        <ProfileActions profile={profile} />
        <div className="flex justify-center px-4 pb-4">
          <EmbedButton
            kind="profile"
            id={profile.slug}
            refCode={profile.referral_code ?? undefined}
            title={profile.display_name}
            className="ap-embed-btn"
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
