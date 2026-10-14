import {
  Clapperboard, Mic, Music, Fingerprint, AudioWaveform, Camera, Film,
  Image, Palette, Play, Megaphone, Zap, Gauge, MessageCircle, CalendarDays,
  Layers, Radio, TrendingUp, GraduationCap, Dices, ShieldCheck, Briefcase,
  SlidersHorizontal, Paintbrush, Handshake, Rocket, DollarSign, Star,
  Store, ShoppingBag, Newspaper, Compass, Users, Trophy, Gift,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ─── Bow Down Visuals feature registry ───────────────────────────────────
   The single source of truth for every user-facing feature on the site.
   Powers the /features showcase page and the /promote generator's feature
   picker. To add a feature: append one entry here — both pages pick it up
   automatically. Keep `creditCost` in sync with the backend route's price.
   `route` always names the feature's REAL home — never a legacy redirect
   alias; a tab/panel deep link (?tab=…, ?panel=…) is part of the address. */

export type FeatureCategory = "create" | "branding" | "promote" | "social" | "business" | "studio";

export interface FeatureCategoryMeta {
  key: FeatureCategory;
  label: string;
  blurb: string;
}

export const FEATURE_CATEGORIES: FeatureCategoryMeta[] = [
  { key: "create", label: "Create", blurb: "Make music, videos, images & brand assets" },
  { key: "branding", label: "Branding", blurb: "Logos, pages & a look that sells" },
  { key: "promote", label: "Promote", blurb: "Hooks, clips, calendars & stream hype" },
  { key: "social", label: "Social", blurb: "Feed, groups & your crowd" },
  { key: "business", label: "Business", blurb: "Get paid, protected & formalized" },
  { key: "studio", label: "My Studio", blurb: "Your projects, vault & library" },
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
    key: "creation-hub",
    name: "Creation Hub",
    tagline: "Guided workflows — one project, every tool, nothing lost",
    route: "/create?panel=hub",
    category: "create",
    creditCost: "Free",
    icon: Zap,
    badge: "POPULAR",
  },
  {
    key: "video-generator",
    name: "AI Video Generator",
    tagline: "Cinematic AI video scenes",
    route: "/create?panel=video",
    category: "create",
    creditCost: "150 Visual Bucs/sec",
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
    route: "/create?panel=song",
    category: "create",
    creditCost: "400 Visual Bucs",
    icon: Music,
  },
  {
    key: "audio-studio",
    name: "Audio Studio",
    tagline: "Clean up, split stems, master & polish any track",
    route: "/audio-studio",
    category: "create",
    creditCost: "From 50 Visual Bucs",
    icon: SlidersHorizontal,
    badge: "POPULAR",
  },
  {
    key: "video-editor",
    name: "Visual Vibes",
    tagline: "Pro timeline editor with transitions & effects",
    route: "/video-editor",
    category: "create",
    creditCost: "400 Visual Bucs/export",
    icon: Film,
  },
  {
    key: "thumbnail-maker",
    name: "Thumbnail Maker",
    tagline: "Click-magnet thumbnails that get the click",
    route: "/thumbnail-studio?tab=generate",
    category: "create",
    creditCost: "From 100 Visual Bucs",
    icon: Image,
  },
  {
    key: "hook-studio",
    name: "Hook Studio",
    tagline: "First-3-second hooks that stop the scroll",
    route: "/hooks",
    category: "create",
    creditCost: "100 Visual Bucs",
    icon: Zap,
    badge: "POPULAR",
  },
  {
    key: "randomizer",
    name: "Content Randomizer",
    tagline: "Never run out of content ideas again",
    route: "/hooks?tab=dice",
    category: "create",
    creditCost: "Free / 100 Visual Bucs AI",
    icon: Dices,
  },

  /* ── Branding ── */
  {
    key: "branding-kit",
    name: "Branding Kit",
    tagline: "Your whole identity — logos, intros, stream packs & shop",
    route: "/branding-kit",
    category: "branding",
    creditCost: "Free to open",
    icon: Paintbrush,
  },
  {
    key: "logo-maker",
    name: "Logo Maker",
    tagline: "A brand mark worthy of your name",
    route: "/branding-kit?tab=logo",
    category: "branding",
    creditCost: "From 100 Visual Bucs",
    icon: Palette,
  },
  {
    key: "intros-outros",
    name: "Intros & Outros",
    tagline: "Signature openers and closers for your videos",
    route: "/branding-kit?tab=intros",
    category: "branding",
    creditCost: "150 Visual Bucs/sec",
    icon: Play,
  },
  {
    key: "stream-packs",
    name: "Stream Packs",
    tagline: "Overlays, alerts & panels for your stream",
    route: "/branding-kit?tab=stream",
    category: "branding",
    creditCost: "100 Visual Bucs/image",
    icon: Layers,
  },

  /* ── Promote ── */
  {
    key: "promo-clips",
    name: "Promo Clips",
    tagline: "Scroll-stopping promo clips from your music",
    route: "/video-editor?tab=promo-clips",
    category: "promote",
    creditCost: "100 Visual Bucs",
    icon: Megaphone,
  },
  {
    key: "virality-check",
    name: "Virality Pre-flight",
    tagline: "An honest 0–100 readiness scorecard for your post",
    route: "/analytics-hub?tab=virality",
    category: "promote",
    creditCost: "200 Visual Bucs",
    icon: Gauge,
  },
  {
    key: "content-calendar",
    name: "Content Calendar",
    tagline: "A month of content planned in minutes",
    route: "/scheduler?tab=calendar",
    category: "promote",
    creditCost: "100 Visual Bucs",
    icon: CalendarDays,
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
  {
    key: "refer-earn",
    name: "Refer & Earn",
    tagline: "Earn 25% of what creators you bring in spend — in Visual Bucs",
    route: "/referrals",
    category: "promote",
    creditCost: "Free",
    icon: Gift,
  },

  /* ── Social ── */
  {
    key: "social-feed",
    name: "Creator Feed",
    tagline: "New drops from the creators you follow",
    route: "/home",
    category: "social",
    creditCost: "Free",
    icon: Newspaper,
  },
  {
    key: "explore",
    name: "Explore",
    tagline: "Find creators, sounds & trends worth riding",
    route: "/explore",
    category: "social",
    creditCost: "Free",
    icon: Compass,
  },
  {
    key: "groups",
    name: "Groups",
    tagline: "Communities for your niche & your fans",
    route: "/groups",
    category: "social",
    creditCost: "Free",
    icon: Users,
  },
  {
    key: "contests",
    name: "Creator Contests",
    tagline: "Compete, climb the board, land in the Winners' Circle",
    route: "/contests",
    category: "social",
    creditCost: "Free",
    icon: Trophy,
  },
  {
    key: "comment-replies",
    name: "Comment Replies",
    tagline: "AI replies that turn comments into fans",
    route: "/community?tab=replies",
    category: "social",
    creditCost: "100 Visual Bucs",
    icon: MessageCircle,
  },

  /* ── Business ── */
  {
    key: "money-coach",
    name: "Monetization Coach",
    tagline: "Your money plan: eligibility, RPMs, next moves",
    route: "/coach",
    category: "business",
    creditCost: "100 Visual Bucs",
    icon: TrendingUp,
    badge: "POPULAR",
  },
  {
    key: "brand-deals",
    name: "Brand Deals",
    tagline: "Find sponsors & send pitch kits that land deals",
    route: "/brand-deals",
    category: "business",
    creditCost: "200 Visual Bucs/search",
    icon: Handshake,
  },
  {
    key: "distribute",
    name: "Distribute",
    tagline: "Put your music on every streaming platform",
    route: "/distribute",
    category: "business",
    creditCost: "From 1,000 Visual Bucs",
    icon: Rocket,
  },
  {
    key: "tips",
    name: "Tips",
    tagline: "Your tip page — fans support you right from your profile",
    route: "/tips",
    category: "business",
    creditCost: "Free",
    icon: DollarSign,
  },
  {
    key: "memberships",
    name: "Memberships",
    tagline: "Paid fan memberships with member-only perks",
    route: "/memberships",
    category: "business",
    creditCost: "Free",
    icon: Star,
  },
  {
    key: "storefronts",
    name: "Storefronts",
    tagline: "Your own shop front for music & digital products",
    route: "/storefronts",
    category: "business",
    creditCost: "Free",
    icon: Store,
  },
  {
    key: "my-shop",
    name: "My Shop",
    tagline: "Sell your products, music & merch in one shop",
    route: "/my-shop",
    category: "business",
    creditCost: "Free",
    icon: ShoppingBag,
  },
  {
    key: "creator-academy",
    name: "Creator Academy",
    tagline: "Courses that turn talent into a career",
    route: "/academy",
    category: "business",
    creditCost: "Free",
    icon: GraduationCap,
  },
  {
    key: "copyright",
    name: "Copyright Assistant",
    tagline: "Protect your music the right way",
    route: "/copyright",
    category: "business",
    creditCost: "100 Visual Bucs",
    icon: ShieldCheck,
  },
  {
    key: "llc-guide",
    name: "LLC Guide",
    tagline: "Form your LLC without the lawyer bill",
    route: "/llc-guide",
    category: "business",
    creditCost: "100 Visual Bucs",
    icon: Briefcase,
  },

  /* ── My Studio ── */
  {
    key: "artist-vault",
    name: "Creator Vault",
    tagline: "Your face, voice & brand assets in one vault",
    route: "/artist-vault",
    category: "studio",
    creditCost: "Free vault",
    icon: Fingerprint,
  },
  {
    key: "voice-lock",
    name: "Artist Voice Lock",
    tagline: "Lock your AI voice across every song",
    route: "/artist-vault",
    category: "studio",
    creditCost: "From 200 Visual Bucs",
    icon: AudioWaveform,
  },
  {
    key: "photo-shoot",
    name: "Artist Photo Shoot",
    tagline: "Pro artist photos in any style or location",
    route: "/artist-vault",
    category: "studio",
    creditCost: "From 100 Visual Bucs",
    icon: Camera,
  },
];

export function getFeature(key: string): SiteFeature | undefined {
  return SITE_FEATURES.find((f) => f.key === key);
}

export function featuresByCategory(category: FeatureCategory): SiteFeature[] {
  return SITE_FEATURES.filter((f) => f.category === category);
}
