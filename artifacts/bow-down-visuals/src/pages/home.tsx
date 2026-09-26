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
  Image as ImageIcon,
  Mic2,
  Archive,
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
} from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─────────────────────────── DATA ─────────────────────────── */

const STEPS = [
  {
    number: "01",
    title: "Describe Your Vision",
    body: "Enter your artist name, genre, mood, and song concept. The more detail you give, the better your output.",
    icon: Target,
  },
  {
    number: "02",
    title: "Generate in Seconds",
    body: "Our AI creates professional-grade lyrics, video treatments, and promo content instantly — no waiting.",
    icon: Zap,
  },
  {
    number: "03",
    title: "Ship Your Release",
    body: "Copy, refine, and publish your content across all platforms. From studio to street in minutes.",
    icon: Globe,
  },
];

const OUTPUT_TYPES = [
  "Song Lyrics & Hooks",
  "Music Video Treatments",
  "Scene-by-Scene Prompts",
  "Social Media Captions",
  "Thumbnail Concepts",
  "Promo Clip Scripts",
  "Artist Brand Copy",
  "Release Strategies",
  "Hook & Chorus Ideas",
  "Director's Notes",
  "Platform Rollout Plans",
  "Cover Art Concepts",
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

const TOOLS = [
  {
    title: "Make a Song",
    description:
      "Generate full lyrics, hooks, verse structure, and song notes tailored to your genre and mood.",
    icon: Music,
    cost: "1 credit",
    href: "/make-song",
    featured: false,
  },
  {
    title: "Make a Music Video",
    description:
      "Create a complete scene-by-scene treatment with visual direction, location ideas, and shot notes.",
    icon: Video,
    cost: "1 credit",
    href: "/make-video",
    featured: false,
  },
  {
    title: "Make Song + Video",
    description:
      "The full package — lyrics, music prompt, video treatment, and promo content generated together.",
    icon: Mic2,
    cost: "2 credits",
    href: "/song-and-video",
    featured: true,
  },
  {
    title: "Promo Clip Maker",
    description:
      "Plan your social media rollout with teaser scripts, release captions, and platform-specific hooks.",
    icon: Film,
    cost: "1 credit",
    href: "/promo-clip",
    featured: false,
  },
  {
    title: "Thumbnail Maker",
    description:
      "Generate compelling cover art concepts and thumbnail ideas that grab attention on every platform.",
    icon: ImageIcon,
    cost: "1 credit",
    href: "/thumbnail",
    featured: false,
  },
  {
    title: "Artist Profiles",
    description:
      "Save your artist profile, style rules, and brand colors so every generation is on-brand automatically.",
    icon: Archive,
    cost: "Coming soon",
    href: "#",
    featured: false,
    comingSoon: true,
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
    a: "Bow Down Visuals is an AI-powered creative studio built for music creators. It helps you generate song lyrics, music video treatments, promo content, thumbnails, and more — so you can move faster from idea to release.",
  },
  {
    q: "Do I need music production experience?",
    a: "Not at all. You just describe your vision — genre, mood, artist style, concept — and the AI handles the rest. It's built for artists, managers, directors, and everyone in between.",
  },
  {
    q: "How do credits work?",
    a: "Every new account gets 3 free credits to start. Each tool costs 1–2 credits per generation. The Song + Video combo costs 2 credits since it generates both song and video content together.",
  },
  {
    q: "Can I use the generated content commercially?",
    a: "Yes. The content you generate belongs to you. Use it for your songs, music videos, social media, press kits, and anywhere else in your creative workflow.",
  },
  {
    q: "What platforms is the content optimized for?",
    a: "Promo clips and captions are optimized for YouTube, Instagram, TikTok, X (Twitter), and SoundCloud. You choose the platform when you generate, and the AI tailors the output accordingly.",
  },
  {
    q: "When is paid access launching?",
    a: "We're currently in early access. Join the waitlist to be first in line when our paid plans go live — waitlist members get priority access and early pricing.",
  },
];

const SOFTWARE_APPLICATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Bow Down Visuals",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  description:
    "AI-powered creative studio for music creators — generate song lyrics, music video treatments, promo clip scripts, and thumbnail concepts in seconds.",
  offers: {
    "@type": "AggregateOffer",
    priceCurrency: "USD",
    lowPrice: "0",
    highPrice: "249",
    offerCount: "4",
  },
};

const HOME_FAQ_JSON_LD = buildFaqJsonLd(FAQS.map((f) => ({ q: f.q, a: f.a })));

/* ──────────────────── Capability ticker ──────────────────── */

const TICKER_ITEMS = [
  "Lyrics in seconds",
  "Full video treatments",
  "Promo clips on demand",
  "Thumbnails that stop the scroll",
  "Captions for every platform",
  "Release strategies",
  "Scene-by-scene prompts",
  "Hooks & chorus ideas",
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

/* ─────────────────────────── COMPONENTS ─────────────────────────── */

function HeroSection({ onWaitlist }: { onWaitlist: () => void }) {
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

        {/* Beta badge */}
        <Link href="/beta-access">
          <div
            className="inline-flex items-center gap-2 bg-primary/10 border border-primary/50 rounded-full px-4 py-1.5 text-sm font-bold text-primary hover:bg-primary/20 transition-colors cursor-pointer shimmer"
            style={{ boxShadow: "0 0 18px rgba(212,160,23,0.25)" }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Beta Access Open
          </div>
        </Link>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl xl:text-7xl font-black tracking-[-0.02em] text-white leading-[0.95]">
          Create Songs, <span className="gold-text-shine">Music Videos,</span>{" "}
          and Promo Clips With AI
        </h1>

        {/* Slogan */}
        <p className="text-base sm:text-lg font-semibold tracking-widest text-primary/80 uppercase">
          Create the Song. Create the Video. Promote the Release.
        </p>

        {/* Subheadline */}
        <p className="text-lg sm:text-xl text-white/55 max-w-2xl mx-auto lg:mx-0 leading-relaxed">
          Tell us your artist, genre, and idea. In seconds, we'll generate
          lyrics, a full video treatment, promo content, and more — ready to
          use.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 pt-4">
          <Link href="/dashboard">
            <Button
              size="lg"
              variant="luxury"
              className="w-full sm:w-auto text-base h-14 px-10 rounded-full gap-2"
            >
              Start Creating <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/beta-access">
            <Button
              size="lg"
              variant="outline"
              className="w-full sm:w-auto text-base h-14 px-10 rounded-full border-primary/30 bg-primary/[0.04] text-primary hover:bg-primary/10 hover:border-primary/60 hover:text-primary font-semibold gap-2 transition-all duration-300"
            >
              <Sparkles className="h-4 w-4" /> Join Beta
            </Button>
          </Link>
        </div>

        {/* Social proof */}
        <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-8 gap-y-3 pt-4 text-sm text-white/35 font-medium">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-primary/60" /> 3 free credits
            on signup
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-primary/60" /> No credit card
            required
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-primary/60" /> Results in
            seconds
          </span>
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

function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20 py-20 md:py-28 px-5 relative">
      <LuxReveal className="max-w-6xl mx-auto">
        <div className="text-center mb-16 space-y-4">
          <MarketingBadge variant="kicker">
            How It Works
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            From idea to release in minutes
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            No experience needed. Just describe your vision and let the studio
            handle the rest.
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
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-5xl font-black text-primary/10 select-none pointer-events-none">
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
            One platform. Every piece of creative content your music career
            demands.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {OUTPUT_TYPES.map((type, i) => (
            <div
              key={i}
              className="lux-card flex items-center gap-3 px-4 py-3.5 group"
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
            Whether you're an independent artist or running a label, Bow Down
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

function FeaturedTools() {
  return (
    <section
      id="tools"
      className="scroll-mt-20 py-20 md:py-28 px-5 bg-gradient-to-b from-transparent via-yellow-950/10 to-transparent"
    >
      <LuxReveal className="max-w-6xl mx-auto">
        <div className="text-center mb-16 space-y-4">
          <MarketingBadge variant="kicker">
            Featured Tools
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            The complete creator toolkit
          </h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            Six powerful tools designed to take you from concept to release —
            faster than ever.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {TOOLS.map((tool) => (
            <div
              key={tool.title}
              className={`relative group flex flex-col p-7 rounded-2xl lux-card-lift ${
                tool.featured
                  ? "royal-border bg-primary/10 shadow-[0_0_30px_rgba(218,165,32,0.18)]"
                  : "lux-panel"
              } ${tool.comingSoon ? "opacity-60" : ""}`}
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
                    : "bg-white/[0.06] group-hover:bg-primary/20 transition-colors shadow-[inset_0_1px_0_hsl(0_0%_100%/0.08)]"
                }`}
              >
                <tool.icon
                  className={`h-6 w-6 ${tool.featured ? "text-white" : "text-primary"}`}
                />
              </div>

              <div className="flex-1">
                <div className="flex items-start justify-between mb-2 gap-2">
                  <h3 className="font-semibold text-white text-lg leading-tight">
                    {tool.title}
                  </h3>
                  {tool.comingSoon ? (
                    <MarketingBadge variant="soon" className="shrink-0">
                      <Lock className="h-2.5 w-2.5" /> Soon
                    </MarketingBadge>
                  ) : (
                    <MarketingBadge variant="muted" className="shrink-0">
                      {tool.cost}
                    </MarketingBadge>
                  )}
                </div>
                <p className="text-white/50 text-sm leading-relaxed">
                  {tool.description}
                </p>
              </div>

              {!tool.comingSoon && (
                <Link
                  href={tool.href}
                  className="mt-6 flex items-center gap-2 text-sm font-semibold text-primary hover:text-yellow-300 transition-colors group/link"
                >
                  Try this tool{" "}
                  <ChevronRight className="h-4 w-4 group-hover/link:translate-x-1 transition-transform" />
                </Link>
              )}
            </div>
          ))}
        </div>
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
            Simple, creator-first pricing
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
                  : "lux-card"
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
            Early Access
          </MarketingBadge>
          <h2 className="text-3xl md:text-4xl font-semibold text-white tracking-tight mb-4">
            Be first in line.
          </h2>
          <p className="text-white/50 text-lg max-w-md mx-auto">
            Join the waitlist and get priority access when our paid plans go
            live — plus an early-bird discount.
          </p>
        </div>

        {submitted ? (
          <div className="p-8 rounded-2xl border border-primary/30 bg-primary/10">
            <div className="text-4xl mb-3">🎤</div>
            <h3 className="text-xl font-semibold text-white mb-2">
              You're on the list.
            </h3>
            <p className="text-white/60 text-sm">
              We'll hit you first when doors open. In the meantime, start
              creating with your 3 free credits.
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
              {loading ? "Joining..." : "Join Waitlist"}
            </Button>
          </form>
        )}

        {error && !submitted && (
          <div className="max-w-md mx-auto p-3 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <p className="text-white/25 text-xs">
          No spam. No credit card. Just early access.
        </p>
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
  usePageTitle("Create Songs, Music Videos & Promo Clips With AI", "Tell us your artist, genre, and idea. Bow Down Visuals generates lyrics, video treatments, promo content, and more — in seconds.");
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

  function scrollToWaitlist() {
    waitlistRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  /* Don't flash the marketing page while the redirect fires. */
  if (authLoading || user) return null;

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden lux-page">
      <JsonLd data={SOFTWARE_APPLICATION_JSON_LD} />
      <JsonLd data={HOME_FAQ_JSON_LD} />
      <HeroSection onWaitlist={scrollToWaitlist} />
      <CheatCodeTicker />
      <MusicVideoTeaser />
      <HowItWorks />
      <SectionDivider />
      <WhatYouCanMake />
      <BuiltForCreators />
      <SectionDivider />
      <FeaturedTools />
      <PricingSection />
      <SectionDivider />
      <FAQSection />
      <WaitlistSection ref={waitlistRef} />
    </div>
  );
}
