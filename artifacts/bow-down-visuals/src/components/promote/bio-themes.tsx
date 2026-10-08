import type { ComponentType } from "react";
import {
  Link2, Music, Video, Mic, ShoppingBag, Ticket, Calendar, Mail, Heart,
  Star, Crown, Sparkles, Globe, Image as ImageIcon, Play, AtSign, AudioLines,
  MessageCircle, ExternalLink, HandCoins,
} from "lucide-react";
import { InstagramIcon, TikTokIcon, YouTubeIcon } from "@/components/social-icons";

/* ─── Link-in-Bio themes + shared public page view ──────────────────────────
   Gold/black luxury variants. BioPageView is shared by the builder preview
   and the public /bio/:slug page so WYSIWYG is exact. */

export interface BioLinkRow { title: string; url: string; icon: string }
export interface BioFeaturedItem { label: string; url: string; kind: string }

export interface BioPageData {
  slug: string;
  displayName: string;
  headline: string;
  bio: string;
  avatarUrl: string | null;
  links: BioLinkRow[];
  socials: Record<string, string>;
  theme: string;
  featured: BioFeaturedItem[];
  tipJarUrl: string | null;
  referralCode?: string | null;
}

export interface BioTheme {
  key: string;
  labelKey: string;
  blurbKey: string;
  page: string;
  glow: string;
  card: string;
  name: string;
  headline: string;
  bioText: string;
  linkButton: string;
  linkTitle: string;
  linkIcon: string;
  socialButton: string;
  featuredCard: string;
  tipButton: string;
  badge: string;
}

export const BIO_THEMES: BioTheme[] = [
  {
    key: "gold-royal",
    labelKey: "linkInBio.theme.goldRoyal",
    blurbKey: "linkInBio.theme.goldRoyalBlurb",
    page: "bg-black",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(212,175,55,0.22), transparent 70%)",
    card: "border-amber-500/30 bg-gradient-to-b from-zinc-900 to-black shadow-[0_0_60px_rgba(212,175,55,0.12)]",
    name: "text-white",
    headline: "text-amber-200/90",
    bioText: "text-zinc-400",
    linkButton: "border-amber-500/25 bg-gradient-to-r from-amber-400 to-yellow-500 text-black hover:brightness-110 shadow-[0_4px_24px_rgba(212,175,55,0.25)]",
    linkTitle: "",
    linkIcon: "",
    socialButton: "border-white/12 bg-white/[0.04] text-amber-300/90 hover:border-amber-500/50 hover:text-amber-300",
    featuredCard: "border-white/10 bg-white/[0.03] hover:border-amber-500/40",
    tipButton: "border-amber-500/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20",
    badge: "text-amber-500/80 hover:text-amber-400",
  },
  {
    key: "midnight-gold",
    labelKey: "linkInBio.theme.midnightGold",
    blurbKey: "linkInBio.theme.midnightGoldBlurb",
    page: "bg-[#070b16]",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(212,175,55,0.16), transparent 70%), radial-gradient(400px 200px at 80% 0%, rgba(56,89,199,0.12), transparent 70%)",
    card: "border-amber-400/20 bg-gradient-to-b from-[#0d1428] to-[#070b16] shadow-[0_0_60px_rgba(212,175,55,0.08)]",
    name: "text-white",
    headline: "text-amber-200/80",
    bioText: "text-slate-400",
    linkButton: "border border-amber-400/30 bg-[#0d1428]/80 text-amber-100 hover:border-amber-400/60 hover:bg-[#131c36]",
    linkTitle: "",
    linkIcon: "text-amber-400",
    socialButton: "border-white/10 bg-white/[0.03] text-slate-300 hover:border-amber-400/50 hover:text-amber-300",
    featuredCard: "border-white/10 bg-white/[0.02] hover:border-amber-400/40",
    tipButton: "border-amber-400/40 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20",
    badge: "text-amber-500/70 hover:text-amber-400",
  },
  {
    key: "onyx-minimal",
    labelKey: "linkInBio.theme.onyxMinimal",
    blurbKey: "linkInBio.theme.onyxMinimalBlurb",
    page: "bg-black",
    glow: "none",
    card: "border-white/10 bg-black",
    name: "text-white",
    headline: "text-white/60",
    bioText: "text-white/45",
    linkButton: "border border-white/15 bg-white text-black hover:bg-amber-100",
    linkTitle: "",
    linkIcon: "",
    socialButton: "border-white/15 bg-transparent text-white/60 hover:border-amber-500/60 hover:text-amber-300",
    featuredCard: "border-white/10 bg-transparent hover:border-amber-500/40",
    tipButton: "border border-amber-500/50 bg-transparent text-amber-300 hover:bg-amber-400/10",
    badge: "text-white/40 hover:text-amber-400",
  },
];

export function bioTheme(key: string): BioTheme {
  return BIO_THEMES.find((t) => t.key === key) ?? BIO_THEMES[0]!;
}

const LINK_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  link: Link2, music: Music, video: Video, mic: Mic, "shopping-bag": ShoppingBag,
  ticket: Ticket, calendar: Calendar, mail: Mail, heart: Heart, star: Star,
  crown: Crown, sparkles: Sparkles, globe: Globe, image: ImageIcon, play: Play,
};

export function BioLinkIcon({ icon, className }: { icon: string; className?: string }) {
  const C = LINK_ICONS[icon] ?? Link2;
  return <C className={className} />;
}

export const SOCIAL_DEFS: Array<{ key: string; label: string; Icon: ComponentType<{ className?: string }> }> = [
  { key: "instagram", label: "Instagram", Icon: InstagramIcon },
  { key: "tiktok", label: "TikTok", Icon: TikTokIcon },
  { key: "youtube", label: "YouTube", Icon: YouTubeIcon },
  { key: "x", label: "X", Icon: AtSign },
  { key: "spotify", label: "Spotify", Icon: AudioLines },
  { key: "discord", label: "Discord", Icon: MessageCircle },
];

const FEATURED_KIND_ICON: Record<string, ComponentType<{ className?: string }>> = {
  song: Music, video: Video, clip: Play, image: ImageIcon, thumbnail: ImageIcon,
  beat: AudioLines, script: Mail,
};

/* ─── Shared page view ─────────────────────────────────────────────────────
   `onLinkTap(kind, index, title, url)` fires BEFORE navigation so the public
   page can record click analytics. When omitted, links are plain anchors. */
export function BioPageView({
  page,
  onLinkTap,
  shareUrl,
}: {
  page: BioPageData;
  onLinkTap?: (kind: "link" | "social" | "featured" | "tip", index: number, title: string, url: string) => void;
  shareUrl?: string;
}) {
  const theme = bioTheme(page.theme);
  const socials = SOCIAL_DEFS.filter((s) => (page.socials[s.key] ?? "").trim());

  const tap = (kind: "link" | "social" | "featured" | "tip", index: number, title: string, url: string) => {
    try { onLinkTap?.(kind, index, title, url); } catch { /* analytics never blocks */ }
  };

  return (
    <div className={`min-h-screen ${theme.page} text-white flex flex-col items-center px-5 py-10 relative overflow-hidden`}>
      <div className="pointer-events-none absolute inset-0" style={{ background: theme.glow }} />

      <div className="w-full max-w-md relative">
        {/* profile card */}
        <div className={`rounded-3xl border p-8 text-center ${theme.card}`}>
          {page.avatarUrl ? (
            <img
              src={page.avatarUrl}
              alt={page.displayName}
              className="w-24 h-24 rounded-full mx-auto object-cover border-2 border-amber-400/60"
              loading="lazy"
            />
          ) : (
            <div className="w-24 h-24 rounded-full mx-auto flex items-center justify-center bg-gradient-to-br from-amber-400 to-amber-700 text-black text-3xl font-bold">
              {(page.displayName || "?").charAt(0).toUpperCase()}
            </div>
          )}
          <h1 className={`mt-4 text-3xl font-bold ${theme.name}`}>{page.displayName}</h1>
          {page.headline.trim() && <p className={`mt-1 font-medium ${theme.headline}`}>{page.headline}</p>}
          {page.bio.trim() && <p className={`mt-3 text-sm leading-relaxed ${theme.bioText}`}>{page.bio}</p>}

          {/* socials */}
          {socials.length > 0 && (
            <div className="mt-5 flex items-center justify-center gap-2.5 flex-wrap">
              {socials.map((s, i) => (
                <a
                  key={s.key}
                  href={page.socials[s.key]}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  onClick={() => tap("social", i, s.label, page.socials[s.key]!)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${theme.socialButton}`}
                >
                  <s.Icon className="h-4.5 w-4.5" />
                </a>
              ))}
            </div>
          )}
        </div>

        {/* links */}
        {page.links.length > 0 && (
          <div className="mt-6 space-y-3">
            {page.links.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target={link.url.startsWith("/") ? undefined : "_blank"}
                rel="noopener noreferrer"
                onClick={() => tap("link", i, link.title, link.url)}
                className={`flex items-center gap-3 rounded-2xl border px-5 py-4 transition ${theme.linkButton}`}
              >
                <BioLinkIcon icon={link.icon} className={`h-5 w-5 shrink-0 ${theme.linkIcon}`} />
                <span className={`flex-1 text-center font-semibold ${theme.linkTitle}`}>{link.title}</span>
                <ExternalLink className="h-4 w-4 shrink-0 opacity-50" />
              </a>
            ))}
          </div>
        )}

        {/* featured content */}
        {page.featured.length > 0 && (
          <div className="mt-8">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-amber-400/80">Featured</p>
            <div className="grid grid-cols-2 gap-3">
              {page.featured.map((f, i) => {
                const FIcon = FEATURED_KIND_ICON[f.kind] ?? Play;
                return (
                  <a
                    key={i}
                    href={f.url}
                    target={f.url.startsWith("/") ? undefined : "_blank"}
                    rel="noopener noreferrer"
                    onClick={() => tap("featured", i, f.label, f.url)}
                    className={`group rounded-2xl border p-4 transition ${theme.featuredCard}`}
                  >
                    <FIcon className="h-5 w-5 text-amber-400 mb-2" />
                    <p className="text-sm font-semibold text-white/90 leading-snug line-clamp-2">{f.label}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-wider text-white/35 capitalize">{f.kind}</p>
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* tip jar */}
        {page.tipJarUrl?.trim() && (
          <a
            href={page.tipJarUrl}
            target={page.tipJarUrl.startsWith("/") ? undefined : "_blank"}
            rel="noopener noreferrer"
            onClick={() => tap("tip", -1, "tip jar", page.tipJarUrl!)}
            className={`mt-8 flex items-center justify-center gap-2 rounded-2xl border px-5 py-4 font-bold transition ${theme.tipButton}`}
          >
            <HandCoins className="h-5 w-5" /> Send a tip
          </a>
        )}

        {/* viral badge */}
        <p className="mt-10 text-center text-xs text-white/35">
          Made with{" "}
          <a href={shareUrl ?? "/"} className={`font-semibold ${theme.badge}`}>
            Bow Down Visuals
          </a>
        </p>
      </div>
    </div>
  );
}
