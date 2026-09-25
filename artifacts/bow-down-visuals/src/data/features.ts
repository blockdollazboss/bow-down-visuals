import {
  Clapperboard, Mic, Music, Fingerprint, AudioWaveform, Camera, Film,
  Image, Palette, Play, Megaphone, Zap, Gauge, MessageCircle, CalendarDays,
  Layers, Radio, TrendingUp, GraduationCap, Dices, ShieldCheck, Briefcase,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ─── Bow Down Visuals feature registry ───────────────────────────────────
   The single source of truth for every user-facing feature on the site.
   Powers the /features showcase page and the /promote generator's feature
   picker. To add a feature: append one entry here — both pages pick it up
   automatically. Keep `creditCost` in sync with the backend route's price. */

export type FeatureCategory = "create" | "promote" | "grow" | "business";

export interface FeatureCategoryMeta {
  key: FeatureCategory;
  label: string;
  blurb: string;
}

export const FEATURE_CATEGORIES: FeatureCategoryMeta[] = [
  { key: "create", label: "Create", blurb: "Make music, videos, images & brand assets" },
  { key: "promote", label: "Promote", blurb: "Hooks, clips, calendars & stream hype" },
  { key: "grow", label: "Grow", blurb: "Coaching, courses & audience growth" },
  { key: "business", label: "Business", blurb: "Protect and formalize your empire" },
];

export interface SiteFeature {
  /** Stable machine key — also used by /promote's feature picker. */
  key: string;
  name: string;
  tagline: string;
  route: string;
  category: FeatureCategory;
  /** Display price, e.g. "1 credit", "1.5 credits/sec", "Free". */
  creditCost: string;
  icon: LucideIcon;
  badge?: "POPULAR" | "NEW";
}

export const SITE_FEATURES: SiteFeature[] = [
  /* ── Create ── */
  {
    key: "video-generator",
    name: "AI Video Generator",
    tagline: "Cinematic AI video scenes with Seedance 2.5",
    route: "/make-video",
    category: "create",
    creditCost: "1.5 credits/sec",
    icon: Clapperboard,
    badge: "POPULAR",
  },
  {
    key: "lip-sync",
    name: "AI Lip Sync",
    tagline: "Perfect mouth-synced vocals on any clip",
    route: "/video-editor",
    category: "create",
    creditCost: "Per scene",
    icon: Mic,
    badge: "POPULAR",
  },
  {
    key: "music-maker",
    name: "Music Maker",
    tagline: "Full original songs with vocals in minutes",
    route: "/make-song",
    category: "create",
    creditCost: "4 credits",
    icon: Music,
  },
  {
    key: "artist-vault",
    name: "Artist Vault",
    tagline: "Your face, voice & brand assets in one vault",
    route: "/artist-vault",
    category: "create",
    creditCost: "Free vault",
    icon: Fingerprint,
  },
  {
    key: "voice-lock",
    name: "Artist Voice Lock",
    tagline: "Lock your AI voice across every song",
    route: "/artist-vault",
    category: "create",
    creditCost: "From 2 credits",
    icon: AudioWaveform,
  },
  {
    key: "photo-shoot",
    name: "Artist Photo Shoot",
    tagline: "Pro artist photos in any style or location",
    route: "/artist-vault",
    category: "create",
    creditCost: "From 1 credit",
    icon: Camera,
  },
  {
    key: "video-editor",
    name: "Video Editor",
    tagline: "Pro timeline editor with transitions & effects",
    route: "/video-editor",
    category: "create",
    creditCost: "4 credits/export",
    icon: Film,
  },
  {
    key: "thumbnail-maker",
    name: "Thumbnail Maker",
    tagline: "Click-magnet thumbnails that get the click",
    route: "/thumbnail",
    category: "create",
    creditCost: "From 1 credit",
    icon: Image,
  },
  {
    key: "logo-maker",
    name: "Logo Maker",
    tagline: "A brand mark worthy of your name",
    route: "/logo-maker",
    category: "create",
    creditCost: "From 1 credit",
    icon: Palette,
  },
  {
    key: "intros-outros",
    name: "Intros & Outros",
    tagline: "Signature openers and closers for your videos",
    route: "/intros-outros",
    category: "create",
    creditCost: "1.5 credits/sec",
    icon: Play,
  },

  /* ── Promote ── */
  {
    key: "promo-clips",
    name: "Promo Clips",
    tagline: "Scroll-stopping promo clips from your music",
    route: "/promo-clip",
    category: "promote",
    creditCost: "1 credit",
    icon: Megaphone,
  },
  {
    key: "hook-studio",
    name: "Hook Studio",
    tagline: "First-3-second hooks that stop the scroll",
    route: "/hooks",
    category: "promote",
    creditCost: "1 credit",
    icon: Zap,
    badge: "POPULAR",
  },
  {
    key: "virality-check",
    name: "Virality Pre-flight",
    tagline: "An honest 0–100 readiness scorecard for your post",
    route: "/hooks",
    category: "promote",
    creditCost: "1 credit",
    icon: Gauge,
  },
  {
    key: "comment-replies",
    name: "Comment Replies",
    tagline: "AI replies that turn comments into fans",
    route: "/comment-replies",
    category: "promote",
    creditCost: "1 credit",
    icon: MessageCircle,
  },
  {
    key: "content-calendar",
    name: "Content Calendar",
    tagline: "A month of content planned in minutes",
    route: "/content-calendar",
    category: "promote",
    creditCost: "1 credit",
    icon: CalendarDays,
  },
  {
    key: "stream-packs",
    name: "Stream Packs",
    tagline: "Overlays, alerts & panels for your stream",
    route: "/stream-pack",
    category: "promote",
    creditCost: "1 credit/image",
    icon: Layers,
  },
  {
    key: "discord-live",
    name: "Discord Go Live",
    tagline: "Hype your Discord stream like a premiere",
    route: "/go-live",
    category: "promote",
    creditCost: "Free",
    icon: Radio,
    badge: "NEW",
  },

  /* ── Grow ── */
  {
    key: "money-coach",
    name: "Monetization Coach",
    tagline: "Your money plan: eligibility, RPMs, next moves",
    route: "/coach",
    category: "grow",
    creditCost: "1 credit",
    icon: TrendingUp,
    badge: "POPULAR",
  },
  {
    key: "creator-academy",
    name: "Creator Academy",
    tagline: "Courses that turn talent into a career",
    route: "/academy",
    category: "grow",
    creditCost: "Free",
    icon: GraduationCap,
  },
  {
    key: "randomizer",
    name: "Content Randomizer",
    tagline: "Never run out of content ideas again",
    route: "/randomizer",
    category: "grow",
    creditCost: "Free / 1 credit AI",
    icon: Dices,
  },

  /* ── Business ── */
  {
    key: "copyright",
    name: "Copyright Assistant",
    tagline: "Protect your music the right way",
    route: "/copyright",
    category: "business",
    creditCost: "1 credit",
    icon: ShieldCheck,
  },
  {
    key: "llc-guide",
    name: "LLC Guide",
    tagline: "Form your LLC without the lawyer bill",
    route: "/llc-guide",
    category: "business",
    creditCost: "1 credit",
    icon: Briefcase,
  },
];

export function getFeature(key: string): SiteFeature | undefined {
  return SITE_FEATURES.find((f) => f.key === key);
}

export function featuresByCategory(category: FeatureCategory): SiteFeature[] {
  return SITE_FEATURES.filter((f) => f.category === category);
}
