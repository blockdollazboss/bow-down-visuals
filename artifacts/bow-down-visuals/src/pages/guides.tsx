import { useEffect } from "react";
import { Link } from "wouter";
import {
  Scale, Copyright, GraduationCap, ArrowRight, Sparkles,
  ShieldCheck, BadgeDollarSign, BookOpen, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { MarketingBadge } from "@/components/MarketingBadge";
import { SiteFooter } from "@/components/layout/footer";

/* ─── Guides & Services ─────────────────────────────────────────────────
   The business side of being a creator — free-to-read guides:
   LLC formation, copyright registration, and the Creator Academy.
   Pure interface: no AI compute here, so everything is FREE. */

const GUIDES = [
  {
    href: "/llc-guide",
    icon: Scale,
    name: "LLC Formation Guide",
    tagline: "Protect yourself like a business",
    description:
      "Step-by-step walkthrough for forming an LLC as a creator — pick your state, see real filing fees, get an EIN, and download an operating agreement template.",
    bullets: [
      "Filing fees for all 50 states",
      "Interactive cost calculator",
      "Checklist with saved progress",
      "Operating agreement template",
    ],
    badge: "Free guide",
  },
  {
    href: "/copyright",
    icon: Copyright,
    name: "Copyright Registration",
    tagline: "Own your work on paper",
    description:
      "Guided help for registering songs, lyrics, videos, and photos with the U.S. Copyright Office — what to file, what it costs, and what it actually protects.",
    bullets: [
      "Song, lyric, video & photo guidance",
      "Current filing fees ($45 / $65)",
      "Myth-busting: poor man's copyright",
      "Registration tracker",
    ],
    badge: "Free guide",
  },
  {
    href: "/academy",
    icon: GraduationCap,
    name: "Creator Academy",
    tagline: "Learn the game, master the craft",
    description:
      "Structured courses for creators — video production, TikTok growth, YouTube strategy, and more. Browse every lesson free, with progress tracking.",
    bullets: [
      "7 courses, 40+ lessons",
      "Beginner to advanced paths",
      "Progress saved automatically",
      "AI learning-path generator",
    ],
    badge: "Free to browse",
  },
];

export default function Guides() {
  useEffect(() => {
    document.title = "Guides & Services — Bow Down Visuals";
  }, []);

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      {/* ── HERO ── */}
      <section className="max-w-3xl mx-auto px-5 md:px-8 pt-16 pb-12 text-center">
        <MarketingBadge variant="kicker" className="mb-5 px-4 py-1.5">
          Guides &amp; Services
        </MarketingBadge>
        <h1 className="text-5xl md:text-6xl font-black text-white tracking-tight mb-5 leading-[0.92]">
          The Business Side
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-primary to-yellow-300">
            of Being a Creator
          </span>
        </h1>
        <p className="text-white/50 text-xl max-w-2xl mx-auto leading-relaxed">
          Great art deserves great protection. Free guides to forming your LLC,
          registering your copyrights, and leveling up your craft.
        </p>
      </section>

      {/* ── GUIDE CARDS ── */}
      <section className="max-w-6xl mx-auto px-5 md:px-8 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {GUIDES.map((g) => (
            <Link key={g.href} href={g.href}>
              <div className="group relative rounded-2xl border border-white/[0.08] bg-white/[0.02] hover:border-primary/40 hover:bg-gradient-to-b hover:from-primary/[0.08] hover:to-transparent transition-all p-6 flex flex-col h-full cursor-pointer hover:shadow-[0_0_60px_rgba(218,165,32,0.12)]">
                <div className="flex items-start justify-between mb-5">
                  <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center">
                    <g.icon className="h-6 w-6 text-primary" />
                  </div>
                  <MarketingBadge variant="free">
                    <Sparkles className="h-2.5 w-2.5" /> {g.badge}
                  </MarketingBadge>
                </div>

                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary/80 mb-1.5">
                  {g.tagline}
                </p>
                <h2 className="text-xl font-bold text-white mb-2.5">{g.name}</h2>
                <p className="text-sm text-white/55 leading-relaxed mb-5">
                  {g.description}
                </p>

                <div className="space-y-2 flex-1 mb-6">
                  {g.bullets.map((b) => (
                    <div key={b} className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm text-white/70">{b}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2 text-sm font-bold text-primary group-hover:gap-3 transition-all">
                  Open guide <ArrowRight className="h-4 w-4" />
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* ── WHY IT MATTERS ── */}
        <div className="mt-14 rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.07] to-transparent p-8 md:p-10">
          <div className="flex items-center gap-2.5 mb-4">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h3 className="text-xl font-bold text-white">Why creators get this wrong</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-white/60 leading-relaxed">
            <div>
              <p className="font-bold text-white mb-1.5 flex items-center gap-1.5">
                <BadgeDollarSign className="h-4 w-4 text-primary" /> Brand deals need a business
              </p>
              Brands pay companies, not DMs. An LLC with an EIN lets you sign real contracts,
              get paid properly, and keep your personal assets separate from your creator life.
            </div>
            <div>
              <p className="font-bold text-white mb-1.5 flex items-center gap-1.5">
                <Copyright className="h-4 w-4 text-primary" /> Registration wins disputes
              </p>
              You own your copyright the moment you create — but only registration lets you
              sue for infringement and claim statutory damages. It's the cheapest insurance
              in music.
            </div>
            <div>
              <p className="font-bold text-white mb-1.5 flex items-center gap-1.5">
                <BookOpen className="h-4 w-4 text-primary" /> Skill compounds
              </p>
              The creators who last treat it like a craft. Thirty minutes a day in the
              Academy beats another year of guessing what the algorithm wants.
            </div>
          </div>
        </div>

        {/* ── DISCLAIMER ── */}
        <p className="text-center text-xs text-white/25 max-w-2xl mx-auto mt-8 flex items-start justify-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          These guides are educational — not legal, tax, or financial advice.
          For your specific situation, talk to a licensed attorney or CPA.
        </p>
      </section>

      <SiteFooter />
    </div>
  );
}
