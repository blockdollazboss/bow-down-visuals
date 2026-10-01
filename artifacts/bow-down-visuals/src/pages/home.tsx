import { useState, useRef, forwardRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HeroLogo3D } from "@/components/CinematicHero";
import { SpotlightRig } from "@/components/SpotlightRig";
import { FogSettled } from "@/components/SettledFog";
import { MarketingBadge } from "@/components/MarketingBadge";
import { LuxReveal } from "@/components/LuxReveal";
import { JsonLd, buildFaqJsonLd } from "@/components/seo/json-ld";
import { ThreadsIcon } from "@/components/social-icons";
import {
  Music,
  Video,
  Film,
  Mic2,
  ChevronDown,
  ChevronRight,
  Zap,
  CheckCircle2,
  Sparkles,
  Target,
  Users,
  ArrowRight,
  Star,
  Globe,
  Lock,
  AlertCircle,
  Copy,
  Check,
  KeyRound,
  Crown,
  Handshake,
  Shirt,
  AudioLines,
  Clapperboard,
  Megaphone,
  CalendarCheck,
  DollarSign,
  Gift,
  Scissors,
  BadgeDollarSign,
  Rocket,
  Fingerprint,
  Trophy,
  GraduationCap,
  BookOpen,
  Palette,
  Podcast,
  Tv,
  Store,
} from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─────────────────────────── DATA ─────────────────────────── */

const STEPS = [
  {
    number: "01",
    title: "Lock In Your Artist",
    body: "Your vault holds your sound, look, and voice — every generation comes out unmistakably you.",
    icon: Target,
  },
  {
    number: "02",
    title: "Generate The Impossible",
    body: "Songs, videos, promo, branding — full AI generations in seconds, for a few Visual Bucs. No team, no waiting.",
    icon: Zap,
  },
  {
    number: "03",
    title: "Release Like A Label",
    body: "Schedule the rollout, pitch sponsors, drop merch. The business end, handled — while you create.",
    icon: Globe,
  },
];

const OUTPUT_TYPES = [
  "Full songs — audio included",
  "Cinematic music videos",
  "Lyric videos",
  "Promo clips",
  "Thumbnails",
  "Cover art",
  "AI voiceovers",
  "Lip-synced performances",
  "4K upscales",
  "Merch mockups",
  "Press kits",
  "Sponsor pitches",
];

const CREATOR_TYPES = [
  {
    title: "Independent Artists",
    body: "Move at your own speed. Generate professional content without a full team.",
    icon: Mic2,
  },
  {
    title: "Music Producers",
    body: "Build complete song concepts and pitch lyrics to artists instantly.",
    icon: Music,
  },
  {
    title: "Video Directors",
    body: "Get detailed scene treatments and visual direction for any sound.",
    icon: Video,
  },
  {
    title: "Content Creators",
    body: "Keep your feed alive with platform-ready captions and promo ideas.",
    icon: Film,
  },
  {
    title: "Record Labels",
    body: "Scale output across your entire roster without burning out your team.",
    icon: Users,
  },
  {
    title: "Managers & A&R",
    body: "Draft release strategies and pitch decks in minutes, not days.",
    icon: Star,
  },
];

/* Studio showcase — 4 categories × 3 cards. Every cost and route verified
   against credit-costs.ts and App.tsx. */
const STUDIO = [
  {
    category: "Create",
    tagline: "The music",
    icon: Sparkles,
    tools: [
      {
        title: "Make a Song",
        description: "Full songs — lyrics, melody, and production in minutes.",
        icon: Music,
        cost: "4 VB",
        href: "/make-song",
        featured: false,
      },
      {
        title: "Make a Music Video",
        description: "Cinematic AI scenes built for your track.",
        icon: Clapperboard,
        cost: "4 VB",
        href: "/make-video",
        featured: false,
      },
      {
        title: "Song + Video",
        description: "The full package — song and video in one flow.",
        icon: Mic2,
        cost: "4 VB",
        href: "/song-and-video",
        featured: true,
      },
    ],
  },
  {
    category: "Craft",
    tagline: "The polish",
    icon: Scissors,
    tools: [
      {
        title: "Video Editor",
        description: "Cut, caption, and grade — with lip sync built in.",
        icon: Scissors,
        cost: "Lip sync 3 VB",
        href: "/video-editor",
        featured: false,
      },
      {
        title: "AI Voiceover",
        description: "Studio-quality narration in any voice.",
        icon: AudioLines,
        cost: "2 VB/min",
        href: "/voiceover",
        featured: false,
      },
      {
        title: "Upscale",
        description: "Honest 1080p and 4K upscaling. No fake “enhance”.",
        icon: Rocket,
        cost: "3 VB",
        href: "/upscale",
        featured: false,
      },
    ],
  },
  {
    category: "Promote",
    tagline: "The rollout",
    icon: Megaphone,
    tools: [
      {
        title: "Promo Clips",
        description: "Scroll-stopping clips for TikTok, Reels, and Shorts.",
        icon: Film,
        cost: "4 VB",
        href: "/promo-clip",
        featured: false,
      },
      {
        title: "Hook Studio",
        description: "First-3-second hooks plus a virality pre-flight check.",
        icon: Zap,
        cost: "1 VB",
        href: "/hooks",
        featured: false,
      },
      {
        title: "Scheduler",
        description: "Auto-post to Instagram, TikTok, and Facebook.",
        icon: CalendarCheck,
        cost: "1 VB/post",
        href: "/scheduler",
        featured: false,
      },
    ],
  },
  {
    category: "Get Paid",
    tagline: "The business",
    icon: BadgeDollarSign,
    tools: [
      {
        title: "Monetization Coach",
        description: "Your 30-day money plan, platform by platform.",
        icon: DollarSign,
        cost: "1 VB",
        href: "/coach",
        featured: false,
      },
      {
        title: "Sponsor Match",
        description: "AI-matched brand deals, plus pitches that close.",
        icon: Handshake,
        cost: "1 VB",
        href: "/sponsors",
        featured: false,
      },
      {
        title: "Merch Designer",
        description: "AI merch mockups — dropship-ready.",
        icon: Shirt,
        cost: "3 VB",
        href: "/merch",
        featured: false,
      },
    ],
  },
];

const CREDIT_PACKS = [
  {
    credits: "1,000 Visual Bucs",
    price: "$9",
    packKey: "10",
    featured: false,
    perks: ["1,000 generation Visual Bucs", "Never expires", "Instant top-up"],
  },
  {
    credits: "5,000 Visual Bucs",
    price: "$39",
    packKey: "50",
    featured: false,
    perks: ["5,000 generation Visual Bucs", "Never expires", "Instant top-up"],
  },
  {
    credits: "15,000 Visual Bucs",
    price: "$99",
    packKey: "150",
    featured: true,
    perks: ["15,000 generation Visual Bucs", "Never expires", "Best value"],
  },
  {
    credits: "50,000 Visual Bucs",
    price: "$249",
    packKey: "500",
    featured: false,
    perks: ["50,000 generation Visual Bucs", "Never expires", "Pro volume"],
  },
];

const FAQS = [
  {
    q: "What is Bow Down Visuals?",
    a: "The AI studio for content creators — 80+ tools that write your songs, shoot your videos, cut your promo, design your brand, and run your business. One account, one Visual Buc system, no team required.",
  },
  {
    q: "How do Visual Bucs work?",
    a: "Visual Bucs are the fuel. You buy them in packs starting at $9, and every AI generation spends a few — a full song is 400 Visual Bucs, a music video is 400, a hook idea is 100. Browsing, editing, and viewing are always free. Payments are in test mode right now, so nothing real is charged.",
  },
  {
    q: "What does a full release cost?",
    a: "A song (400 VB) + a music video (400 VB) + promo clips (400 VB) + a hook pack (100 VB) = 1,300 Visual Bucs. The entire release pipeline — song to promo — for less than the cost of one pack.",
  },
  {
    q: "Do I need experience to use it?",
    a: "No. Describe your vision in plain words — genre, mood, artist, idea — and the studio handles the craft. Advanced controls are there when you want them, never in your way when you don't.",
  },
  {
    q: "Can I use what I generate commercially?",
    a: "Yes. Songs, videos, artwork, copy — what you generate is yours to release, sell, and promote anywhere.",
  },
  {
    q: "Is the site fully launched?",
    a: "We're in beta and shipping constantly — new tools land all the time. Payments are in test mode while we polish, so explore the studio freely.",
  },
  {
    q: "Why “cheat code”?",
    a: "Because it feels like one. Your competitors will think you hired a team. You didn't — you just got here first.",
  },
];

const SOFTWARE_APPLICATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Bow Down Visuals",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  description:
    "Bow Down Visuals — the AI studio for content creators. Generate songs, music videos, promo clips, branding, and business tools: 80+ AI features on simple Visual Buc pricing.",
  offers: {
    "@type": "AggregateOffer",
    priceCurrency: "USD",
    lowPrice: "9",
    highPrice: "249",
    offerCount: "4",
  },
};

const HOME_FAQ_JSON_LD = buildFaqJsonLd(FAQS.map((f) => ({ q: f.q, a: f.a })));

/* ──────────────────── Capability ticker ──────────────────── */

const TICKER_ITEMS = [
  "Full songs in minutes",
  "Cinematic music videos",
  "Lip sync that actually syncs",
  "AI voiceovers",
  "Lyric videos",
  "Promo clips on demand",
  "Hooks that stop the scroll",
  "Auto-post to IG · TikTok · FB",
  "Thumbnails & cover art",
  "4K upscaling",
  "Sponsor matching",
  "Merch mockups",
  "Press kits in minutes",
  "Your 30-day money plan",
];

function CheatCodeTicker() {
  const row = [...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <div
      className="lux-marquee lux-marquee-mask relative overflow-hidden border-b border-white/[0.06] bg-black/40 py-5"
      aria-hidden="true"
    >
      <div className="lux-marquee-track flex w-max">
        {row.map((item, i) => (
          <span key={i} className="flex items-center gap-10 pr-10">
            <span className="whitespace-nowrap text-[13px] font-semibold uppercase tracking-[0.24em] text-white/40">
              {item}
            </span>
            <span className="h-1.5 w-1.5 rotate-45 bg-primary/60 shrink-0" />
          </span>
        ))}
      </div>
    </div>
  );
}

function SectionDivider() {
  return (
    <div className="mx-auto max-w-6xl px-5" aria-hidden="true">
      <div className="lux-divider" />
    </div>
  );
}

/* ──────────────────── Share row ──────────────────── */

const SHARE_TEXT = "The content creator's cheat code — songs, videos & promo in seconds";
const SHARE_URL = "https://bowdownvisuals.com/";

function XIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function FacebookIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function ShareRow({ label = "Spread the code" }: { label?: string }) {
  const [copied, setCopied] = useState(false);
  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(SHARE_URL)}`;
  const fbHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SHARE_URL)}`;
  const threadsHref = `https://www.threads.com/intent/post?text=${encodeURIComponent(`${SHARE_TEXT} ${SHARE_URL}`)}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${SHARE_TEXT} ${SHARE_URL}`);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = `${SHARE_TEXT} ${SHARE_URL}`;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const btn =
    "flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-white/50 transition-all duration-200 hover:border-primary/50 hover:text-primary hover:bg-primary/10";

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-white/35">{label}</span>
      <a href={xHref} target="_blank" rel="noopener noreferrer" aria-label="Share on X" className={btn}>
        <XIcon className="h-3.5 w-3.5" />
      </a>
      <a href={fbHref} target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook" className={btn}>
        <FacebookIcon className="h-3.5 w-3.5" />
      </a>
      <a href={threadsHref} target="_blank" rel="noopener noreferrer" aria-label="Share on Threads" className={btn}>
        <ThreadsIcon className="h-3.5 w-3.5" />
      </a>
      <button onClick={copyLink} aria-label="Copy link" className={btn}>
        {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {copied && <span className="text-xs font-medium text-primary">Copied</span>}
    </div>
  );
}

/* ──────────────────── Konami easter egg ──────────────────── */

const KONAMI = [
  "arrowup", "arrowup", "arrowdown", "arrowdown",
  "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a",
];

function KonamiEgg() {
  const [fired, setFired] = useState(false);
  const pos = useRef(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const k = e.key.toLowerCase();
      if (k === KONAMI[pos.current]) {
        pos.current += 1;
        if (pos.current === KONAMI.length) {
          pos.current = 0;
          setFired(true);
        }
      } else {
        pos.current = k === KONAMI[0] ? 1 : 0;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!fired) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/92 p-5 backdrop-blur-sm"
      onClick={() => setFired(false)}
      role="dialog"
      aria-label="Cheat code accepted"
    >
      <style>{`
        @keyframes konami-flash { 0% { opacity: 0; transform: scale(0.92); } 18% { opacity: 1; transform: scale(1); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes konami-glow { 0%, 100% { box-shadow: 0 0 40px rgba(212,175,55,0.35), 0 0 120px rgba(212,175,55,0.15); } 50% { box-shadow: 0 0 70px rgba(212,175,55,0.6), 0 0 160px rgba(212,175,55,0.25); } }
        @media (prefers-reduced-motion: reduce) { .konami-anim { animation: none !important; } }
      `}</style>
      <div
        className="konami-anim relative max-w-md rounded-[2rem] border border-primary/40 bg-gradient-to-b from-yellow-950/40 to-black p-10 text-center"
        style={{ animation: "konami-flash 0.5s ease-out, konami-glow 2.4s ease-in-out infinite" }}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src="/cheat-code-avatar.webp"
          alt="Thy Cheat Code — the Shark King"
          className="mx-auto mb-6 h-32 w-32 rounded-full border-2 border-primary object-cover"
        />
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.3em] text-primary">
          Cheat code accepted
        </p>
        <h3 className="mb-3 font-display text-3xl italic text-white">
          You were always one of us.
        </h3>
        <p className="mb-8 text-sm leading-relaxed text-white/55">
          Up, up, down, down — the oldest code in the book, and you knew it.
          Welcome to the unfair advantage.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/signup">
            <Button variant="luxury" className="w-full sm:w-auto gap-2">
              <KeyRound className="h-4 w-4" /> Claim your access
            </Button>
          </Link>
          <Button variant="outline" onClick={() => setFired(false)} className="border-primary/30 text-primary hover:bg-primary/10">
            Keep it quiet
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── COMPONENTS ─────────────────────────── */

function HeroSection() {
  function scrollToDemo() {
    document.getElementById("demo")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <section className="relative min-h-[calc(100svh-4rem)] flex items-center px-5 pb-16 pt-[180px] -mt-[88px] overflow-hidden">
      {/* Background — glows + grid dissolve into the next section: one continuous surface, no seam */}
      <div
        className="absolute inset-0 z-0"
        aria-hidden="true"
        style={{
          maskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 70%, transparent 100%)",
        }}
      >
        {/* Background glow effects */}
        <div className="absolute inset-0">
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full blur-[140px] pointer-events-none"
            style={{
              background:
                "radial-gradient(circle, rgba(212,160,23,0.13) 0%, transparent 70%)",
            }}
          />
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full blur-[100px] pointer-events-none"
            style={{ background: "rgba(212,160,23,0.08)" }}
          />
          <div
            className="absolute top-1/4 left-1/4 w-[300px] h-[300px] rounded-full blur-[90px] pointer-events-none"
            style={{ background: "rgba(212,160,23,0.06)" }}
          />
          <div
            className="absolute bottom-1/3 right-1/4 w-[250px] h-[250px] rounded-full blur-[90px] pointer-events-none"
            style={{ background: "rgba(212,160,23,0.05)" }}
          />
        </div>

        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      {/* Film grain + vignette — quiet cinematic depth */}
      <div className="lux-grain z-[1]" aria-hidden="true" />
      <div className="lux-vignette z-[1]" aria-hidden="true" />

      {/* Hero spotlights — six beams living at the top of the page, washing
          down to the King's feet. Anchored to the hero (absolute): they
          stay at the top and scroll away naturally — they never follow
          you down the page.
          z-[2]: above the backdrop grain, BELOW the hero copy (text stays
          on top) and below the curtain overlay (curtains drape over the
          beams). */}
      <SpotlightRig className="absolute inset-x-0 top-0 z-[2] h-[92%]" />

      {/* Hero grid — no z-index here on purpose: the shark and the copy
          stack independently against the fixed curtain overlay (z-[5]).
          The shark (z-[4]) slides BEHIND the curtain drapes when scrolling;
          the copy (z-10) stays on top. */}
      <div className="relative mx-auto w-full max-w-7xl grid items-center gap-10 lg:grid-cols-2 pr-[16%] sm:pr-[10%] lg:pr-[4%]">
        {/* Hero Logo — cinematic 3D mouse-tracked motion, middle of the page.
            z-[4]: below the fixed curtain overlay (z-[5]) so the King scrolls
            behind the drapes when the hero scrolls away; above the beams. */}
        <div className="relative z-[4] flex justify-center">
          <HeroLogo3D />
        </div>

        {/* Copy — right side. z-10: headline, subtext and buttons stay
            above the fixed curtain overlay (z-[5]). */}
        <div className="relative z-10 text-center lg:text-left space-y-5 lg:pt-[10%]">
        {/* Readability scrim — soft dark halo behind the copy so the raised
            fog never washes out the text. Lives inside the copy's z-10
            stacking context at z-[-1]: behind the words, above the fog. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-10 -inset-y-8 z-[-1] rounded-[3rem]"
          style={{
            background:
              "radial-gradient(ellipse at 50% 62%, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0.24) 52%, transparent 76%)",
          }}
        />

        {/* Positioning — the quiet luxury whisper */}
        <p className="font-display italic text-xl sm:text-2xl text-primary/90 leading-snug">
          The content creator&rsquo;s cheat code
        </p>

        {/* Top badges — clearance + refer & earn */}
        <div className="flex flex-wrap items-center justify-center lg:justify-start gap-3">
        {/* Clearance badge */}
        <Link href="/beta-access">
          <div
            className="inline-flex items-center gap-2 bg-primary/10 border border-primary/50 rounded-full px-4 py-1.5 text-sm font-bold text-primary hover:bg-primary/20 transition-colors cursor-pointer shimmer"
            style={{ boxShadow: "0 0 18px rgba(212,160,23,0.25)" }}
          >
            <KeyRound className="h-3.5 w-3.5" />
            Restricted beta — clearance open
          </div>
        </Link>
        {/* Refer & Earn badge — gentle attention nudge, links to /referrals */}
        <Link href="/referrals">
          <div className="refer-nudge inline-flex items-center gap-2 bg-gradient-to-r from-[#C9A84C] to-[#e8c86a] rounded-full px-4 py-1.5 text-sm font-bold text-black hover:brightness-110 transition cursor-pointer">
            <Gift className="h-3.5 w-3.5" />
            Refer &amp; Earn · 25%
          </div>
        </Link>
        </div>

        {/* Headline */}
        <h1 className="text-[32px] sm:text-6xl xl:text-7xl font-black tracking-[-0.02em] text-white leading-[0.95] break-words">
          Your competitors will think you{" "}
          <span className="gold-text-shine">hired a team.</span>
        </h1>

        {/* Slogan */}
        <p className="text-base sm:text-lg font-semibold tracking-widest text-primary/80 uppercase">
          This feels like cheating. That&rsquo;s the point.
        </p>

        {/* Subheadline */}
        <p className="text-lg sm:text-xl text-white/55 max-w-2xl mx-auto lg:mx-0 leading-relaxed">
          Bow Down Visuals is the AI studio that writes your songs, shoots
          your videos, cuts your promo, and runs your business — 80+ tools,
          one Visual Buc system, zero permission needed.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 pt-4">
          <Link href="/signup">
            <Button
              size="lg"
              variant="luxury"
              className="w-full sm:w-auto text-base h-14 px-10 rounded-full gap-2"
            >
              <KeyRound className="h-4 w-4" /> Claim your access <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Button
            size="lg"
            variant="outline"
            onClick={scrollToDemo}
            className="w-full sm:w-auto text-base h-14 px-10 rounded-full border-primary/30 bg-primary/[0.04] text-primary hover:bg-primary/10 hover:border-primary/60 hover:text-primary font-semibold gap-2 transition-all duration-300"
          >
            <Sparkles className="h-4 w-4" /> Watch it work
          </Button>
        </div>

        {/* Returning users */}
        <p className="text-sm text-white/40">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-primary hover:text-primary/80 underline underline-offset-4 transition-colors">
            Sign in
          </Link>
        </p>

        {/* Social proof — true claims only */}
        <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-8 gap-y-3 pt-4 text-sm text-white/35 font-medium">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-primary/60" /> Pay only for
            what you create
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-primary/60" /> No
            subscription, ever
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-primary/60" /> Results in
            seconds
          </span>
        </div>

        {/* Share */}
        <div className="flex justify-center lg:justify-start pt-2">
          <ShareRow />
        </div>
        </div>
      </div>

      {/* Ground fog — thin settled smoke layer (fog-lab version C) rising to
          the King's ankles so he reads as standing IN the fog.
          z-[4], placed after the hero grid: same level as the shark but
          later in the DOM, so it veils his feet instead of hiding behind
          him. Still below the curtain overlay (z-[5]) and the copy (z-10).
          Dimmed a touch (brightness 0.85); whip the mouse through it and the
          layer tears, swirls and re-settles. */}
      <FogSettled
        className="inset-x-0 bottom-0 z-[4] h-[58%]"
        layerFrac={0.45}
        brightness={0.85}
      />

      {/* Scroll hint */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce opacity-40">
        <ChevronDown className="h-5 w-5 text-white" />
      </div>
    </section>
  );
}

/* ───── "Watch the cheat code work" — simulated preview, pure frontend theater.
   Clearly labeled as a taste, never the real generator. No credits, no API. ───── */

const DEMO_VIBES = [
  {
    id: "hiphop",
    label: "Hip-Hop",
    lyrics: [
      "Came from the bottom, now the penthouse views,",
      "Turned every loss into headline news,",
      "They counted me out, now they countin' my wins,",
      "Started with a dream, now the empire begins.",
    ],
    treatment: [
      "OPEN — city rooftop at golden hour, slow push-in on the artist.",
      "HOOK — drone orbit over the skyline, lights moving in perfect sync.",
    ],
    hook: "new era. hip-hop, out now.",
  },
  {
    id: "rnb",
    label: "R&B",
    lyrics: [
      "Velvet nights and your love on repeat,",
      "Slow dance in the dark to our own heartbeat,",
      "Every whisper got me fallin' deeper in,",
      "Don't let the morning light the night we're in.",
    ],
    treatment: [
      "OPEN — dim loft, candlelight, silk in slow motion.",
      "CHORUS — rain on the window, close-ups, everything glowing amber.",
    ],
    hook: "for the lovers. new r&b single, out now.",
  },
  {
    id: "pop",
    label: "Pop",
    lyrics: [
      "Neon hearts and we're dancing on air,",
      "Hands up high like we don't have a care,",
      "This night's electric, feel the bassline drop,",
      "We don't ever wanna make this stop.",
    ],
    treatment: [
      "OPEN — festival main stage, confetti cannons, fifty thousand hands up.",
      "DROP — hyper-cut choreography, strobe sync, skyline fireworks.",
    ],
    hook: "your new obsession. pop anthem, out now.",
  },
];

function CheatCodeDemo() {
  const [vibeId, setVibeId] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const timers = useRef<number[]>([]);
  const sectionRef = useRef<HTMLElement | null>(null);
  const autoRan = useRef(false);

  useEffect(() => {
    const stash = timers.current;
    return () => stash.forEach((t) => window.clearTimeout(t));
  }, []);

  // Auto-play the Hip-Hop sample the first time the demo scrolls into view.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!autoRan.current && entries.some((e) => e.isIntersecting)) {
          autoRan.current = true;
          run("hiphop");
          io.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function run(id: string) {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setVibeId(id);
    setStage(0);
    [1, 2, 3, 4].forEach((s, i) => {
      timers.current.push(window.setTimeout(() => setStage(s), 900 * (i + 1)));
    });
  }

  const vibe = DEMO_VIBES.find((v) => v.id === vibeId) ?? null;
  const running = vibeId !== null && stage < 4;

  return (
    <section id="demo" ref={sectionRef} className="scroll-mt-20 py-20 md:py-28 px-5 relative">
      <style>{`
        @keyframes demo-stage-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes demo-pulse-dot { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .demo-anim { animation: none !important; } }
      `}</style>
      <LuxReveal className="max-w-4xl mx-auto">
        <div className="text-center mb-10 space-y-4">
          <MarketingBadge variant="kicker">Taste the cheat code</MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            Watch it work. Then imagine it working{" "}
            <span className="gold-text-shine">for you.</span>
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            Pick a vibe. This is a simulated preview — the real studio
            generates the real thing.
          </p>
        </div>

        <div className="lux-panel rounded-[2rem] p-6 sm:p-10">
          {/* Vibe picker */}
          <div className="flex flex-wrap justify-center gap-3 mb-8">
            {DEMO_VIBES.map((v) => (
              <button
                key={v.id}
                onClick={() => run(v.id)}
                className={`rounded-full px-6 py-2.5 text-sm font-bold transition-all duration-200 border ${
                  vibeId === v.id
                    ? "bg-primary text-black border-transparent shadow-[0_0_24px_rgba(218,165,32,0.4)]"
                    : "border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* Stage output */}
          <div className="min-h-[280px]">
            {!vibe && (
              <div className="flex h-[280px] items-center justify-center text-center">
                <p className="text-white/30 text-sm max-w-xs">
                  Choose a vibe above and watch lyrics, video treatment, and
                  promo hook materialize — in seconds.
                </p>
              </div>
            )}

            {vibe && (
              <div className="space-y-5">
                {stage >= 1 && (
                  <div className="demo-anim rounded-2xl border border-white/[0.07] bg-black/40 p-6" style={{ animation: "demo-stage-in 0.5s ease-out" }}>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-primary">Lyrics</span>
                      {stage === 1 && running && (
                        <span className="flex items-center gap-1.5 text-[11px] text-white/40">
                          <span className="demo-anim h-1.5 w-1.5 rounded-full bg-primary" style={{ animation: "demo-pulse-dot 1s infinite" }} />
                          Writing…
                        </span>
                      )}
                    </div>
                    {vibe.lyrics.map((line, i) => (
                      <p key={i} className="font-display italic text-lg text-white/85 leading-relaxed">“{line}”</p>
                    ))}
                  </div>
                )}

                {stage >= 2 && (
                  <div className="demo-anim rounded-2xl border border-white/[0.07] bg-black/40 p-6" style={{ animation: "demo-stage-in 0.5s ease-out" }}>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-primary">Video treatment</span>
                      {stage === 2 && running && (
                        <span className="flex items-center gap-1.5 text-[11px] text-white/40">
                          <span className="demo-anim h-1.5 w-1.5 rounded-full bg-primary" style={{ animation: "demo-pulse-dot 1s infinite" }} />
                          Directing…
                        </span>
                      )}
                    </div>
                    {vibe.treatment.map((line, i) => (
                      <p key={i} className="text-sm text-white/70 leading-relaxed mb-1.5">{line}</p>
                    ))}
                  </div>
                )}

                {stage >= 3 && (
                  <div className="demo-anim rounded-2xl border border-primary/25 bg-primary/[0.06] p-6" style={{ animation: "demo-stage-in 0.5s ease-out" }}>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-primary">Promo hook</span>
                      {stage === 3 && running && (
                        <span className="flex items-center gap-1.5 text-[11px] text-white/40">
                          <span className="demo-anim h-1.5 w-1.5 rounded-full bg-primary" style={{ animation: "demo-pulse-dot 1s infinite" }} />
                          Cutting…
                        </span>
                      )}
                    </div>
                    <p className="text-base font-semibold text-white">“{vibe.hook}”</p>
                  </div>
                )}

                {stage >= 4 && (
                  <div className="demo-anim pt-2 text-center" style={{ animation: "demo-stage-in 0.5s ease-out" }}>
                    <p className="mb-4 text-xs uppercase tracking-[0.2em] text-white/35">
                      Simulated preview — the real thing is behind the door
                    </p>
                    <Link href="/signup">
                      <Button variant="luxury" size="lg" className="rounded-full px-8 gap-2">
                        <KeyRound className="h-4 w-4" /> Sign in to generate for real
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </LuxReveal>
    </section>
  );
}

/* ───── Proof band — real numbers only, counted from the repo ───── */

const PROOF_STATS = [
  { value: "81", label: "AI tools under one roof" },
  { value: "$9", label: "Cheapest Visual Bucs pack" },
  { value: "4 VB", label: "A full song, start to finish" },
  { value: "0", label: "Subscriptions. Ever." },
];

function ProofBand() {
  return (
    <section aria-label="By the numbers" className="py-14 px-5 border-y border-white/[0.06] bg-black/40">
      <LuxReveal className="max-w-6xl mx-auto">
        <p className="text-center text-[11px] font-bold uppercase tracking-[0.3em] text-primary/80 mb-8">
          The receipts — real numbers from the real studio
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {PROOF_STATS.map((s) => (
            <div key={s.label}>
              <div className="gold-text-shine text-4xl md:text-5xl font-black tracking-tight">
                {s.value}
              </div>
              <div className="mt-2 text-sm text-white/45 font-medium">{s.label}</div>
            </div>
          ))}
        </div>
      </LuxReveal>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20 py-20 md:py-28 px-5 relative">
      <LuxReveal className="max-w-6xl mx-auto">
        <div className="text-center mb-16 space-y-4">
          <MarketingBadge variant="kicker">
            How It Works
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            Idea to empire in minutes
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            No team. No budget meetings. Just you and the code.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          {/* Connector line (desktop only) */}
          <div className="hidden md:block absolute top-16 left-1/3 right-1/3 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent pointer-events-none" />

          {STEPS.map((step) => (
            <div
              key={step.number}
              className="relative flex flex-col items-center text-center p-8 rounded-2xl lux-panel lux-card-lift group"
            >
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-10 text-5xl font-black text-primary/40 select-none pointer-events-none drop-shadow-[0_0_12px_rgba(201,168,76,0.3)]">
                {step.number}
              </div>
              <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6 mt-4 group-hover:bg-primary/20 transition-colors">
                <step.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">
                {step.title}
              </h3>
              <p className="text-white/50 leading-relaxed text-sm">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </LuxReveal>
    </section>
  );
}

function WhatYouCanMake() {
  return (
    <section className="py-20 md:py-28 px-5 bg-gradient-to-b from-transparent via-yellow-950/10 to-transparent">
      <LuxReveal className="max-w-6xl mx-auto">
        <div className="text-center mb-14 space-y-4">
          <MarketingBadge variant="kicker">
            What You Can Make
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            Everything your release needs
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            One studio. Every asset your music career demands — generated,
            not delegated.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {OUTPUT_TYPES.map((type, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-primary/30 hover:bg-primary/5 hover:-translate-y-0.5 transition-all duration-300 group"
            >
              <div className="h-1.5 w-1.5 rounded-full bg-primary group-hover:scale-150 transition-transform shrink-0" />
              <span className="text-sm font-medium text-white/70 group-hover:text-white transition-colors">
                {type}
              </span>
            </div>
          ))}
        </div>
      </LuxReveal>
    </section>
  );
}

function BuiltForCreators() {
  return (
    <section className="py-20 md:py-28 px-5">
      <LuxReveal className="max-w-6xl mx-auto">
        <div className="text-center mb-16 space-y-4">
          <MarketingBadge variant="kicker">
            Built For
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            Built for content creators
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            Whether you&rsquo;re a YouTuber, streamer, podcaster, musician, or running a full media brand, Bow Down
            Visuals was made for you.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {CREATOR_TYPES.map((creator) => (
            <div
              key={creator.title}
              className="group p-7 rounded-2xl lux-panel lux-card-lift"
            >
              <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center mb-5 group-hover:bg-primary/20 transition-colors">
                <creator.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold text-white text-lg mb-2">
                {creator.title}
              </h3>
              <p className="text-white/50 text-sm leading-relaxed">
                {creator.body}
              </p>
            </div>
          ))}
        </div>

        {/* Formats strip — not just music: movies, podcasts, streaming */}
        <div className="mt-12 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 md:p-8">
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.3em] text-primary/80 mb-6">
            Not a musician? Good. It&rsquo;s not just music.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { icon: Film, title: "Movies & Series", body: "Your next binge-worthy hit starts here.", href: "/movies" },
              { icon: Podcast, title: "Podcasts", body: "Record, polish, and publish — all in the studio.", href: "/podcast" },
              { icon: Tv, title: "Streamers", body: "Stream packs and go-live tools for your broadcast.", href: "/go-live" },
            ].map((f) => (
              <Link
                key={f.title}
                href={f.href}
                className="group flex items-center gap-4 p-4 rounded-xl hover:bg-white/[0.04] transition-colors"
              >
                <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <f.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold text-white text-sm">{f.title}</h4>
                  <p className="text-white/45 text-xs mt-0.5">{f.body}</p>
                </div>
                <ChevronRight className="h-4 w-4 ml-auto text-primary/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      </LuxReveal>
    </section>
  );
}

/* ───── Signature moment: the manifesto. One full-bleed statement. ───── */

function ManifestoBand() {
  return (
    <section aria-label="Manifesto" className="relative overflow-hidden">
      <LuxReveal>
        <div className="relative flex min-h-[68svh] items-center justify-center px-5 py-24">
          {/* Shark King backdrop */}
          <img
            src="/bowdownvisuals-banner-sharkking.jpg"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover opacity-45"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black via-black/55 to-black" aria-hidden="true" />
          <div className="absolute inset-0 lux-vignette" aria-hidden="true" />

          <div className="relative z-10 max-w-4xl text-center">
            <div className="mb-6 flex justify-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-black/60 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.3em] text-primary">
                <Crown className="h-3.5 w-3.5" /> A message from the king
              </span>
            </div>
            <h2 className="font-display text-6xl sm:text-7xl md:text-8xl font-black tracking-tight text-white leading-none">
              BOW <span className="gold-text-shine">DOWN.</span>
            </h2>
            <p className="mx-auto mt-6 max-w-2xl font-display text-xl sm:text-2xl italic text-white/80 leading-relaxed">
              The industry had its turn. 80+ AI tools. One cheat code.
              Zero permission needed.
            </p>
            <p className="mt-8 text-xs text-white/30 font-medium tracking-wide">
              Rumor: this page has a cheat code.{" "}
              <span className="text-primary/60 font-mono">↑↑↓↓←→←→</span>
            </p>
          </div>
        </div>
      </LuxReveal>
    </section>
  );
}

/* ───── Studio showcase — the full arsenal, grouped ───── */

function StudioShowcase() {
  return (
    <section
      id="tools"
      className="scroll-mt-20 py-20 md:py-28 px-5 bg-gradient-to-b from-transparent via-yellow-950/10 to-transparent"
    >
      <LuxReveal className="max-w-6xl mx-auto">
        <div className="text-center mb-16 space-y-4">
          <MarketingBadge variant="kicker">
            The Studio
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            One login. The whole machine.
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            Create the music, polish the craft, promote the release, get
            paid — without leaving the building.
          </p>
        </div>

        <div className="space-y-12">
          {STUDIO.map((cat) => (
            <div key={cat.category}>
              <div className="mb-6 flex items-center gap-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <cat.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white leading-tight">
                    {cat.category}
                    <span className="ml-3 text-sm font-medium text-white/35">
                      {cat.tagline}
                    </span>
                  </h3>
                </div>
                <div className="flex-1 h-px bg-gradient-to-r from-primary/25 to-transparent" aria-hidden="true" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {cat.tools.map((tool) => (
                  <div
                    key={tool.title}
                    className={`relative group flex flex-col p-7 rounded-2xl lux-card-lift ${
                      tool.featured
                        ? "royal-border bg-primary/10 shadow-[0_0_30px_rgba(218,165,32,0.18)]"
                        : "lux-panel"
                    }`}
                  >
                    {tool.featured && (
                      <div className="absolute -top-3 left-6">
                        <MarketingBadge variant="popular">
                          <Star className="h-2.5 w-2.5" /> Most Popular
                        </MarketingBadge>
                      </div>
                    )}

                    <div
                      className={`h-12 w-12 rounded-xl flex items-center justify-center mb-5 ${
                        tool.featured
                          ? "bg-primary text-white"
                          : "bg-white/5 group-hover:bg-primary/20 transition-colors"
                      }`}
                    >
                      <tool.icon
                        className={`h-6 w-6 ${tool.featured ? "text-white" : "text-primary"}`}
                      />
                    </div>

                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-2 gap-2">
                        <h4 className="font-semibold text-white text-lg leading-tight">
                          {tool.title}
                        </h4>
                        <MarketingBadge variant="muted" className="shrink-0">
                          {tool.cost}
                        </MarketingBadge>
                      </div>
                      <p className="text-white/50 text-sm leading-relaxed">
                        {tool.description}
                      </p>
                    </div>

                    <Link
                      href={tool.href}
                      className="mt-6 flex items-center gap-2 text-sm font-semibold text-primary hover:text-yellow-300 transition-colors group/link"
                    >
                      Open this tool{" "}
                      <ChevronRight className="h-4 w-4 group-hover/link:translate-x-1 transition-transform" />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-12 text-center text-sm text-white/40">
          Plus cover art, logos, thumbnails, press kits, lyric videos, and 70+
          more —{" "}
          <Link href="/features" className="font-semibold text-primary hover:text-yellow-300 transition-colors">
            browse the full arsenal <ArrowRight className="inline h-3.5 w-3.5" />
          </Link>
        </p>
      </LuxReveal>
    </section>
  );
}

function PricingSection() {
  return (
    <section id="pricing" className="scroll-mt-20 py-20 md:py-28 px-5">
      <LuxReveal className="max-w-5xl mx-auto">
        <div className="text-center mb-12 space-y-4">
          <MarketingBadge variant="kicker">
            Visual Buc Packs
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            Pay per creation. That&rsquo;s it.
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            Buy Visual Bucs once, use them any time. No subscription required.
          </p>
        </div>

        {/* Test mode notice */}
        <div className="flex items-center justify-center gap-2 mb-10 px-4 py-3 rounded-xl border border-yellow-500/20 bg-yellow-500/[0.06] max-w-lg mx-auto">
          <AlertCircle className="h-4 w-4 text-yellow-400 shrink-0" />
          <span className="text-sm text-yellow-200/70">
            Payments are in{" "}
            <strong className="text-yellow-300">test mode</strong>. No real
            money is charged.
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {CREDIT_PACKS.map((pack) => (
            <div
              key={pack.packKey}
              className={`relative flex flex-col p-6 rounded-2xl lux-card-lift ${
                pack.featured ? "royal-border bg-primary/[0.08]" : "lux-panel"
              }`}
            >
              {pack.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <MarketingBadge variant="popular">Best value</MarketingBadge>
                </div>
              )}
              <div className="mb-5">
                <p className="text-sm font-bold text-white/40 uppercase tracking-widest mb-1">
                  {pack.credits}
                </p>
                <div className="text-3xl font-black text-primary mb-1">
                  {pack.price}
                </div>
              </div>

              <ul className="space-y-2 flex-1 mb-6">
                {pack.perks.map((perk) => (
                  <li
                    key={perk}
                    className="flex items-center gap-2.5 text-sm text-white/60"
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary/60" />
                    {perk}
                  </li>
                ))}
              </ul>

              <Button
                asChild
                className="w-full font-semibold"
                variant={pack.featured ? "luxury" : "outline"}
              >
                <Link href="/pricing#credit-packs">Buy Visual Bucs</Link>
              </Button>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-white/25 font-medium mt-6 flex items-center justify-center gap-1.5">
          <Lock className="h-3 w-3" />
          Sign in to purchase Visual Bucs.
        </p>
      </LuxReveal>
    </section>
  );
}

function ReferralPromo() {
  return (
    <section className="py-20 md:py-28 px-5">
      <LuxReveal className="max-w-5xl mx-auto">
        <div className="relative overflow-hidden rounded-3xl border border-[#C9A84C]/30 bg-gradient-to-br from-[#C9A84C]/10 via-black to-black p-8 md:p-12">
          <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#C9A84C]/10 rounded-full blur-[100px] pointer-events-none" />
          <div className="relative z-10 text-center space-y-6">
            <MarketingBadge variant="kicker">
              Refer & Earn
            </MarketingBadge>
            <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
              Bring creators. <span className="text-[#e8c86a]">Get paid in credits.</span>
            </h2>
            <p className="text-white/60 text-lg max-w-2xl mx-auto">
              Share your link. Your friends get <span className="text-white font-semibold">10 free credits</span> to start creating.
              You earn <span className="text-white font-semibold">25% of everything they buy</span> for 90 days.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
              <a
                href="/referrals"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#C9A84C] to-[#e8c86a] px-8 py-4 text-black font-bold text-lg hover:brightness-110 transition shadow-[0_0_30px_rgba(201,168,76,0.3)]"
              >
                <Gift className="h-5 w-5" />
                Get My Referral Link
              </a>
              <a
                href="/signup"
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-8 py-4 text-white font-semibold hover:bg-white/5 transition"
              >
                Start Creating
              </a>
            </div>
            <p className="text-white/30 text-sm">
              No limits. No gimmicks. Just creators helping creators.
            </p>
          </div>
        </div>
      </LuxReveal>
    </section>
  );
}

function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section
      id="faq"
      className="scroll-mt-20 py-20 md:py-28 px-5 bg-gradient-to-b from-transparent via-yellow-950/8 to-transparent"
    >
      <LuxReveal className="max-w-3xl mx-auto">
        <div className="text-center mb-14 space-y-4">
          <MarketingBadge variant="kicker">
            FAQ
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            Frequently asked questions
          </h2>
        </div>

        <div className="space-y-3">
          {FAQS.map((faq, i) => (
            <div
              key={i}
              className={`rounded-xl border transition-all duration-200 overflow-hidden ${
                openIndex === i
                  ? "border-primary/30 bg-primary/5"
                  : "border-white/[0.06] bg-white/[0.02] hover:border-white/10"
              }`}
            >
              <button
                className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
              >
                <span className="font-semibold text-white text-base">
                  {faq.q}
                </span>
                <ChevronDown
                  className={`h-5 w-5 text-primary shrink-0 transition-transform duration-200 ${openIndex === i ? "rotate-180" : ""}`}
                />
              </button>
              {openIndex === i && (
                <div className="px-6 pb-5">
                  <p className="text-white/55 leading-relaxed text-sm">
                    {faq.a}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </LuxReveal>
    </section>
  );
}

const WaitlistSection = forwardRef<HTMLElement>((_, ref) => {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setError(data.message ?? data.error ?? "Something went wrong. Try again.");
        setLoading(false);
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section ref={ref} id="waitlist" className="scroll-mt-20 py-20 md:py-28 px-5">
      <LuxReveal className="max-w-2xl mx-auto">
      <div className="lux-panel rounded-[2rem] px-6 py-12 sm:px-12 text-center space-y-8">
        <div className="relative">
          <div className="absolute -inset-20 bg-yellow-600/8 rounded-full blur-[80px] pointer-events-none" />
          <MarketingBadge variant="kicker" className="mb-6">
            Clearance
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight mb-4">
            Claim your access.
          </h2>
          <p className="text-white/50 text-lg max-w-md mx-auto">
            Join the list — first in line for every new drop from the studio.
            The cheat code only gets stronger.
          </p>
        </div>

        {submitted ? (
          <div className="p-8 rounded-2xl border border-primary/30 bg-primary/10">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 border border-primary/40">
              <KeyRound className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">
              Clearance granted.
            </h3>
            <p className="text-white/60 text-sm">
              You&rsquo;re on the list. We&rsquo;ll hit you first when new heat
              drops — meanwhile, the studio&rsquo;s open.
            </p>
            <Link href="/dashboard">
              <Button variant="luxury" className="mt-5 font-semibold gap-2">
                Start Creating Now <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
          >
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); if (error) setError(""); }}
              required
              className="h-12 flex-1 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/25"
            />
            <Button
              type="submit"
              size="lg"
              disabled={loading}
              variant="luxury"
              className="h-12 px-7 shrink-0"
            >
              {loading ? "Joining..." : "Get the code"}
            </Button>
          </form>
        )}

        {error && !submitted && (
          <div className="max-w-md mx-auto p-3 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <p className="text-white/25 text-xs">
          No spam. No Visual Buc card. Just the unfair advantage.
        </p>

        <div className="flex justify-center pt-2">
          <ShareRow label="Tell a creator" />
        </div>
      </div>
      </LuxReveal>
    </section>
  );
});
WaitlistSection.displayName = "WaitlistSection";

/* ───── Official music video teaser — cinematic full-bleed placeholder ───── */

function MusicVideoTeaser() {
  const videoRef = useRef<HTMLVideoElement>(null);

  /* Play only while the teaser is actually on screen — pause the moment
     the user scrolls away, resume when they scroll back.
     The teaser plays WITH sound: entering the viewport unmutes it (the
     theme song auto-ducks via ThemePlayerContext and comes back when the
     video stops, unless the user paused the theme themselves). If the
     browser blocks unmuted playback, fall back to muted. */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const playWithSound = () => {
      video.muted = false;
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
      });
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          playWithSound();
        } else {
          video.pause();
        }
      },
      { threshold: 0.25 }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      aria-label="Official music video teaser"
      className="relative bg-black"
    >
      <LuxReveal>
        <div className="relative w-full overflow-hidden">
          <video
            ref={videoRef}
            className="h-[72svh] min-h-[420px] w-full object-cover"
            src="/official-teaser.mp4"
            muted
            loop
            playsInline
            preload="auto"
            aria-label="Bow Down Visuals official music video teaser"
          />
          {/* Cinematic letterbox melt — top and bottom dissolve into the page */}
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black via-transparent to-black"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-0 lux-vignette"
            aria-hidden="true"
          />
          {/* Copy */}
          <div className="absolute inset-0 flex flex-col items-center justify-end px-5 pb-14 text-center sm:pb-16">
            <MarketingBadge variant="kicker" className="mb-4">
              Official Music Video
            </MarketingBadge>
            <h2 className="font-display italic text-4xl text-white sm:text-5xl md:text-6xl">
              Coming soon
            </h2>
            <p className="mt-3 max-w-md text-sm text-white/55 sm:text-base">
              A first taste of the official visual. The full music video is in
              production.
            </p>
          </div>
        </div>
      </LuxReveal>
    </section>
  );
}

/* ─────────────────────────── PAGE ─────────────────────────── */

/* ───── Creator Vault — the moat: persistent identity across every generation ───── */

const VAULT_PILLARS = [
  {
    icon: Mic2,
    title: "Your Voice, Cloned",
    body: "Clone your voice once. Every song, voiceover, and ad read comes out in your voice — not a stranger's.",
  },
  {
    icon: Sparkles,
    title: "Your Face, Locked",
    body: "Photos, style, and character locked in. Thumbnails, cover art, and videos stay unmistakably you.",
  },
  {
    icon: Fingerprint,
    title: "Your Brand, Everywhere",
    body: "Colors, logos, and visual identity ride along on every generation. No re-explaining your look, ever.",
  },
];

function CreatorVaultSection() {
  return (
    <section className="py-20 md:py-28 px-5 relative overflow-hidden">
      <LuxReveal className="max-w-6xl mx-auto">
        <div className="relative rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/[0.08] via-black to-black p-8 md:p-14 overflow-hidden">
          <div className="absolute -top-24 -right-24 w-[380px] h-[380px] bg-primary/10 rounded-full blur-[110px] pointer-events-none" />
          <div className="relative z-10 grid md:grid-cols-2 gap-10 items-center">
            <div className="space-y-6">
              <MarketingBadge variant="kicker">
                The Creator Vault
              </MarketingBadge>
              <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight leading-tight">
                Your sound. Your face. Your voice.{" "}
                <span className="gold-text-shine">Locked in.</span>
              </h2>
              <p className="text-white/55 text-lg leading-relaxed">
                Generic AI tools make generic output. Build your Creator Vault
                once — photos, voice, style, brand assets — and every song,
                video, and thumbnail comes out unmistakably{" "}
                <span className="text-white font-semibold">you</span>.
              </p>
              <Link
                href="/artist-vault"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#C9A84C] to-[#e8c86a] px-7 py-3.5 text-black font-bold hover:brightness-110 transition shadow-[0_0_25px_rgba(201,168,76,0.25)]"
              >
                Build My Vault <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="space-y-4">
              {VAULT_PILLARS.map((p) => (
                <div
                  key={p.title}
                  className="flex gap-4 p-5 rounded-2xl bg-white/[0.03] border border-white/[0.07] hover:border-primary/30 transition-colors"
                >
                  <div className="h-11 w-11 shrink-0 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <p.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">{p.title}</h3>
                    <p className="text-white/50 text-sm leading-relaxed">{p.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </LuxReveal>
    </section>
  );
}

/* ───── Branding Shop — AI designs it ───── */

const BRANDING_ITEMS = [
  { icon: Shirt, title: "Merch & Apparel", body: "AI-designed merch in your Vault identity. (Dropship fulfillment coming soon.)" },
  { icon: Palette, title: "Logos & Brand Kits", body: "Logos, color systems, and full brand kits generated around your look." },
  { icon: Clapperboard, title: "Stream Packs", body: "Overlays, alerts, panels, and emotes for Twitch, YouTube, and Kick." },
  { icon: Video, title: "Intros & Outros", body: "Branded video intros, outros, and transitions that open every upload right." },
];

function BrandingShopSection() {
  return (
    <section className="py-20 md:py-28 px-5">
      <LuxReveal className="max-w-6xl mx-auto">
        <div className="text-center mb-14 space-y-4">
          <MarketingBadge variant="kicker">
            The Branding Shop
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            Look like a brand <span className="gold-text-shine">before you are one.</span>
          </h2>
          <p className="text-white/50 text-lg max-w-2xl mx-auto">
            AI designs it. Logos, merch mockups, stream packs,
            intros — all in your Vault identity. (Dropship fulfillment coming soon.)
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
          {BRANDING_ITEMS.map((item) => (
            <div
              key={item.title}
              className="group p-7 rounded-2xl lux-panel lux-card-lift text-center"
            >
              <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-5 group-hover:bg-primary/20 transition-colors">
                <item.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-white text-lg mb-2">{item.title}</h3>
              <p className="text-white/50 text-sm leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>

        <div className="text-center">
          <Link
            href="/branding-shop"
            className="inline-flex items-center gap-2 rounded-xl border border-primary/40 px-8 py-4 text-primary font-bold hover:bg-primary/10 transition"
          >
            Open the Shop <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </LuxReveal>
    </section>
  );
}

/* ───── Label Pitch + music-business stack — demo to deal ───── */

const BIZ_PIPELINE = [
  {
    icon: Megaphone,
    title: "Pitch",
    body: "AI demo kit + 13-label directory. Pitch like you have a team behind you.",
    href: "/label-pitch",
  },
  {
    icon: Globe,
    title: "Distribute",
    body: "Music distribution to Spotify, Apple Music, YouTube & more — coming soon.",
    href: "/distribute",
  },
  {
    icon: Lock,
    title: "Protect",
    body: "Copyright registration guidance so your work stays yours.",
    href: "/copyright",
  },
  {
    icon: BadgeDollarSign,
    title: "Collect",
    body: "Royalty tracking that shows where your money is.",
    href: "/royalties",
  },
];

function LabelPitchSection() {
  return (
    <section className="py-20 md:py-28 px-5 bg-gradient-to-b from-transparent via-yellow-950/10 to-transparent">
      <LuxReveal className="max-w-6xl mx-auto">
        <div className="text-center mb-14 space-y-4">
          <MarketingBadge variant="kicker">
            The Business End
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            Make the song. Pitch the label.{" "}
            <span className="gold-text-shine">Keep the royalties.</span>
          </h2>
          <p className="text-white/50 text-lg max-w-2xl mx-auto">
            The pipeline from demo to deal, built in. No manager required.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {BIZ_PIPELINE.map((step, i) => (
            <div key={step.title} className="relative">
              <Link
                href={step.href}
                className="group block h-full p-7 rounded-2xl lux-panel lux-card-lift"
              >
                <div className="flex items-center justify-between mb-5">
                  <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <step.icon className="h-5 w-5 text-primary" />
                  </div>
                  <span className="text-4xl font-black text-primary/25 select-none">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="font-semibold text-white text-lg mb-2">{step.title}</h3>
                <p className="text-white/50 text-sm leading-relaxed mb-4">{step.body}</p>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary group-hover:text-yellow-300 transition-colors">
                  Open <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                </span>
              </Link>
            </div>
          ))}
        </div>
      </LuxReveal>
    </section>
  );
}

/* ───── Jackpot band — monthly win mechanic ───── */

function JackpotBand() {
  return (
    <section className="py-10 px-5">
      <LuxReveal className="max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-center sm:text-left px-8 py-6 rounded-2xl border border-primary/25 bg-primary/[0.06]">
          <Trophy className="h-8 w-8 text-primary shrink-0" />
          <p className="text-white/70">
            <span className="text-white font-bold">Every month, one cheat code wins.</span>{" "}
            The Cheat Code Jackpot — a secret arrow-code drops every month.
            First to crack it and enter it wins 100 Visual Bucs.
          </p>
          <Link
            href="/signup"
            className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-primary/15 border border-primary/40 px-6 py-3 text-primary font-bold hover:bg-primary/25 transition text-sm"
          >
            Crack the Code <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </LuxReveal>
    </section>
  );
}

/* ───── Creator Academy — free learning library ───── */

function AcademySection() {
  return (
    <section className="py-20 md:py-28 px-5">
      <LuxReveal className="max-w-5xl mx-auto">
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-white/[0.04] via-black to-black p-8 md:p-14 text-center">
          <div className="absolute -bottom-24 -left-24 w-[320px] h-[320px] bg-primary/[0.07] rounded-full blur-[100px] pointer-events-none" />
          <div className="relative z-10 space-y-6">
            <div className="flex justify-center">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/25 flex items-center justify-center">
                <GraduationCap className="h-7 w-7 text-primary" />
              </div>
            </div>
            <MarketingBadge variant="kicker">
              Creator Academy
            </MarketingBadge>
            <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
              The cheat code <span className="gold-text-shine">comes with a manual.</span>
            </h2>
            <p className="text-white/55 text-lg max-w-2xl mx-auto leading-relaxed">
              A free catalog of masterclasses in video, music, and branding — the same
              playbook the tools run on, taught straight. AI lessons from 1 Visual Buc each.
            </p>
            <Link
              href="/academy"
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-8 py-4 text-white font-semibold hover:bg-white/5 transition"
            >
              <BookOpen className="h-4 w-4" /> Explore the Academy
            </Link>
          </div>
        </div>
      </LuxReveal>
    </section>
  );
}

/* ─────────────────────────── PAGE ─────────────────────────── */

export default function Home() {
  usePageTitle(
    "Bow Down Visuals — The Content Creator's Cheat Code",
    "The AI studio for content creators: songs, music videos, promo clips, branding & business tools. 80+ AI features — pay only for what you create."
  );
  const waitlistRef = useRef<HTMLElement>(null);
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  /* Signed-in users go straight to artist selection — the first thing
     after sign-in is picking who they're creating for. */
  useEffect(() => {
    if (!authLoading && user) {
      setLocation("/choose-artist");
    }
  }, [authLoading, user, setLocation]);

  /* Don't flash the marketing page while the redirect fires. */
  if (authLoading || user) return null;

  return (
    <>
    <div className="min-h-screen text-white overflow-x-hidden relative isolate z-[1] no-throne-bg">
      {/* Page backdrop — gold-curtain stage, fixed full-viewport. INSIDE the
          isolated page root so the body's dark background can't cover it:
          at z-0 it stays behind the content but above the page root's
          (transparent) background. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: "url(/images/home-bg-gold-curtain-stage.webp)",
          backgroundSize: "cover",
          backgroundPosition: "center top",
          backgroundRepeat: "no-repeat",
        }}
      />
      {/* Curtain overlay — the stage curtains cut out, draped OVER the hero
          spotlights so the beams read as shining from behind the drapes,
          OVER the Shark King so he scrolls behind the curtains like
          going backstage (he sits at z-[4], just below this layer),
          and OVER the footer so the drapes hang over the foot of the page.
          Same geometry as the backdrop so the curtains align pixel-perfect.
          z-[5]: above the beams and the King, BELOW the hero copy — text
          and buttons always stay on top. Transparent center, so the footer
          shows through between the drapes. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[5]"
        style={{
          backgroundImage: "url(/images/home-curtains-overlay.png)",
          backgroundSize: "cover",
          backgroundPosition: "center top",
          backgroundRepeat: "no-repeat",
        }}
      />
      <JsonLd data={SOFTWARE_APPLICATION_JSON_LD} />
      <JsonLd data={HOME_FAQ_JSON_LD} />
      <KonamiEgg />
      <HeroSection />
      <CheatCodeTicker />
      <CheatCodeDemo />
      <CreatorVaultSection />
      <ProofBand />
      <MusicVideoTeaser />
      <HowItWorks />
      <SectionDivider />
      <WhatYouCanMake />
      <BuiltForCreators />
      <ManifestoBand />
      <StudioShowcase />
      <BrandingShopSection />
      <LabelPitchSection />
      <PricingSection />
      <JackpotBand />
      <SectionDivider />
      <ReferralPromo />
      <AcademySection />
      <SectionDivider />
      <FAQSection />
      <WaitlistSection ref={waitlistRef} />
    </div>
    </>
  );
}
