import { useState, useRef, forwardRef } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { HomepageThemePlayer } from "@/components/HomepageThemePlayer";
import {
  Music, Video, Film, Image as ImageIcon, Mic2, Archive,
  ChevronDown, ChevronRight, Menu, X, Zap, CheckCircle2,
  Sparkles, Target, Users, ArrowRight, Star, Globe, Lock
} from "lucide-react";

/* ─────────────────────────── DATA ─────────────────────────── */

const NAV_LINKS = [
  { label: "How It Works", href: "#how-it-works" },
  { label: "Tools", href: "#tools" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
  { label: "Waitlist", href: "/waitlist" },
  { label: "Contact", href: "/contact" },
];

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
  { title: "Independent Artists", body: "Move at your own speed. Generate professional content without a full team.", icon: Mic2 },
  { title: "Music Producers", body: "Build complete song concepts and pitch lyrics to artists instantly.", icon: Music },
  { title: "Video Directors", body: "Get detailed scene treatments and visual direction for any sound.", icon: Video },
  { title: "Content Creators", body: "Keep your feed alive with platform-ready captions and promo ideas.", icon: Film },
  { title: "Record Labels", body: "Scale output across your entire roster without burning out your team.", icon: Users },
  { title: "Managers & A&R", body: "Draft release strategies and pitch decks in minutes, not days.", icon: Star },
];

const TOOLS = [
  {
    title: "Make a Song",
    description: "Generate full lyrics, hooks, verse structure, and song notes tailored to your genre and mood.",
    icon: Music,
    cost: "1 credit",
    href: "/make-song",
    featured: false,
  },
  {
    title: "Make a Music Video",
    description: "Create a complete scene-by-scene treatment with visual direction, location ideas, and shot notes.",
    icon: Video,
    cost: "1 credit",
    href: "/make-video",
    featured: false,
  },
  {
    title: "Make Song + Video",
    description: "The full package — lyrics, music prompt, video treatment, and promo content generated together.",
    icon: Mic2,
    cost: "2 credits",
    href: "/song-and-video",
    featured: true,
  },
  {
    title: "Promo Clip Maker",
    description: "Plan your social media rollout with teaser scripts, release captions, and platform-specific hooks.",
    icon: Film,
    cost: "1 credit",
    href: "/promo-clip",
    featured: false,
  },
  {
    title: "Thumbnail Maker",
    description: "Generate compelling cover art concepts and thumbnail ideas that grab attention on every platform.",
    icon: ImageIcon,
    cost: "1 credit",
    href: "/thumbnail",
    featured: false,
  },
  {
    title: "Artist Profiles",
    description: "Save your artist profile, style rules, and brand colors so every generation is on-brand automatically.",
    icon: Archive,
    cost: "Coming soon",
    href: "#",
    featured: false,
    comingSoon: true,
  },
];

const PLANS = [
  {
    name: "Starter",
    price: "Free",
    credits: "3 credits",
    note: "to get you started",
    perks: ["3 monthly credits", "All tools", "Basic generation"],
    locked: false,
  },
  {
    name: "Pro",
    price: "Coming Soon",
    credits: "50 credits/mo",
    note: "for independent creators",
    perks: ["50 monthly credits", "All tools", "Priority generation", "Artist Vault"],
    locked: true,
  },
  {
    name: "Label",
    price: "Coming Soon",
    credits: "Unlimited",
    note: "for teams and labels",
    perks: ["Unlimited credits", "All tools", "Team seats", "API access", "Dedicated support"],
    locked: true,
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
    a: "We're currently in early access. Join the waitlist to be first in line when Pro and Label plans go live — waitlist members get priority access and early pricing.",
  },
];

/* ─────────────────────────── COMPONENTS ─────────────────────────── */

function Navbar({ onWaitlist }: { onWaitlist: () => void }) {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  function scrollTo(href: string) {
    setOpen(false);
    if (href.startsWith("/")) {
      navigate(href);
    } else {
      document.querySelector(href)?.scrollIntoView({ behavior: "smooth" });
    }
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-black/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="cursor-pointer shrink-0">
          <img src={`${import.meta.env.BASE_URL}logo-static.png`} alt="Bow Down Visuals" className="h-14 w-auto" />
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((l) => (
            <button
              key={l.label}
              onClick={() => scrollTo(l.href)}
              className="text-sm font-medium text-white/60 hover:text-white transition-colors cursor-pointer"
            >
              {l.label}
            </button>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden md:flex items-center gap-3">
          <Button variant="ghost" size="sm" className="text-white/60 hover:text-white" onClick={onWaitlist}>
            Join Waitlist
          </Button>
          <Link href="/dashboard">
            <Button size="sm" className="gold-glow font-semibold px-5">
              Start Creating
            </Button>
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden text-white/70 hover:text-white p-1"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-white/5 bg-black/95 px-5 py-4 space-y-3">
          {NAV_LINKS.map((l) => (
            <button
              key={l.label}
              onClick={() => scrollTo(l.href)}
              className="block w-full text-left text-sm font-medium text-white/70 hover:text-white py-2 transition-colors"
            >
              {l.label}
            </button>
          ))}
          <div className="pt-3 space-y-2 border-t border-white/5">
            <Button variant="outline" size="sm" className="w-full border-white/10" onClick={() => { onWaitlist(); setOpen(false); }}>
              Join Waitlist
            </Button>
            <Link href="/dashboard">
              <Button size="sm" className="w-full gold-glow font-semibold">Start Creating</Button>
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}

function HeroSection({ onWaitlist }: { onWaitlist: () => void }) {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center text-center px-5 pt-16 overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-yellow-600/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-1/4 left-1/4 w-[300px] h-[300px] bg-yellow-600/4 rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute bottom-1/3 right-1/4 w-[250px] h-[250px] bg-yellow-700/4 rounded-full blur-[80px] pointer-events-none" />
      </div>

      {/* Grid overlay */}
      <div
        className="absolute inset-0 z-0 opacity-[0.03]"
        style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 max-w-5xl mx-auto space-y-4">
        {/* Hero Logo */}
        <div className="flex justify-center -my-16">
          <AnimatedLogo className="w-[680px] max-w-full h-auto" />
        </div>

        {/* Homepage Theme Player */}
        <HomepageThemePlayer />

        {/* Badge */}
        <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/25 rounded-full px-4 py-1.5 text-sm font-medium text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          AI-Powered Music Creation Studio
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-tight text-white leading-[0.92]">
          Create Songs,{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-primary to-yellow-300">
            Music Videos,
          </span>{" "}
          and Promo Clips With AI
        </h1>

        {/* Slogan */}
        <p className="text-base sm:text-lg font-semibold tracking-widest text-primary/80 uppercase">
          Create the Song. Create the Video. Promote the Release.
        </p>

        {/* Subheadline */}
        <p className="text-lg sm:text-xl text-white/55 max-w-2xl mx-auto leading-relaxed">
          Bow Down Visuals helps music creators generate lyrics, hooks, music video plans, scene prompts, thumbnails, captions, and promo content for their next release.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
          <Link href="/dashboard">
            <Button size="lg" className="w-full sm:w-auto gold-glow text-base h-14 px-10 rounded-full font-bold gap-2">
              Start Creating <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Button
            size="lg"
            variant="outline"
            className="w-full sm:w-auto text-base h-14 px-10 rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:border-white/25 font-semibold"
            onClick={onWaitlist}
          >
            Join Waitlist
          </Button>
        </div>

        {/* Social proof */}
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 pt-4 text-sm text-white/35 font-medium">
          <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary/60" /> 3 free credits on signup</span>
          <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary/60" /> No credit card required</span>
          <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-primary/60" /> Results in seconds</span>
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
    <section id="how-it-works" className="py-28 px-5 relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16 space-y-4">
          <Badge variant="outline" className="border-primary/30 text-primary bg-primary/5 uppercase tracking-widest text-xs">
            How It Works
          </Badge>
          <h2 className="text-4xl md:text-5xl font-black text-white">From idea to release in minutes</h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            No experience needed. Just describe your vision and let the studio handle the rest.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          {/* Connector line (desktop only) */}
          <div className="hidden md:block absolute top-16 left-1/3 right-1/3 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent pointer-events-none" />

          {STEPS.map((step) => (
            <div
              key={step.number}
              className="relative flex flex-col items-center text-center p-8 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-primary/25 transition-all duration-300 group"
            >
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-5xl font-black text-primary/10 select-none pointer-events-none">
                {step.number}
              </div>
              <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6 mt-4 group-hover:bg-primary/20 transition-colors">
                <step.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">{step.title}</h3>
              <p className="text-white/50 leading-relaxed text-sm">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhatYouCanMake() {
  return (
    <section className="py-24 px-5 bg-gradient-to-b from-transparent via-yellow-950/10 to-transparent">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-14 space-y-4">
          <Badge variant="outline" className="border-primary/30 text-primary bg-primary/5 uppercase tracking-widest text-xs">
            What You Can Make
          </Badge>
          <h2 className="text-4xl md:text-5xl font-black text-white">Everything your release needs</h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            One platform. Every piece of creative content your music career demands.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {OUTPUT_TYPES.map((type, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-primary/30 hover:bg-primary/5 transition-all duration-200 group"
            >
              <div className="h-1.5 w-1.5 rounded-full bg-primary group-hover:scale-150 transition-transform shrink-0" />
              <span className="text-sm font-medium text-white/70 group-hover:text-white transition-colors">{type}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BuiltForCreators() {
  return (
    <section className="py-28 px-5">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16 space-y-4">
          <Badge variant="outline" className="border-primary/30 text-primary bg-primary/5 uppercase tracking-widest text-xs">
            Built For
          </Badge>
          <h2 className="text-4xl md:text-5xl font-black text-white">Built for music creators</h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            Whether you're an independent artist or running a label, Bow Down Visuals was made for you.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {CREATOR_TYPES.map((creator) => (
            <div
              key={creator.title}
              className="group p-7 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-primary/30 hover:bg-primary/5 transition-all duration-300"
            >
              <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center mb-5 group-hover:bg-primary/20 transition-colors">
                <creator.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-bold text-white text-lg mb-2">{creator.title}</h3>
              <p className="text-white/50 text-sm leading-relaxed">{creator.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturedTools() {
  return (
    <section id="tools" className="py-28 px-5 bg-gradient-to-b from-transparent via-yellow-950/10 to-transparent">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16 space-y-4">
          <Badge variant="outline" className="border-primary/30 text-primary bg-primary/5 uppercase tracking-widest text-xs">
            Featured Tools
          </Badge>
          <h2 className="text-4xl md:text-5xl font-black text-white">The complete creator toolkit</h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            Six powerful tools designed to take you from concept to release — faster than ever.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {TOOLS.map((tool) => (
            <div
              key={tool.title}
              className={`relative group flex flex-col p-7 rounded-2xl border transition-all duration-300 ${
                tool.featured
                  ? "bg-primary/10 border-primary/40 shadow-[0_0_30px_rgba(147,51,234,0.15)]"
                  : "bg-white/[0.02] border-white/[0.06] hover:border-primary/30 hover:bg-primary/5"
              } ${tool.comingSoon ? "opacity-60" : ""}`}
            >
              {tool.featured && (
                <div className="absolute -top-3 left-6">
                  <Badge className="bg-primary text-white border-0 text-xs font-bold tracking-wide">
                    ⭐ MOST POPULAR
                  </Badge>
                </div>
              )}

              <div className={`h-12 w-12 rounded-xl flex items-center justify-center mb-5 ${
                tool.featured ? "bg-primary text-white" : "bg-white/5 group-hover:bg-primary/20 transition-colors"
              }`}>
                <tool.icon className={`h-6 w-6 ${tool.featured ? "text-white" : "text-primary"}`} />
              </div>

              <div className="flex-1">
                <div className="flex items-start justify-between mb-2 gap-2">
                  <h3 className="font-bold text-white text-xl leading-tight">{tool.title}</h3>
                  {tool.comingSoon ? (
                    <Badge variant="outline" className="border-white/15 text-white/40 text-xs shrink-0 flex items-center gap-1">
                      <Lock className="h-2.5 w-2.5" /> Soon
                    </Badge>
                  ) : (
                    <span className="text-xs text-primary/70 font-semibold bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-full shrink-0 whitespace-nowrap">
                      {tool.cost}
                    </span>
                  )}
                </div>
                <p className="text-white/50 text-sm leading-relaxed">{tool.description}</p>
              </div>

              {!tool.comingSoon && (
                <Link href={tool.href} className="mt-6 flex items-center gap-2 text-sm font-semibold text-primary hover:text-yellow-300 transition-colors group/link">
                  Try this tool <ChevronRight className="h-4 w-4 group-hover/link:translate-x-1 transition-transform" />
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingSection({ onWaitlist }: { onWaitlist: () => void }) {
  return (
    <section id="pricing" className="py-28 px-5">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16 space-y-4">
          <Badge variant="outline" className="border-primary/30 text-primary bg-primary/5 uppercase tracking-widest text-xs">
            Pricing Coming Soon
          </Badge>
          <h2 className="text-4xl md:text-5xl font-black text-white">Simple, creator-first pricing</h2>
          <p className="text-white/50 text-lg max-w-xl mx-auto">
            Start free. Scale when you're ready. No surprise charges.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col p-8 rounded-2xl border transition-all ${
                !plan.locked
                  ? "bg-primary/10 border-primary/40 shadow-[0_0_25px_rgba(147,51,234,0.12)]"
                  : "bg-white/[0.02] border-white/[0.06]"
              }`}
            >
              <div className="mb-6">
                <p className="text-sm font-bold text-white/40 uppercase tracking-widest mb-1">{plan.name}</p>
                <div className="text-3xl font-black text-white mb-1">
                  {plan.locked ? (
                    <span className="text-white/30 text-2xl">Launching soon</span>
                  ) : (
                    plan.price
                  )}
                </div>
                <p className={`text-sm ${plan.locked ? "text-white/25" : "text-primary/80"} font-medium`}>
                  {plan.credits} {!plan.locked && `— ${plan.note}`}
                </p>
              </div>

              <ul className="space-y-2.5 flex-1 mb-8">
                {plan.perks.map((perk) => (
                  <li key={perk} className={`flex items-center gap-2.5 text-sm ${plan.locked ? "text-white/30" : "text-white/70"}`}>
                    <CheckCircle2 className={`h-4 w-4 shrink-0 ${plan.locked ? "text-white/20" : "text-primary"}`} />
                    {perk}
                  </li>
                ))}
              </ul>

              {plan.locked ? (
                <Button
                  onClick={onWaitlist}
                  variant="outline"
                  className="w-full border-white/10 text-white/40 hover:text-white hover:border-white/20"
                >
                  Join Waitlist
                </Button>
              ) : (
                <Link href="/dashboard">
                  <Button className="w-full gold-glow font-semibold">Get Started Free</Button>
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="py-28 px-5 bg-gradient-to-b from-transparent via-yellow-950/8 to-transparent">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-14 space-y-4">
          <Badge variant="outline" className="border-primary/30 text-primary bg-primary/5 uppercase tracking-widest text-xs">
            FAQ
          </Badge>
          <h2 className="text-4xl md:text-5xl font-black text-white">Frequently asked questions</h2>
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
                <span className="font-semibold text-white text-base">{faq.q}</span>
                <ChevronDown
                  className={`h-5 w-5 text-primary shrink-0 transition-transform duration-200 ${openIndex === i ? "rotate-180" : ""}`}
                />
              </button>
              {openIndex === i && (
                <div className="px-6 pb-5">
                  <p className="text-white/55 leading-relaxed text-sm">{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const WaitlistSection = forwardRef<HTMLElement>((_, ref) => {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setTimeout(() => {
      setSubmitted(true);
      setLoading(false);
    }, 800);
  }

  return (
    <section ref={ref} id="waitlist" className="py-28 px-5">
      <div className="max-w-2xl mx-auto text-center space-y-8">
        <div className="relative">
          <div className="absolute -inset-20 bg-yellow-600/8 rounded-full blur-[80px] pointer-events-none" />
          <Badge variant="outline" className="border-primary/30 text-primary bg-primary/5 uppercase tracking-widest text-xs mb-6">
            Early Access
          </Badge>
          <h2 className="text-4xl md:text-5xl font-black text-white mb-4">
            Be first in line.
          </h2>
          <p className="text-white/50 text-lg max-w-md mx-auto">
            Join the waitlist and get priority access when Pro and Label plans go live — plus an early-bird discount.
          </p>
        </div>

        {submitted ? (
          <div className="p-8 rounded-2xl border border-primary/30 bg-primary/10">
            <div className="text-4xl mb-3">🎤</div>
            <h3 className="text-xl font-bold text-white mb-2">You're on the list.</h3>
            <p className="text-white/60 text-sm">We'll hit you first when doors open. In the meantime, start creating with your 3 free credits.</p>
            <Link href="/dashboard">
              <Button className="gold-glow mt-5 font-semibold gap-2">
                Start Creating Now <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-12 flex-1 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-primary/50"
            />
            <Button
              type="submit"
              size="lg"
              disabled={loading}
              className="gold-glow h-12 px-7 font-bold shrink-0"
            >
              {loading ? "Joining..." : "Join Waitlist"}
            </Button>
          </form>
        )}

        <p className="text-white/25 text-xs">No spam. No credit card. Just early access.</p>
      </div>
    </section>
  );
});
WaitlistSection.displayName = "WaitlistSection";

/* ─────────────────────────── PAGE ─────────────────────────── */

export default function Home() {
  const waitlistRef = useRef<HTMLElement>(null);

  function scrollToWaitlist() {
    waitlistRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      <Navbar onWaitlist={scrollToWaitlist} />
      <HeroSection onWaitlist={scrollToWaitlist} />
      <HowItWorks />
      <WhatYouCanMake />
      <BuiltForCreators />
      <FeaturedTools />
      <PricingSection onWaitlist={scrollToWaitlist} />
      <FAQSection />
      <WaitlistSection ref={waitlistRef} />
    </div>
  );
}
