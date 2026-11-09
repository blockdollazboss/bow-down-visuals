import type { ComponentType } from "react";
import {
  Link2, Music, Video, Mic, ShoppingBag, Ticket, Calendar, Mail, Heart,
  Star, Crown, Sparkles, Globe, Image as ImageIcon, Play, AtSign, AudioLines,
  MessageCircle, ExternalLink, HandCoins,
} from "lucide-react";
import { InstagramIcon, TikTokIcon, YouTubeIcon } from "@/components/social-icons";

/* ─── Link-in-Bio themes + shared public page view ──────────────────────────
   Luxury variants in dark AND light designs (company law: every surface in
   both). BioPageView is shared by the builder preview and the public
   /bio/:slug page so WYSIWYG is exact. The key list is mirrored by the db
   schema's BIO_THEMES (the server validates keys on save) and the World
   desk's BIO_PAGE_THEMES — bio-themes-shelf.test.ts pins all three lists
   to the same keys so the shelf can never drift apart. */

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

interface BioTheme {
  key: string;
  labelKey: string;
  blurbKey: string;
  /* The design's own ground: "dark" themes are authored on dark grounds,
     "light" themes on light grounds. BioPageView is dark-locked, so each
     design renders exactly as authored in both site themes. */
  mode: "dark" | "light";
  page: string;
  glow: string;
  card: string;
  pageText: string;
  name: string;
  headline: string;
  bioText: string;
  linkButton: string;
  linkTitle: string;
  linkIcon: string;
  socialButton: string;
  featuredCard: string;
  sectionLabel: string;
  featuredIcon: string;
  featuredLabel: string;
  featuredKind: string;
  tipButton: string;
  badge: string;
  footerText: string;
}

export const BIO_THEMES: BioTheme[] = [
  {
    key: "gold-royal",
    labelKey: "linkInBio.theme.goldRoyal",
    blurbKey: "linkInBio.theme.goldRoyalBlurb",
    mode: "dark",
    page: "bg-black",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(212,175,55,0.22), transparent 70%)",
    card: "border-amber-500/30 bg-gradient-to-b from-zinc-900 to-black shadow-[0_0_60px_rgba(212,175,55,0.12)]",
    pageText: "text-white",
    name: "text-white",
    headline: "text-amber-200/90",
    bioText: "text-zinc-400",
    linkButton: "border-amber-500/25 bg-gradient-to-r from-amber-400 to-yellow-500 text-black hover:brightness-110 shadow-[0_4px_24px_rgba(212,175,55,0.25)]",
    linkTitle: "",
    linkIcon: "",
    socialButton: "border-white/12 bg-white/[0.04] text-amber-300/90 hover:border-amber-500/50 hover:text-amber-300",
    featuredCard: "border-white/10 bg-white/[0.03] hover:border-amber-500/40",
    sectionLabel: "text-amber-400/80",
    featuredIcon: "text-amber-400",
    featuredLabel: "text-white/90",
    featuredKind: "text-white/35",
    tipButton: "border-amber-500/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20",
    badge: "text-amber-500/80 hover:text-amber-400",
    footerText: "text-white/35",
  },
  {
    key: "midnight-gold",
    labelKey: "linkInBio.theme.midnightGold",
    blurbKey: "linkInBio.theme.midnightGoldBlurb",
    mode: "dark",
    page: "bg-[#070b16]",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(212,175,55,0.16), transparent 70%), radial-gradient(400px 200px at 80% 0%, rgba(56,89,199,0.12), transparent 70%)",
    card: "border-amber-400/20 bg-gradient-to-b from-[#0d1428] to-[#070b16] shadow-[0_0_60px_rgba(212,175,55,0.08)]",
    pageText: "text-white",
    name: "text-white",
    headline: "text-amber-200/80",
    bioText: "text-slate-400",
    linkButton: "border border-amber-400/30 bg-[#0d1428]/80 text-amber-100 hover:border-amber-400/60 hover:bg-[#131c36]",
    linkTitle: "",
    linkIcon: "text-amber-400",
    socialButton: "border-white/10 bg-white/[0.03] text-slate-300 hover:border-amber-400/50 hover:text-amber-300",
    featuredCard: "border-white/10 bg-white/[0.02] hover:border-amber-400/40",
    sectionLabel: "text-amber-400/80",
    featuredIcon: "text-amber-400",
    featuredLabel: "text-white/90",
    featuredKind: "text-white/35",
    tipButton: "border-amber-400/40 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20",
    badge: "text-amber-500/70 hover:text-amber-400",
    footerText: "text-white/35",
  },
  {
    key: "onyx-minimal",
    labelKey: "linkInBio.theme.onyxMinimal",
    blurbKey: "linkInBio.theme.onyxMinimalBlurb",
    mode: "dark",
    page: "bg-black",
    glow: "none",
    card: "border-white/10 bg-black",
    pageText: "text-white",
    name: "text-white",
    headline: "text-white/60",
    bioText: "text-white/45",
    linkButton: "border border-white/15 bg-white text-black hover:bg-amber-100",
    linkTitle: "",
    linkIcon: "",
    socialButton: "border-white/15 bg-transparent text-white/60 hover:border-amber-500/60 hover:text-amber-300",
    featuredCard: "border-white/10 bg-transparent hover:border-amber-500/40",
    sectionLabel: "text-amber-400/80",
    featuredIcon: "text-amber-400",
    featuredLabel: "text-white/90",
    featuredKind: "text-white/35",
    tipButton: "border border-amber-500/50 bg-transparent text-amber-300 hover:bg-amber-400/10",
    badge: "text-white/40 hover:text-amber-400",
    footerText: "text-white/35",
  },
  {
    key: "velvet-noir",
    labelKey: "linkInBio.theme.velvetNoir",
    blurbKey: "linkInBio.theme.velvetNoirBlurb",
    mode: "dark",
    page: "bg-[#0d0509]",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(148,32,60,0.30), transparent 70%), radial-gradient(420px 220px at 82% 0%, rgba(212,175,55,0.12), transparent 70%)",
    card: "border-amber-200/20 bg-gradient-to-b from-[#200a13] to-[#0d0509] shadow-[0_0_60px_rgba(148,32,60,0.22)]",
    pageText: "text-white",
    name: "text-white",
    headline: "text-amber-100/85",
    bioText: "text-rose-100/45",
    linkButton: "border border-amber-200/30 bg-gradient-to-r from-[#6d1530] to-[#40091b] text-amber-50 hover:brightness-125 shadow-[0_4px_24px_rgba(148,32,60,0.35)]",
    linkTitle: "",
    linkIcon: "text-amber-200",
    socialButton: "border-white/10 bg-white/[0.03] text-rose-100/75 hover:border-amber-200/50 hover:text-amber-200",
    featuredCard: "border-white/10 bg-white/[0.02] hover:border-amber-200/40",
    sectionLabel: "text-amber-200/80",
    featuredIcon: "text-amber-200",
    featuredLabel: "text-white/90",
    featuredKind: "text-white/35",
    tipButton: "border-amber-200/40 bg-amber-200/10 text-amber-100 hover:bg-amber-200/20",
    badge: "text-amber-200/70 hover:text-amber-200",
    footerText: "text-white/35",
  },
  {
    key: "emerald-court",
    labelKey: "linkInBio.theme.emeraldCourt",
    blurbKey: "linkInBio.theme.emeraldCourtBlurb",
    mode: "dark",
    page: "bg-[#04120c]",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(18,128,84,0.24), transparent 70%), radial-gradient(400px 200px at 80% 0%, rgba(212,175,55,0.10), transparent 70%)",
    card: "border-emerald-300/20 bg-gradient-to-b from-[#082a1c] to-[#04120c] shadow-[0_0_60px_rgba(18,128,84,0.16)]",
    pageText: "text-white",
    name: "text-white",
    headline: "text-emerald-100/85",
    bioText: "text-emerald-100/45",
    linkButton: "border border-emerald-300/30 bg-emerald-400/10 text-emerald-50 hover:border-emerald-300/60 hover:bg-emerald-400/20 shadow-[0_4px_24px_rgba(18,128,84,0.25)]",
    linkTitle: "",
    linkIcon: "text-amber-300",
    socialButton: "border-white/10 bg-white/[0.03] text-emerald-100/80 hover:border-emerald-300/50 hover:text-emerald-200",
    featuredCard: "border-white/10 bg-white/[0.02] hover:border-emerald-300/40",
    sectionLabel: "text-amber-300/80",
    featuredIcon: "text-amber-300",
    featuredLabel: "text-white/90",
    featuredKind: "text-white/35",
    tipButton: "border-emerald-300/40 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20",
    badge: "text-emerald-300/80 hover:text-amber-300",
    footerText: "text-white/35",
  },
  {
    key: "smoke-platinum",
    labelKey: "linkInBio.theme.smokePlatinum",
    blurbKey: "linkInBio.theme.smokePlatinumBlurb",
    mode: "dark",
    page: "bg-[#0a0a0c]",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(203,213,225,0.10), transparent 70%)",
    card: "border-white/15 bg-gradient-to-b from-[#17171c] to-[#0a0a0c] shadow-[0_0_60px_rgba(203,213,225,0.06)]",
    pageText: "text-white",
    name: "text-white",
    headline: "text-slate-300/90",
    bioText: "text-slate-400",
    linkButton: "border border-white/20 bg-gradient-to-r from-slate-100 to-slate-300 text-black hover:brightness-110 shadow-[0_4px_24px_rgba(203,213,225,0.18)]",
    linkTitle: "",
    linkIcon: "",
    socialButton: "border-white/12 bg-white/[0.04] text-slate-200 hover:border-white/50 hover:text-white",
    featuredCard: "border-white/10 bg-white/[0.03] hover:border-slate-300/40",
    sectionLabel: "text-slate-300/80",
    featuredIcon: "text-slate-200",
    featuredLabel: "text-white/90",
    featuredKind: "text-white/35",
    tipButton: "border-slate-300/40 bg-slate-200/10 text-slate-100 hover:bg-slate-200/20",
    badge: "text-slate-400 hover:text-slate-200",
    footerText: "text-white/35",
  },
  {
    key: "golden-marble",
    labelKey: "linkInBio.theme.goldenMarble",
    blurbKey: "linkInBio.theme.goldenMarbleBlurb",
    mode: "light",
    page: "bg-[#FAF7F0]",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(201,168,76,0.22), transparent 70%), radial-gradient(420px 220px at 82% 0%, rgba(212,175,55,0.10), transparent 70%)",
    card: "border-[#C9A84C]/40 bg-gradient-to-b from-[#FFFDF6] to-[#F7EFDB] shadow-[0_10px_50px_rgba(160,124,40,0.15)]",
    pageText: "text-[#2A2118]",
    name: "text-[#2A2118]",
    headline: "text-[#97751F]",
    bioText: "text-[#2A2118]/65",
    linkButton: "border border-amber-600/30 bg-gradient-to-r from-amber-400 to-yellow-500 text-black hover:brightness-105 shadow-[0_4px_24px_rgba(212,175,55,0.30)]",
    linkTitle: "",
    linkIcon: "",
    socialButton: "border-[#C9A84C]/40 bg-white/60 text-[#8A6D1F] hover:border-[#C9A84C] hover:text-[#6D5514]",
    featuredCard: "border-[#C9A84C]/30 bg-white/70 hover:border-[#C9A84C]/70",
    sectionLabel: "text-[#97751F]",
    featuredIcon: "text-[#97751F]",
    featuredLabel: "text-[#2A2118]",
    featuredKind: "text-[#2A2118]/50",
    tipButton: "border-[#C9A84C]/60 bg-[#C9A84C]/10 text-[#7C5F16] hover:bg-[#C9A84C]/20",
    badge: "text-[#97751F] hover:text-[#6D5514]",
    footerText: "text-[#2A2118]/45",
  },
  {
    key: "ivory-pearl",
    labelKey: "linkInBio.theme.ivoryPearl",
    blurbKey: "linkInBio.theme.ivoryPearlBlurb",
    mode: "light",
    page: "bg-[#FBFAF7]",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(212,175,55,0.10), transparent 70%), radial-gradient(400px 200px at 80% 0%, rgba(232,213,183,0.35), transparent 70%)",
    card: "border-[#E3D5B8] bg-white shadow-[0_10px_40px_rgba(120,100,60,0.08)]",
    pageText: "text-[#33302A]",
    name: "text-[#33302A]",
    headline: "text-[#A5854B]",
    bioText: "text-[#33302A]/60",
    linkButton: "border border-[#C9A84C]/60 bg-white text-[#4A3D1A] hover:bg-[#FAF3E0] shadow-[0_2px_14px_rgba(160,124,40,0.10)]",
    linkTitle: "",
    linkIcon: "text-[#A5854B]",
    socialButton: "border-[#E3D5B8] bg-white text-[#A5854B] hover:border-[#C9A84C] hover:text-[#7C5F16]",
    featuredCard: "border-[#E9E0CC] bg-[#FDFCF9] hover:border-[#C9A84C]/60",
    sectionLabel: "text-[#A5854B]",
    featuredIcon: "text-[#A5854B]",
    featuredLabel: "text-[#33302A]",
    featuredKind: "text-[#33302A]/50",
    tipButton: "border-[#C9A84C]/50 bg-[#C9A84C]/[0.07] text-[#7C5F16] hover:bg-[#C9A84C]/15",
    badge: "text-[#A5854B] hover:text-[#7C5F16]",
    footerText: "text-[#33302A]/40",
  },
  {
    key: "rose-champagne",
    labelKey: "linkInBio.theme.roseChampagne",
    blurbKey: "linkInBio.theme.roseChampagneBlurb",
    mode: "light",
    page: "bg-[#FBF3F1]",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(216,164,150,0.28), transparent 70%), radial-gradient(400px 200px at 80% 0%, rgba(212,175,55,0.08), transparent 70%)",
    card: "border-[#DFA79B]/40 bg-gradient-to-b from-[#FFF9F7] to-[#F9E8E2] shadow-[0_10px_45px_rgba(190,120,100,0.14)]",
    pageText: "text-[#3A2320]",
    name: "text-[#3A2320]",
    headline: "text-[#A9604B]",
    bioText: "text-[#3A2320]/60",
    linkButton: "border border-[#B76E5A]/40 bg-gradient-to-r from-[#E3A58F] to-[#C97E63] text-white hover:brightness-105 shadow-[0_4px_22px_rgba(201,126,99,0.35)]",
    linkTitle: "",
    linkIcon: "",
    socialButton: "border-[#DFA79B]/50 bg-white/60 text-[#A9604B] hover:border-[#C97E63] hover:text-[#7E4433]",
    featuredCard: "border-[#DFA79B]/35 bg-white/70 hover:border-[#C97E63]/60",
    sectionLabel: "text-[#A9604B]",
    featuredIcon: "text-[#C97E63]",
    featuredLabel: "text-[#3A2320]",
    featuredKind: "text-[#3A2320]/50",
    tipButton: "border-[#C97E63]/50 bg-[#C97E63]/10 text-[#96503C] hover:bg-[#C97E63]/20",
    badge: "text-[#A9604B] hover:text-[#7E4433]",
    footerText: "text-[#3A2320]/45",
  },
  {
    key: "cobalt-stage",
    labelKey: "linkInBio.theme.cobaltStage",
    blurbKey: "linkInBio.theme.cobaltStageBlurb",
    mode: "dark",
    page: "bg-[#050a18]",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(37,84,235,0.28), transparent 70%), radial-gradient(400px 200px at 80% 0%, rgba(212,175,55,0.10), transparent 70%)",
    card: "border-blue-300/20 bg-gradient-to-b from-[#0a1a3f] to-[#050a18] shadow-[0_0_60px_rgba(37,84,235,0.18)]",
    pageText: "text-white",
    name: "text-white",
    headline: "text-blue-100/85",
    bioText: "text-blue-100/45",
    linkButton: "border border-blue-300/30 bg-gradient-to-r from-[#1d4ed8] to-[#1e3a8a] text-white hover:brightness-125 shadow-[0_4px_24px_rgba(37,84,235,0.35)]",
    linkTitle: "",
    linkIcon: "text-amber-200",
    socialButton: "border-white/10 bg-white/[0.03] text-blue-100/80 hover:border-blue-300/50 hover:text-blue-200",
    featuredCard: "border-white/10 bg-white/[0.02] hover:border-blue-300/40",
    sectionLabel: "text-amber-300/80",
    featuredIcon: "text-amber-300",
    featuredLabel: "text-white/90",
    featuredKind: "text-white/35",
    tipButton: "border-blue-300/40 bg-blue-400/10 text-blue-200 hover:bg-blue-400/20",
    badge: "text-blue-300/80 hover:text-amber-300",
    footerText: "text-white/35",
  },
  {
    key: "mint-atelier",
    labelKey: "linkInBio.theme.mintAtelier",
    blurbKey: "linkInBio.theme.mintAtelierBlurb",
    mode: "light",
    page: "bg-[#F3F9F4]",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(120,190,145,0.25), transparent 70%), radial-gradient(420px 220px at 82% 0%, rgba(201,168,76,0.12), transparent 70%)",
    card: "border-[#A8CBB2]/50 bg-gradient-to-b from-[#FFFFFF] to-[#EAF4EC] shadow-[0_10px_50px_rgba(70,130,90,0.12)]",
    pageText: "text-[#1E2B22]",
    name: "text-[#1E2B22]",
    headline: "text-[#97751F]",
    bioText: "text-[#1E2B22]/65",
    linkButton: "border border-[#7FA98C]/50 bg-white text-[#24402C] hover:bg-[#EDF6EF] shadow-[0_2px_14px_rgba(70,130,90,0.12)]",
    linkTitle: "",
    linkIcon: "text-[#97751F]",
    socialButton: "border-[#A8CBB2]/60 bg-white/60 text-[#97751F] hover:border-[#C9A84C] hover:text-[#6D5514]",
    featuredCard: "border-[#C4DCC9]/60 bg-white/70 hover:border-[#7FA98C]/70",
    sectionLabel: "text-[#97751F]",
    featuredIcon: "text-[#97751F]",
    featuredLabel: "text-[#1E2B22]",
    featuredKind: "text-[#1E2B22]/50",
    tipButton: "border-[#7FA98C]/60 bg-[#7FA98C]/10 text-[#2F5D3A] hover:bg-[#7FA98C]/20",
    badge: "text-[#97751F] hover:text-[#6D5514]",
    footerText: "text-[#1E2B22]/45",
  },
  {
    key: "amber-dusk",
    labelKey: "linkInBio.theme.amberDusk",
    blurbKey: "linkInBio.theme.amberDuskBlurb",
    mode: "dark",
    page: "bg-[#0d0703]",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(217,119,6,0.26), transparent 70%), radial-gradient(420px 220px at 82% 0%, rgba(120,53,15,0.20), transparent 70%)",
    card: "border-amber-500/25 bg-gradient-to-b from-[#2a1608] to-[#0d0703] shadow-[0_0_60px_rgba(217,119,6,0.16)]",
    pageText: "text-white",
    name: "text-white",
    headline: "text-amber-200/85",
    bioText: "text-amber-100/45",
    linkButton: "border border-amber-500/30 bg-gradient-to-r from-[#b45309] to-[#78350f] text-amber-50 hover:brightness-125 shadow-[0_4px_24px_rgba(217,119,6,0.35)]",
    linkTitle: "",
    linkIcon: "text-amber-200",
    socialButton: "border-white/10 bg-white/[0.03] text-amber-100/80 hover:border-amber-400/50 hover:text-amber-200",
    featuredCard: "border-white/10 bg-white/[0.02] hover:border-amber-400/40",
    sectionLabel: "text-amber-400/80",
    featuredIcon: "text-amber-400",
    featuredLabel: "text-white/90",
    featuredKind: "text-white/35",
    tipButton: "border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20",
    badge: "text-amber-500/80 hover:text-amber-300",
    footerText: "text-white/35",
  },
  {
    key: "violet-reign",
    labelKey: "linkInBio.theme.violetReign",
    blurbKey: "linkInBio.theme.violetReignBlurb",
    mode: "dark",
    page: "bg-[#0d0618]",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(124,58,237,0.26), transparent 70%), radial-gradient(400px 200px at 80% 0%, rgba(212,175,55,0.10), transparent 70%)",
    card: "border-violet-300/20 bg-gradient-to-b from-[#1c0f38] to-[#0d0618] shadow-[0_0_60px_rgba(124,58,237,0.16)]",
    pageText: "text-white",
    name: "text-white",
    headline: "text-violet-100/85",
    bioText: "text-violet-100/45",
    linkButton: "border border-violet-300/30 bg-gradient-to-r from-[#7c3aed] to-[#4c1d95] text-white hover:brightness-125 shadow-[0_4px_24px_rgba(124,58,237,0.35)]",
    linkTitle: "",
    linkIcon: "text-violet-200",
    socialButton: "border-white/10 bg-white/[0.03] text-violet-100/80 hover:border-violet-300/50 hover:text-violet-200",
    featuredCard: "border-white/10 bg-white/[0.02] hover:border-violet-300/40",
    sectionLabel: "text-amber-300/80",
    featuredIcon: "text-amber-300",
    featuredLabel: "text-white/90",
    featuredKind: "text-white/35",
    tipButton: "border-violet-300/40 bg-violet-400/10 text-violet-200 hover:bg-violet-400/20",
    badge: "text-violet-300/80 hover:text-violet-200",
    footerText: "text-white/35",
  },
  {
    key: "sky-atrium",
    labelKey: "linkInBio.theme.skyAtrium",
    blurbKey: "linkInBio.theme.skyAtriumBlurb",
    mode: "light",
    page: "bg-[#F2F7FC]",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(96,150,210,0.25), transparent 70%), radial-gradient(420px 220px at 82% 0%, rgba(201,168,76,0.12), transparent 70%)",
    card: "border-[#B9D2EA]/50 bg-gradient-to-b from-[#FFFFFF] to-[#E6F0FA] shadow-[0_10px_50px_rgba(60,110,170,0.12)]",
    pageText: "text-[#1B2A3D]",
    name: "text-[#1B2A3D]",
    headline: "text-[#97751F]",
    bioText: "text-[#1B2A3D]/65",
    linkButton: "border border-[#8FB4DC]/50 bg-white text-[#1B3A5C] hover:bg-[#EFF5FB] shadow-[0_2px_14px_rgba(60,110,170,0.12)]",
    linkTitle: "",
    linkIcon: "text-[#97751F]",
    socialButton: "border-[#B9D2EA]/60 bg-white/60 text-[#97751F] hover:border-[#C9A84C] hover:text-[#6D5514]",
    featuredCard: "border-[#C9DDEF]/60 bg-white/70 hover:border-[#8FB4DC]/70",
    sectionLabel: "text-[#97751F]",
    featuredIcon: "text-[#97751F]",
    featuredLabel: "text-[#1B2A3D]",
    featuredKind: "text-[#1B2A3D]/50",
    tipButton: "border-[#8FB4DC]/60 bg-[#8FB4DC]/10 text-[#24507E] hover:bg-[#8FB4DC]/20",
    badge: "text-[#97751F] hover:text-[#6D5514]",
    footerText: "text-[#1B2A3D]/45",
  },
  {
    key: "sandstone-dune",
    labelKey: "linkInBio.theme.sandstoneDune",
    blurbKey: "linkInBio.theme.sandstoneDuneBlurb",
    mode: "light",
    page: "bg-[#F6EFE3]",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(196,138,84,0.25), transparent 70%), radial-gradient(420px 220px at 82% 0%, rgba(201,168,76,0.12), transparent 70%)",
    card: "border-[#D9BE96]/60 bg-gradient-to-b from-[#FFFDF7] to-[#F1E4CB] shadow-[0_10px_50px_rgba(150,110,55,0.14)]",
    pageText: "text-[#3B2E20]",
    name: "text-[#3B2E20]",
    headline: "text-[#A35A33]",
    bioText: "text-[#3B2E20]/65",
    linkButton: "border border-[#B4663A]/40 bg-gradient-to-r from-[#C97B4A] to-[#A85A30] text-white hover:brightness-105 shadow-[0_4px_24px_rgba(180,100,55,0.30)]",
    linkTitle: "",
    linkIcon: "",
    socialButton: "border-[#D9BE96]/70 bg-white/60 text-[#A35A33] hover:border-[#B4663A] hover:text-[#7E4322]",
    featuredCard: "border-[#E0CBA6]/70 bg-white/70 hover:border-[#B4663A]/60",
    sectionLabel: "text-[#A35A33]",
    featuredIcon: "text-[#B4663A]",
    featuredLabel: "text-[#3B2E20]",
    featuredKind: "text-[#3B2E20]/50",
    tipButton: "border-[#B4663A]/50 bg-[#B4663A]/10 text-[#8A4A26] hover:bg-[#B4663A]/20",
    badge: "text-[#A35A33] hover:text-[#7E4322]",
    footerText: "text-[#3B2E20]/45",
  },
  {
    key: "graphite-pro",
    labelKey: "linkInBio.theme.graphitePro",
    blurbKey: "linkInBio.theme.graphiteProBlurb",
    mode: "dark",
    page: "bg-[#0B0D10]",
    glow: "radial-gradient(600px 320px at 50% -60px, rgba(148,163,184,0.12), transparent 70%)",
    card: "border-white/15 bg-gradient-to-b from-[#2E333B] to-[#14171B] shadow-[0_0_60px_rgba(148,163,184,0.07)]",
    pageText: "text-white",
    name: "text-white",
    headline: "text-slate-300/90",
    bioText: "text-slate-400",
    linkButton: "border border-white/25 bg-slate-100 text-[#14171B] hover:bg-white shadow-[0_4px_24px_rgba(148,163,184,0.15)]",
    linkTitle: "text-[#14171B]",
    linkIcon: "text-[#5B6B7E]",
    socialButton: "border-white/15 bg-white/[0.04] text-slate-200 hover:border-slate-300/60 hover:text-white",
    featuredCard: "border-white/10 bg-white/[0.03] hover:border-slate-300/40",
    sectionLabel: "text-slate-300/80",
    featuredIcon: "text-slate-200",
    featuredLabel: "text-white/90",
    featuredKind: "text-white/35",
    tipButton: "border-slate-400/40 bg-white/[0.06] text-slate-100 hover:bg-white/10",
    badge: "text-slate-400 hover:text-white",
    footerText: "text-white/35",
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
    /* data-dark-lock: the presets are authored designs (creator-chosen
       content, not site chrome) — dark designs on dark grounds, light
       designs on light grounds. Without the lock, a visitor in the other
       site theme gets the preset grounds (uncovered hexes/zinc gradients
       survive) with the text remapped on top — dark-on-dark or washed-out.
       The lock keeps the page exactly as authored in both themes (same
       pattern as the hero). */
    <div data-dark-lock className={`min-h-screen ${theme.page} ${theme.pageText} flex flex-col items-center px-5 py-10 relative overflow-hidden`}>
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
            <p className={`mb-3 text-[11px] font-bold uppercase tracking-[0.2em] ${theme.sectionLabel}`}>Featured</p>
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
                    <FIcon className={`h-5 w-5 ${theme.featuredIcon} mb-2`} />
                    <p className={`text-sm font-semibold ${theme.featuredLabel} leading-snug line-clamp-2`}>{f.label}</p>
                    <p className={`mt-1 text-[11px] uppercase tracking-wider ${theme.featuredKind} capitalize`}>{f.kind}</p>
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
        <p className={`mt-10 text-center text-xs ${theme.footerText}`}>
          Made with{" "}
          <a href={shareUrl ?? "/"} className={`font-semibold ${theme.badge}`}>
            Bow Down Visuals
          </a>
        </p>
      </div>
    </div>
  );
}
