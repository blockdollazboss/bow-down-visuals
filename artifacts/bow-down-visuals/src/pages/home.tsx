import { useState, useRef, forwardRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HeroLogo3D } from "@/components/CinematicHero";
import { MarketingBadge } from "@/components/MarketingBadge";
import { LuxReveal } from "@/components/LuxReveal";
import { JsonLd, buildFaqJsonLd } from "@/components/seo/json-ld";
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
  Scissors,
  BadgeDollarSign,
  Rocket,
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
    body: "Songs, videos, promo, branding — full AI generations in seconds, for a few credits. No team, no waiting.",
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
        cost: "4 cr",
        href: "/make-song",
        featured: false,
      },
      {
        title: "Make a Music Video",
        description: "Cinematic AI scenes built for your track.",
        icon: Clapperboard,
        cost: "4 cr",
        href: "/make-video",
        featured: false,
      },
      {
        title: "Song + Video",
        description: "The full package — song and video in one flow.",
        icon: Mic2,
        cost: "4 cr",
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
        cost: "Lip sync 3 cr",
        href: "/video-editor",
        featured: false,
      },
      {
        title: "AI Voiceover",
        description: "Studio-quality narration in any voice.",
        icon: AudioLines,
        cost: "2 cr/min",
        href: "/voiceover",
        featured: false,
      },
      {
        title: "Upscale",
        description: "Honest 1080p and 4K upscaling. No fake “enhance”.",
        icon: Rocket,
        cost: "3 cr",
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
        cost: "4 cr",
        href: "/promo-clip",
        featured: false,
      },
      {
        title: "Hook Studio",
        description: "First-3-second hooks plus a virality pre-flight check.",
        icon: Zap,
        cost: "1 cr",
        href: "/hooks",
        featured: false,
      },
      {
        title: "Scheduler",
        description: "Auto-post to Instagram, TikTok, and Facebook.",
        icon: CalendarCheck,
        cost: "1 cr/post",
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
        cost: "1 cr",
        href: "/coach",
        featured: false,
      },
      {
        title: "Sponsor Match",
        description: "AI-matched brand deals, plus pitches that close.",
        icon: Handshake,
        cost: "1 cr",
        href: "/sponsors",
        featured: false,
      },
      {
        title: "Merch Designer",
        description: "AI merch mockups — dropship-ready.",
        icon: Shirt,
        cost: "3 cr",
        href: "/merch",
        featured: false,
      },
    ],
  },
];

const CREDIT_PACKS = [
  {
    credits: "10 Credits",
    price: "$9",
    packKey: "10",
    featured: false,
    perks: ["10 generation credits", "Never expires", "Instant top-up"],
  },
  {
    credits: "50 Credits",
    price: "$39",
    packKey: "50",
    featured: false,
    perks: ["50 generation credits", "Never expires", "Instant top-up"],
  },
  {
    credits: "150 Credits",
    price: "$99",
    packKey: "150",
    featured: true,
    perks: ["150 generation credits", "Never expires", "Best value"],
  },
  {
    credits: "500 Credits",
    price: "$249",
    packKey: "500",
    featured: false,
    perks: ["500 generation credits", "Never expires", "Pro volume"],
  },
];

const FAQS = [
  {
    q: "What is Bow Down Visuals?",
    a: "The AI studio for music creators — 80+ tools that write your songs, shoot your videos, cut your promo, design your brand, and run your business. One account, one credit system, no team required.",
  },
  {
    q: "How do credits work?",
    a: "Credits are the fuel. You buy them in packs starting at $9, and every AI generation spends a few — a full song is 4 credits, a music video is 4, a hook idea is 1. Browsing, editing, and viewing are always free. Payments are in test mode right now, so nothing real is charged.",
  },
  {
    q: "What does a full release cost?",
    a: "A song (4 cr) + a music video (4 cr) + promo clips (4 cr) + a hook pack (1 cr) = 13 credits. The entire release pipeline — song to promo — for less than the cost of one pack.",
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
    "Bow Down Visuals — the AI studio for music creators. Generate songs, music videos, promo clips, branding, and business tools: 80+ AI features on simple credit pricing.",
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
    <section className="relative min-h-[calc(100svh-4rem)] flex items-center px-5 py-16 overflow-hidden">
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

      <div className="relative z-10 mx-auto w-full max-w-7xl grid items-center gap-10 lg:grid-cols-2">
        {/* Hero Logo — cinematic 3D mouse-tracked motion, middle of the page */}
        <div className="flex justify-center">
          <HeroLogo3D />
        </div>

        {/* Copy — right side */}
        <div className="text-center lg:text-left space-y-5">

        {/* Positioning — the quiet luxury whisper */}
        <p className="font-display italic text-xl sm:text-2xl text-primary/90 leading-snug">
          The content creator&rsquo;s cheat code
        </p>

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

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl xl:text-7xl font-black tracking-[-0.02em] text-white leading-[0.95]">
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
          one credit system, zero permission needed.
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
    id: "rnb",
    label: "Midnight R&B",
    lyrics: [
      "City lights bleed through the rain on glass,",
      "You only call when the night moves slow,",
      "I turned every scar into a melody,",
      "Now the whole block singing back to me.",
    ],
    treatment: [
      "OPEN — rooftop at 2AM, neon on wet concrete. Slow orbit around the artist.",
      "HOOK — gold light leak, crowd silhouettes moving in perfect sync.",
    ],
    hook: "the song that raised me. midnight r&b, out now.",
  },
  {
    id: "drill",
    label: "UK Drill",
    lyrics: [
      "Blacked-out whip, yeah the opps stay lurking,",
      "Count it up daily, yeah the money working,",
      "From the block to the charts, that's a certi upgrade,",
      "They doubted the kid — now the kid got paid.",
    ],
    treatment: [
      "OPEN — estate at dusk, low angle, crew in formation.",
      "DROP — strobe cuts on the 808, drone pull-back over the skyline.",
    ],
    hook: "drill season never ended. new drop friday.",
  },
  {
    id: "afrobeats",
    label: "Afrobeats Anthem",
    lyrics: [
      "Lagos to London, we dey move with grace,",
      "Golden hour dancing, sunshine on my face,",
      "Money no dey sleep and neither do I,",
      "We go party till the morning light.",
    ],
    treatment: [
      "OPEN — beach party at golden hour, drone sweep over dancers.",
      "CHORUS — confetti burst, slow-mo spin, everybody moving as one.",
    ],
    hook: "summer anthem loading. afrobeats to the world.",
  },
];

function CheatCodeDemo() {
  const [vibeId, setVibeId] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const stash = timers.current;
    return () => stash.forEach((t) => window.clearTimeout(t));
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
    <section id="demo" className="scroll-mt-20 py-20 md:py-28 px-5 relative">
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
  { value: "$9", label: "Cheapest credit pack" },
  { value: "4 cr", label: "A full song, start to finish" },
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
            Built for music creators
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            Whether you&rsquo;re an independent artist or running a label, Bow Down
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
              <span className="text-primary/60 font-mono">↑↑↓↓←→←→BA</span>
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
            Credit Packs
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            Pay per creation. That&rsquo;s it.
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            Buy credits once, use them any time. No subscription required.
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
                <Link href="/pricing#credit-packs">Buy Credits</Link>
              </Button>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-white/25 font-medium mt-6 flex items-center justify-center gap-1.5">
          <Lock className="h-3 w-3" />
          Sign in to purchase credits.
        </p>
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
          No spam. No credit card. Just the unfair advantage.
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
  return (
    <section
      aria-label="Official music video teaser"
      className="relative bg-black"
    >
      <LuxReveal>
        <div className="relative w-full overflow-hidden">
          <video
            className="h-[72svh] min-h-[420px] w-full object-cover"
            src="/official-teaser.mp4"
            autoPlay
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

export default function Home() {
  usePageTitle(
    "Bow Down Visuals — The Content Creator's Cheat Code",
    "The AI studio for music creators: songs, music videos, promo clips, branding & business tools. 80+ AI features — pay only for what you create."
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
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      <JsonLd data={SOFTWARE_APPLICATION_JSON_LD} />
      <JsonLd data={HOME_FAQ_JSON_LD} />
      <KonamiEgg />
      <HeroSection />
      <CheatCodeTicker />
      <CheatCodeDemo />
      <ProofBand />
      <MusicVideoTeaser />
      <HowItWorks />
      <SectionDivider />
      <WhatYouCanMake />
      <BuiltForCreators />
      <ManifestoBand />
      <StudioShowcase />
      <PricingSection />
      <SectionDivider />
      <FAQSection />
      <WaitlistSection ref={waitlistRef} />
    </div>
  );
}
