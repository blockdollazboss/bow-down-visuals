import { useState, useRef, forwardRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HeroLogo3D } from "@/components/CinematicHero";
import { SpotlightRig } from "@/components/SpotlightRig";
import { FogCanvas } from "@/components/fog-lab/FogCanvas";
import { MarketingBadge } from "@/components/MarketingBadge";
import { LuxReveal } from "@/components/LuxReveal";
import { JsonLd, buildFaqJsonLd } from "@/components/seo/json-ld";
import { ThreadsIcon } from "@/components/social-icons";
import { mediaUrl } from "@/lib/media-cdn";
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
  Bell,
  Download,
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
  Flame,
  TrendingUp,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePageTitle } from "@/hooks/use-page-title";
import { useExtensionPromoVisible, markExtensionDownloaded } from "@/lib/extension-promo";
import { SocialProofBand } from "@/components/SocialProofBand";

/* ─────────────────────────── DATA ─────────────────────────── */

const STEPS = [
  { number: "01", icon: Target },
  { number: "02", icon: Zap },
  { number: "03", icon: Globe },
];


const CREATOR_TYPES = [
  { icon: Mic2 },
  { icon: Music },
  { icon: Video },
  { icon: Film },
  { icon: Users },
  { icon: Star },
];

/* Studio showcase — 4 categories × 3 cards. Every href points DIRECTLY at its
   hub URL (no redirect chains); tab/panel params verified against the hub pages. */
const STUDIO = [
  {
    icon: Sparkles,
    tools: [
      { icon: Music, href: "/create?panel=song", featured: false },
      { icon: Palette, href: "/cartoon-studio", featured: false, isNew: true },
      { icon: Flame, href: "/create?panel=link-to-hit", featured: true, isNew: true },
    ],
  },
  {
    icon: Scissors,
    tools: [
      { icon: Scissors, href: "/video-editor", featured: false },
      { icon: AudioLines, href: "/audio-studio?tab=finish", featured: false, isNew: true },
      { icon: Rocket, href: "/video-editor?tab=upscale", featured: false },
    ],
  },
  {
    icon: Megaphone,
    tools: [
      { icon: Film, href: "/video-editor?tab=promo-clips", featured: false },
      { icon: Zap, href: "/hooks", featured: false },
      { icon: TrendingUp, href: "/scheduler?tab=trend-jacker", featured: false, isNew: true },
    ],
  },
  {
    icon: BadgeDollarSign,
    tools: [
      { icon: DollarSign, href: "/coach", featured: false },
      { icon: Handshake, href: "/coach?tab=brand-deals", featured: false },
      { icon: Shirt, href: "/branding-kit?tab=shop", featured: false },
    ],
  },
];

const CREDIT_PACKS = [
  { price: "$9", packKey: "10", featured: false, perkCount: 3 },
  { price: "$39", packKey: "50", featured: false, perkCount: 3 },
  { price: "$99", packKey: "150", featured: true, perkCount: 3 },
  { price: "$249", packKey: "500", featured: false, perkCount: 3 },
];

const FAQS = [
  {
    q: "What is Bow Down Visuals?",
    a: "The AI studio for content creators — 19 studios that write your songs, shoot your videos, cut your promo, design your brand, and run your business. One account, one Visual Buc system, no team required.",
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
    "Bow Down Visuals — the AI studio for content creators. Generate songs, music videos, promo clips, branding, and business tools: 19 studios on simple Visual Buc pricing.",
  offers: {
    "@type": "AggregateOffer",
    priceCurrency: "USD",
    lowPrice: "9",
    highPrice: "249",
    offerCount: "4",
  },
};

const HOME_FAQ_JSON_LD = buildFaqJsonLd(FAQS.map((f) => ({ q: f.q, a: f.a })));


function SectionDivider() {
  return (
    <div className="mx-auto max-w-6xl px-5" aria-hidden="true">
      <div className="lux-divider" />
    </div>
  );
}

/* ──────────────────── Share row ──────────────────── */

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

function ShareRow({ label }: { label?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const shareText = t("home.shareText");
  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(SHARE_URL)}`;
  const fbHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SHARE_URL)}`;
  const threadsHref = `https://www.threads.com/intent/post?text=${encodeURIComponent(`${shareText} ${SHARE_URL}`)}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${shareText} ${SHARE_URL}`);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = `${shareText} ${SHARE_URL}`;
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
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-white/35">{label ?? t("home.shareLabel")}</span>
      <a href={xHref} target="_blank" rel="noopener noreferrer" aria-label={t("home.shareX")} className={btn}>
        <XIcon className="h-3.5 w-3.5" />
      </a>
      <a href={fbHref} target="_blank" rel="noopener noreferrer" aria-label={t("home.shareFacebook")} className={btn}>
        <FacebookIcon className="h-3.5 w-3.5" />
      </a>
      <a href={threadsHref} target="_blank" rel="noopener noreferrer" aria-label={t("home.shareThreads")} className={btn}>
        <ThreadsIcon className="h-3.5 w-3.5" />
      </a>
      <button onClick={copyLink} aria-label={t("home.copyLink")} className={btn}>
        {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {copied && <span className="text-xs font-medium text-primary">{t("home.copied")}</span>}
    </div>
  );
}

/* ──────────────────── Konami easter egg ──────────────────── */

const KONAMI = [
  "arrowup", "arrowup", "arrowdown", "arrowdown",
  "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a",
];

function KonamiEgg() {
  const { t } = useTranslation();
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
      aria-label={t("home.konamiAria")}
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
          alt={t("home.konamiAlt")}
          className="mx-auto mb-6 h-32 w-32 rounded-full border-2 border-primary object-cover"
        />
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.3em] text-primary">
          {t("home.konamiAccepted")}
        </p>
        <h3 className="mb-3 font-display text-3xl italic text-white">
          {t("home.konamiHeadline")}
        </h3>
        <p className="mb-8 text-sm leading-relaxed text-white/55">
          {t("home.konamiBody")}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/signup">
            <Button variant="luxury" className="w-full sm:w-auto gap-2">
              <KeyRound className="h-4 w-4" /> {t("home.claimAccess")}
            </Button>
          </Link>
          <Button variant="outline" onClick={() => setFired(false)} className="border-primary/30 text-primary hover:bg-primary/10">
            {t("home.konamiQuiet")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── COMPONENTS ─────────────────────────── */

function HeroSection() {
  const { t } = useTranslation();
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
          {t("home.positioning")}
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
            {t("home.clearanceBadge")}
          </div>
        </Link>
        {/* Refer & Earn badge — gentle attention nudge, links to /referrals */}
        <Link href="/referrals">
          <div className="refer-nudge inline-flex items-center gap-2 bg-gradient-to-r from-[#C9A84C] to-[#e8c86a] rounded-full px-4 py-1.5 text-sm font-bold text-black hover:brightness-110 transition cursor-pointer">
            <Gift className="h-3.5 w-3.5" />
            {t("home.referEarnBadge")}
          </div>
        </Link>
        {/* Zero skills required badge */}
        <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold text-primary border border-primary/40 bg-primary/10">
          <Sparkles className="h-3.5 w-3.5" />
          {t("home.zeroSkillsBadge", { defaultValue: "Zero creator skills required" })}
        </div>
        </div>

        {/* Headline */}
        <h1 className="text-[32px] sm:text-6xl xl:text-7xl font-black tracking-[-0.02em] text-white leading-[0.95] break-words">
          {t("home.heroHeadlineA")}{" "}
          <span className="gold-text-shine">{t("home.heroHeadlineB")}</span>
        </h1>

        {/* Slogan */}
        <p className="text-base sm:text-lg font-semibold tracking-widest text-primary/80 uppercase">
          {t("home.heroSlogan")}
        </p>

        {/* Subheadline */}
        <p className="text-lg sm:text-xl text-white/55 max-w-2xl mx-auto lg:mx-0 leading-relaxed">
          {t("home.heroSub")}
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 pt-4">
          <Link href="/signup">
            <Button
              size="lg"
              variant="luxury"
              className="w-full sm:w-auto text-base h-14 px-10 rounded-full gap-2"
            >
              <KeyRound className="h-4 w-4" /> {t("home.claimAccess")} <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Button
            size="lg"
            variant="outline"
            onClick={scrollToDemo}
            className="w-full sm:w-auto text-base h-14 px-10 rounded-full border-primary/30 bg-primary/[0.04] text-primary hover:bg-primary/10 hover:border-primary/60 hover:text-primary font-semibold gap-2 transition-all duration-300"
          >
            <Sparkles className="h-4 w-4" /> {t("home.watchItWork")}
          </Button>
        </div>

        {/* Returning users */}
        <p className="text-sm text-white/40">
          {t("home.alreadyHaveAccount")}{" "}
          <Link href="/login" className="font-semibold text-primary hover:text-primary/80 underline underline-offset-4 transition-colors">
            {t("home.signIn")}
          </Link>
        </p>

        {/* Social proof — true claims only */}
        <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-8 gap-y-3 pt-4 text-sm text-white/35 font-medium">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-primary/60" /> {t("home.proofPayOnly")}
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-primary/60" /> {t("home.proofNoSub")}
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-primary/60" /> {t("home.proofResults")}
          </span>
        </div>

        {/* Share */}
        <div className="flex justify-center lg:justify-start pt-2">
          <ShareRow />
        </div>
        </div>
      </div>

      {/* Ground fog — the fog-lab particle canvas: ~220 smoke-textured
          particles the cursor genuinely stirs like a fluid, so whipping
          the mouse tears the layer open and it re-settles after. Tuned to
          stay low: gentle buoyancy plus a hard ceiling at 55% of this band,
          so it pools at the King's feet/ankles and can never reach his
          hips. The copy's scrim keeps the hero text readable over it. */}
      <FogCanvas
        className="inset-x-0 bottom-0 z-[4] h-[46%]"
        ceilingFrac={0.55}
        buoyancy={-10}
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
  { id: "hiphop" },
  { id: "rnb" },
  { id: "pop" },
];

function CheatCodeDemo() {
  const { t } = useTranslation();
  const [vibeId, setVibeId] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const timers = useRef<number[]>([]);
  const sectionRef = useRef<HTMLElement | null>(null);
  const autoRan = useRef(false);
  const vibes = DEMO_VIBES.map((v) => ({
    ...v,
    label: t(`home.demo.${v.id}.label`),
    lyrics: [0, 1, 2, 3].map((i) => t(`home.demo.${v.id}.lyrics.${i}`)),
    treatment: [0, 1].map((i) => t(`home.demo.${v.id}.treatment.${i}`)),
    hook: t(`home.demo.${v.id}.hook`),
  }));

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

  const vibe = vibes.find((v) => v.id === vibeId) ?? null;
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
          <MarketingBadge variant="kicker">{t("home.demoKicker")}</MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            {t("home.demoTitleA")}{" "}
            <span className="gold-text-shine">{t("home.demoTitleB")}</span>
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            {t("home.demoSub")}
          </p>
        </div>

        <div className="lux-panel rounded-[2rem] p-6 sm:p-10">
          {/* Vibe picker */}
          <div className="flex flex-wrap justify-center gap-3 mb-8">
            {vibes.map((v) => (
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
                  {t("home.demoEmpty")}
                </p>
              </div>
            )}

            {vibe && (
              <div className="space-y-5">
                {stage >= 1 && (
                  <div className="demo-anim rounded-2xl border border-white/[0.07] bg-black/40 p-6" style={{ animation: "demo-stage-in 0.5s ease-out" }}>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-primary">{t("home.demoLyricsLabel")}</span>
                      {stage === 1 && running && (
                        <span className="flex items-center gap-1.5 text-[11px] text-white/40">
                          <span className="demo-anim h-1.5 w-1.5 rounded-full bg-primary" style={{ animation: "demo-pulse-dot 1s infinite" }} />
                          {t("home.demoWriting")}
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
                      <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-primary">{t("home.demoTreatmentLabel")}</span>
                      {stage === 2 && running && (
                        <span className="flex items-center gap-1.5 text-[11px] text-white/40">
                          <span className="demo-anim h-1.5 w-1.5 rounded-full bg-primary" style={{ animation: "demo-pulse-dot 1s infinite" }} />
                          {t("home.demoDirecting")}
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
                      <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-primary">{t("home.demoHookLabel")}</span>
                      {stage === 3 && running && (
                        <span className="flex items-center gap-1.5 text-[11px] text-white/40">
                          <span className="demo-anim h-1.5 w-1.5 rounded-full bg-primary" style={{ animation: "demo-pulse-dot 1s infinite" }} />
                          {t("home.demoCutting")}
                        </span>
                      )}
                    </div>
                    <p className="text-base font-semibold text-white">“{vibe.hook}”</p>
                  </div>
                )}

                {stage >= 4 && (
                  <div className="demo-anim pt-2 text-center" style={{ animation: "demo-stage-in 0.5s ease-out" }}>
                    <p className="mb-4 text-xs uppercase tracking-[0.2em] text-white/35">
                      {t("home.demoSimulatedNote")}
                    </p>
                    <Link href="/signup">
                      <Button variant="luxury" size="lg" className="rounded-full px-8 gap-2">
                        <KeyRound className="h-4 w-4" /> {t("home.demoSignInCta")}
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
  { value: "19" },
  { value: "$9" },
  { value: "400 VB" },
  { value: "0" },
];

function ProofBand() {
  const { t } = useTranslation();
  return (
    <section aria-label="By the numbers" className="py-14 px-5 border-y border-white/[0.06] bg-black/40">
      <LuxReveal className="max-w-6xl mx-auto">
        <p className="text-center text-[11px] font-bold uppercase tracking-[0.3em] text-primary/80 mb-8">
          {t("home.proofKicker")}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {PROOF_STATS.map((s, i) => (
            <div key={s.value}>
              <div className="gold-text-shine text-4xl md:text-5xl font-black tracking-tight">
                {s.value}
              </div>
              <div className="mt-2 text-sm text-white/45 font-medium">{t(`home.proofStats.${i}.label`)}</div>
            </div>
          ))}
        </div>
      </LuxReveal>
    </section>
  );
}

function HowItWorks() {
  const { t } = useTranslation();
  return (
    <section id="how-it-works" className="scroll-mt-20 py-20 md:py-28 px-5 relative">
      <LuxReveal className="max-w-6xl mx-auto">
        <div className="text-center mb-16 space-y-4">
          <MarketingBadge variant="kicker">
            {t("home.howKicker")}
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            {t("home.howTitle")}
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            {t("home.howSub")}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          {/* Connector line (desktop only) */}
          <div className="hidden md:block absolute top-16 left-1/3 right-1/3 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent pointer-events-none" />

          {STEPS.map((step, i) => (
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
                {t(`home.steps.${i}.title`)}
              </h3>
              <p className="text-white/50 leading-relaxed text-sm">
                {t(`home.steps.${i}.body`)}
              </p>
            </div>
          ))}
        </div>
      </LuxReveal>
    </section>
  );
}


function BuiltForCreators() {
  const { t } = useTranslation();
  return (
    <section className="py-20 md:py-28 px-5">
      <LuxReveal className="max-w-6xl mx-auto">
        <div className="text-center mb-16 space-y-4">
          <MarketingBadge variant="kicker">
            {t("home.builtForKicker")}
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            {t("home.builtForTitle")}
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            {t("home.builtForSub")}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {CREATOR_TYPES.map((creator, i) => (
            <div
              key={i}
              className="group p-7 rounded-2xl lux-panel lux-card-lift"
            >
              <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center mb-5 group-hover:bg-primary/20 transition-colors">
                <creator.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold text-white text-lg mb-2">
                {t(`home.creatorTypes.${i}.title`)}
              </h3>
              <p className="text-white/50 text-sm leading-relaxed">
                {t(`home.creatorTypes.${i}.body`)}
              </p>
            </div>
          ))}
        </div>

        {/* Formats strip — not just music: movies, podcasts, streaming */}
        <div className="mt-12 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 md:p-8">
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.3em] text-primary/80 mb-6">
            {t("home.formatsKicker")}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { icon: Film, key: "movies", href: "/movies" },
              { icon: Podcast, key: "podcasts", href: "/audio-studio?tab=podcast" },
              { icon: Tv, key: "streamers", href: "/go-live" },
            ].map((f) => (
              <Link
                key={f.key}
                href={f.href}
                className="group flex items-center gap-4 p-4 rounded-xl hover:bg-white/[0.04] transition-colors"
              >
                <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <f.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold text-white text-sm">{t(`home.formats.${f.key}.title`)}</h4>
                  <p className="text-white/45 text-xs mt-0.5">{t(`home.formats.${f.key}.body`)}</p>
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


/* ───── Studio showcase — the full arsenal, grouped ───── */

function StudioShowcase() {
  const { t } = useTranslation();
  return (
    <section
      id="tools"
      className="scroll-mt-20 py-20 md:py-28 px-5 bg-gradient-to-b from-transparent via-yellow-950/10 to-transparent"
    >
      <LuxReveal className="max-w-6xl mx-auto">
        <div className="text-center mb-16 space-y-4">
          <MarketingBadge variant="kicker">
            {t("home.studioKicker")}
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            {t("home.studioTitle")}
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            {t("home.studioSub")}
          </p>
        </div>

        <div className="space-y-12">
          {STUDIO.map((cat, ci) => (
            <div key={ci}>
              <div className="mb-6 flex items-center gap-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <cat.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white leading-tight">
                    {t(`home.studio.${ci}.category`)}
                    <span className="ml-3 text-sm font-medium text-white/35">
                      {t(`home.studio.${ci}.tagline`)}
                    </span>
                  </h3>
                </div>
                <div className="flex-1 h-px bg-gradient-to-r from-primary/25 to-transparent" aria-hidden="true" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {cat.tools.map((tool, ti) => (
                  <div
                    key={ti}
                    className={`relative group flex flex-col p-7 rounded-2xl lux-card-lift ${
                      tool.featured
                        ? "royal-border bg-primary/10 shadow-[0_0_30px_rgba(218,165,32,0.18)]"
                        : "lux-panel"
                    }`}
                  >
                    {tool.featured && (
                      <div className="absolute -top-3 left-6">
                        <MarketingBadge variant="popular">
                          <Star className="h-2.5 w-2.5" /> {t("home.mostPopular")}
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
                          {t(`home.studio.${ci}.tools.${ti}.title`)}
                        </h4>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {tool.isNew && (
                            <MarketingBadge variant="soon">{t("home.newBadge")}</MarketingBadge>
                          )}
                          <MarketingBadge variant="muted">
                            {t(`home.studio.${ci}.tools.${ti}.cost`)}
                          </MarketingBadge>
                        </div>
                      </div>
                      <p className="text-white/50 text-sm leading-relaxed">
                        {t(`home.studio.${ci}.tools.${ti}.description`)}
                      </p>
                    </div>

                    <Link
                      href={tool.href}
                      className="mt-6 flex items-center gap-2 text-sm font-semibold text-primary hover:text-yellow-300 transition-colors group/link"
                    >
                      {t("home.openThisTool")}{" "}
                      <ChevronRight className="h-4 w-4 group-hover/link:translate-x-1 transition-transform" />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-12 text-center text-sm text-white/40">
          {t("home.studioMoreBefore")}{" "}
          <Link href="/features" className="font-semibold text-primary hover:text-yellow-300 transition-colors">
            {t("home.studioMoreLink")}<ArrowRight className="inline h-3.5 w-3.5" />
          </Link>
        </p>
      </LuxReveal>
    </section>
  );
}

function PricingSection() {
  const { t } = useTranslation();
  return (
    <section id="pricing" className="scroll-mt-20 py-20 md:py-28 px-5">
      <LuxReveal className="max-w-5xl mx-auto">
        <div className="text-center mb-12 space-y-4">
          <MarketingBadge variant="kicker">
            {t("home.pricingKicker")}
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            {t("home.pricingTitle")}
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            {t("home.pricingSub")}
          </p>
        </div>

        {/* Test mode notice */}
        <div className="flex items-center justify-center gap-2 mb-10 px-4 py-3 rounded-xl border border-yellow-500/20 bg-yellow-500/[0.06] max-w-lg mx-auto">
          <AlertCircle className="h-4 w-4 text-yellow-400 shrink-0" />
          <span className="text-sm text-yellow-200/70">
            {t("home.testModeBefore")}{" "}
            <strong className="text-yellow-300">{t("home.testModeStrong")}</strong>{t("home.testModeAfter")}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {CREDIT_PACKS.map((pack, pi) => (
            <div
              key={pack.packKey}
              className={`relative flex flex-col p-6 rounded-2xl lux-card-lift ${
                pack.featured ? "royal-border bg-primary/[0.08]" : "lux-panel"
              }`}
            >
              {pack.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <MarketingBadge variant="popular">{t("home.bestValue")}</MarketingBadge>
                </div>
              )}
              <div className="mb-5">
                <p className="text-sm font-bold text-white/40 uppercase tracking-widest mb-1">
                  {t(`home.creditPacks.${pi}.credits`)}
                </p>
                <div className="text-3xl font-black text-primary mb-1">
                  {pack.price}
                </div>
              </div>

              <ul className="space-y-2 flex-1 mb-6">
                {Array.from({ length: pack.perkCount }, (_, j) => {
                  const perk = t(`home.creditPacks.${pi}.perks.${j}`);
                  return (
                    <li
                      key={perk}
                      className="flex items-center gap-2.5 text-sm text-white/60"
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary/60" />
                      {perk}
                    </li>
                  );
                })}
              </ul>

              <Button
                asChild
                className="w-full font-semibold"
                variant={pack.featured ? "luxury" : "outline"}
              >
                <Link href="/pricing#credit-packs">{t("home.buyBucs")}</Link>
              </Button>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-white/25 font-medium mt-6 flex items-center justify-center gap-1.5">
          <Lock className="h-3 w-3" />
          {t("home.signInToPurchase")}
        </p>
      </LuxReveal>
    </section>
  );
}




function FAQSection() {
  const { t } = useTranslation();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section
      id="faq"
      className="scroll-mt-20 py-20 md:py-28 px-5 bg-gradient-to-b from-transparent via-yellow-950/8 to-transparent"
    >
      <LuxReveal className="max-w-3xl mx-auto">
        <div className="text-center mb-14 space-y-4">
          <MarketingBadge variant="kicker">
            {t("home.faqKicker")}
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            {t("home.faqTitle")}
          </h2>
        </div>

        <div className="space-y-3">
          {FAQS.map((_, i) => (
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
                  {t(`home.faqs.${i}.q`)}
                </span>
                <ChevronDown
                  className={`h-5 w-5 text-primary shrink-0 transition-transform duration-200 ${openIndex === i ? "rotate-180" : ""}`}
                />
              </button>
              {openIndex === i && (
                <div className="px-6 pb-5">
                  <p className="text-white/55 leading-relaxed text-sm">
                    {t(`home.faqs.${i}.a`)}
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
  const { t } = useTranslation();
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
        setError(data.message ?? data.error ?? t("home.waitlistErrorGeneric"));
        setLoading(false);
        return;
      }
      setSubmitted(true);
    } catch {
      setError(t("home.waitlistErrorConnection"));
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
            {t("home.waitlistKicker")}
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight mb-4">
            {t("home.waitlistTitle")}
          </h2>
          <p className="text-white/50 text-lg max-w-md mx-auto">
            {t("home.waitlistSub")}
          </p>
        </div>

        {submitted ? (
          <div className="p-8 rounded-2xl border border-primary/30 bg-primary/10">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 border border-primary/40">
              <KeyRound className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">
              {t("home.waitlistGranted")}
            </h3>
            <p className="text-white/60 text-sm">
              {t("home.waitlistGrantedBody")}
            </p>
            <Link href="/dashboard">
              <Button variant="luxury" className="mt-5 font-semibold gap-2">
                {t("home.waitlistStartNow")} <ArrowRight className="h-4 w-4" />
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
              {loading ? t("home.waitlistJoining") : t("home.waitlistGetCode")}
            </Button>
          </form>
        )}

        {error && !submitted && (
          <div className="max-w-md mx-auto p-3 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <p className="text-white/25 text-xs">
          {t("home.waitlistNoSpam")}
        </p>

        <div className="flex justify-center pt-2">
          <ShareRow label={t("home.shareLabelTellCreator")} />
        </div>
      </div>
      </LuxReveal>
    </section>
  );
});
WaitlistSection.displayName = "WaitlistSection";

/* ───── Official music video teaser — cinematic full-bleed placeholder ───── */

function MusicVideoTeaser() {
  const { t } = useTranslation();
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
      aria-label={t("home.teaserSectionAria")}
      className="relative bg-black"
    >
      <LuxReveal>
        <div className="relative w-full overflow-hidden">
          <video
            ref={videoRef}
            className="h-[72svh] min-h-[420px] w-full object-cover"
            src={mediaUrl("official-teaser.mp4")}
            muted
            loop
            playsInline
            preload="auto"
            aria-label={t("home.teaserVideoAria")}
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
              {t("home.teaserKicker")}
            </MarketingBadge>
            <h2 className="font-display italic text-4xl text-white sm:text-5xl md:text-6xl">
              {t("home.teaserTitle")}
            </h2>
            <p className="mt-3 max-w-md text-sm text-white/55 sm:text-base">
              {t("home.teaserSub")}
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
  { icon: Mic2 },
  { icon: Sparkles },
  { icon: Fingerprint },
];

function CreatorVaultSection() {
  const { t } = useTranslation();
  return (
    <section className="py-20 md:py-28 px-5 relative overflow-hidden">
      <LuxReveal className="max-w-6xl mx-auto">
        <div className="relative rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/[0.08] via-black to-black p-8 md:p-14 overflow-hidden">
          <div className="absolute -top-24 -right-24 w-[380px] h-[380px] bg-primary/10 rounded-full blur-[110px] pointer-events-none" />
          <div className="relative z-10 grid md:grid-cols-2 gap-10 items-center">
            <div className="space-y-6">
              <MarketingBadge variant="kicker">
                {t("home.vaultKicker")}
              </MarketingBadge>
              <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight leading-tight">
                {t("home.vaultTitleA")}{" "}
                <span className="gold-text-shine">{t("home.vaultTitleB")}</span>
              </h2>
              <p className="text-white/55 text-lg leading-relaxed">
                {t("home.vaultBodyA")}
                <span className="text-white font-semibold">{t("home.vaultBodyYou")}</span>{t("home.vaultBodyB")}
              </p>
              <Link
                href="/artist-vault"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#C9A84C] to-[#e8c86a] px-7 py-3.5 text-black font-bold hover:brightness-110 transition shadow-[0_0_25px_rgba(201,168,76,0.25)]"
              >
                {t("home.vaultCta")} <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="space-y-4">
              {VAULT_PILLARS.map((p, i) => (
                <div
                  key={i}
                  className="flex gap-4 p-5 rounded-2xl bg-white/[0.03] border border-white/[0.07] hover:border-primary/30 transition-colors"
                >
                  <div className="h-11 w-11 shrink-0 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <p.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">{t(`home.vaultPillars.${i}.title`)}</h3>
                    <p className="text-white/50 text-sm leading-relaxed">{t(`home.vaultPillars.${i}.body`)}</p>
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
  { icon: Shirt },
  { icon: Palette },
  { icon: Clapperboard },
  { icon: Video },
];

function BrandingShopSection() {
  const { t } = useTranslation();
  return (
    <section className="py-20 md:py-28 px-5">
      <LuxReveal className="max-w-6xl mx-auto">
        <div className="text-center mb-14 space-y-4">
          <MarketingBadge variant="kicker">
            {t("home.brandingKicker")}
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            {t("home.brandingTitleA")} <span className="gold-text-shine">{t("home.brandingTitleB")}</span>
          </h2>
          <p className="text-white/50 text-lg max-w-2xl mx-auto">
            {t("home.brandingSub")}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
          {BRANDING_ITEMS.map((item, i) => (
            <div
              key={i}
              className="group p-7 rounded-2xl lux-panel lux-card-lift text-center"
            >
              <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-5 group-hover:bg-primary/20 transition-colors">
                <item.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-white text-lg mb-2">{t(`home.brandingItems.${i}.title`)}</h3>
              <p className="text-white/50 text-sm leading-relaxed">{t(`home.brandingItems.${i}.body`)}</p>
            </div>
          ))}
        </div>

        <div className="text-center">
          <Link
            href="/branding-kit?tab=shop"
            className="inline-flex items-center gap-2 rounded-xl border border-primary/40 px-8 py-4 text-primary font-bold hover:bg-primary/10 transition"
          >
            {t("home.brandingCta")} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </LuxReveal>
    </section>
  );
}

/* ───── Label Pitch + music-business stack — demo to deal ───── */




/* ───── Promo strip — jackpot + referral + extension in one tight band ───── */

function PromoStrip() {
  const { t } = useTranslation();
  const showExtensionPromo = useExtensionPromoVisible();
  return (
    <section aria-label="Promotions" className="py-14 md:py-20 px-5">
      <LuxReveal className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Jackpot */}
          <div className="flex flex-col p-6 rounded-2xl border border-primary/25 bg-primary/[0.06] hover:border-primary/40 transition-colors">
            <Trophy className="h-7 w-7 text-primary mb-4" />
            <h3 className="font-bold text-white text-lg mb-2">{t("home.jackpotBold")}</h3>
            <p className="text-white/55 text-sm leading-relaxed flex-1">{t("home.jackpotBody")}</p>
            <Link
              href="/signup"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary/15 border border-primary/40 px-5 py-2.5 text-primary font-bold hover:bg-primary/25 transition text-sm w-fit"
            >
              {t("home.jackpotCta")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          {/* Referral */}
          <div className="flex flex-col p-6 rounded-2xl border border-[#C9A84C]/25 bg-gradient-to-br from-[#C9A84C]/[0.07] to-transparent hover:border-[#C9A84C]/40 transition-colors">
            <Gift className="h-7 w-7 text-[#e8c86a] mb-4" />
            <h3 className="font-bold text-white text-lg mb-2">
              {t("home.referTitleA")} <span className="text-[#e8c86a]">{t("home.referTitleB")}</span>
            </h3>
            <p className="text-white/55 text-sm leading-relaxed flex-1">
              {t("home.referBodyA")}<span className="text-white font-semibold">{t("home.referBodyB")}</span>{t("home.referBodyC")}
              <span className="text-white font-semibold">{t("home.referBodyD")}</span>{t("home.referBodyE")}
            </p>
            <a
              href="/referrals"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#C9A84C] to-[#e8c86a] px-5 py-2.5 text-black font-bold text-sm hover:brightness-110 transition w-fit"
            >
              <Gift className="h-4 w-4" /> {t("home.referCta")}
            </a>
          </div>
          {/* Extension */}
          {showExtensionPromo && (
            <div className="flex flex-col p-6 rounded-2xl border border-white/10 bg-white/[0.03] hover:border-primary/30 transition-colors">
              <Download className="h-7 w-7 text-primary mb-4" />
              <h3 className="font-bold text-white text-lg mb-2">
                {t("home.extTitleA")} <span className="text-[#e8c86a]">{t("home.extTitleB")}</span>
              </h3>
              <p className="text-white/55 text-sm leading-relaxed flex-1">{t("home.extSub")}</p>
              <a
                href="/bow-down-visuals-extension-v2.zip"
                download
                onClick={markExtensionDownloaded}
                className="mt-5 inline-flex items-center gap-2 rounded-xl border border-primary/40 px-5 py-2.5 text-primary font-bold hover:bg-primary/10 transition text-sm w-fit"
              >
                <Download className="h-4 w-4" /> {t("home.extDownload")}
              </a>
            </div>
          )}
        </div>
      </LuxReveal>
    </section>
  );
}

/* ───── Creator Academy — free learning library ───── */

function AcademySection() {
  const { t } = useTranslation();
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
              {t("home.academyKicker")}
            </MarketingBadge>
            <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
              {t("home.academyTitleA")} <span className="gold-text-shine">{t("home.academyTitleB")}</span>
            </h2>
            <p className="text-white/55 text-lg max-w-2xl mx-auto leading-relaxed">
              {t("home.academySub")}
            </p>
            <Link
              href="/academy"
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-8 py-4 text-white font-semibold hover:bg-white/5 transition"
            >
              <BookOpen className="h-4 w-4" /> {t("home.academyCta")}
            </Link>
          </div>
        </div>
      </LuxReveal>
    </section>
  );
}

/* ─────────────────────────── PAGE ─────────────────────────── */

export default function Home() {
  const { t } = useTranslation();
  usePageTitle(
    t("home.pageTitle"),
    t("home.pageDescription")
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
      <JsonLd data={SOFTWARE_APPLICATION_JSON_LD} />
      <JsonLd data={HOME_FAQ_JSON_LD} />
      <KonamiEgg />
      <HeroSection />
      <SocialProofBand />
      <ProofBand />
      <CheatCodeDemo />
      <CreatorVaultSection />
      <MusicVideoTeaser />
      <HowItWorks />
      <SectionDivider />
      <BuiltForCreators />
      <StudioShowcase />
      <BrandingShopSection />
      <PricingSection />
      <PromoStrip />
      <AcademySection />
      <SectionDivider />
      <FAQSection />
      <WaitlistSection ref={waitlistRef} />
    </div>
    {/* Curtain overlay — the stage curtains cut out. Lives OUTSIDE the page
          root's isolated z-[1] stacking context on purpose: the footer sits
          at z-[2] (above the page, so the opaque stage backdrop can't swallow
          it), and the drapes must hang OVER the foot of the page — so the
          overlay sits at z-[3], above the footer. Same cover/center-top
          geometry as the backdrop so the curtains align pixel-perfect.
          Transparent center: the footer shows through between the drapes,
          and the hero copy (centered) never sits under an opaque fold.
          pointer-events-none: never blocks clicks. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[3]"
        style={{
          backgroundImage: "url(/images/home-curtains-overlay.png?v=4)",
          backgroundSize: "cover",
          backgroundPosition: "center top",
          backgroundRepeat: "no-repeat",
        }}
      />
    </>
  );
}
