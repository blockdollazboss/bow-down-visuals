import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { MarketingNav } from "@/components/MarketingNav";
import { MarketingBadge } from "@/components/MarketingBadge";
import {
  Check, Zap, HelpCircle, ChevronDown, ArrowRight,
  Sparkles, AlertCircle, CreditCard, Lock, Loader2, Star,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { JsonLd, buildFaqJsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── data ─── */

const PLANS = [
  {
    stars: 1,
    name: "Starter",
    streetTitle: "On the Map",
    price: 19,
    period: "/month",
    bestFor: "New creators",
    credits: "25 credits monthly",
    featured: false,
    badge: null,
    cta: "Start with 1 Star",
    features: [
      "AI Music Maker",
      "Music video plans & treatments",
      "Promo clip planning",
      "Hook Studio + virality check",
      "Thumbnail Maker & Logo Maker",
      "Thy Cheat Code guided setup",
    ],
  },
  {
    stars: 2,
    name: "Creator",
    streetTitle: "Rising Heat",
    price: 49,
    period: "/month",
    bestFor: "Active solo creators",
    credits: "100 credits monthly",
    featured: true,
    badge: "Most Popular",
    cta: "Get 2 Stars",
    features: [
      "Everything in Starter",
      "AI video clip generation",
      "Full Video Editor access",
      "Artist Vault + Photo Shoot",
      "Artist Voice Lock",
      "Character video references",
    ],
  },
  {
    stars: 3,
    name: "Pro Artist",
    streetTitle: "Wanted",
    price: 99,
    period: "/month",
    bestFor: "Serious full-time creators",
    credits: "250 credits monthly",
    featured: false,
    badge: null,
    cta: "Go Pro with 3 Stars",
    features: [
      "Everything in Creator",
      "AI Lip Sync",
      "AI mastering + stem separation",
      "Advanced effects & transitions",
      "Upscaling & watermark cleanup",
      "Batch creative variations",
    ],
  },
  {
    stars: 4,
    name: "Studio",
    streetTitle: "High Alert",
    price: 199,
    period: "/month",
    bestFor: "Teams & creator brands",
    credits: "600 credits monthly",
    featured: false,
    badge: null,
    cta: "Build with 4 Stars",
    features: [
      "Everything in Pro Artist",
      "Team workspace & member roles",
      "Shared vaults & brand libraries",
      "Review & approval workflow",
      "Social scheduling & publishing",
      "Bulk asset creation",
    ],
  },
  {
    stars: 5,
    name: "VIP",
    streetTitle: "Most Wanted",
    price: 399,
    period: "/month",
    bestFor: "High-volume creators",
    credits: "1,500 credits monthly",
    featured: false,
    badge: "Exclusive",
    cta: "Become 5-Star VIP",
    features: [
      "Everything in Studio",
      "Priority generation queue",
      "4K output where supported",
      "Early access to new AI models",
      "Advanced cross-platform analytics",
      "Exclusive VIP templates & styles",
    ],
  },
  {
    stars: 6,
    name: "MVP",
    streetTitle: "Kingpin",
    price: 799,
    period: "/month",
    bestFor: "Labels, agencies & power users",
    credits: "4,000 credits monthly",
    featured: false,
    badge: "Top Tier",
    cta: "Claim 6-Star MVP",
    features: [
      "Everything in VIP",
      "8K delivery where supported",
      "Custom AI style training",
      "White-label client deliverables",
      "API access & automation",
      "Dedicated account manager",
    ],
  },
];

const CREDIT_PACKS = [
  { credits: "10 Credits",  price: "$9",   packKey: "10"  },
  { credits: "50 Credits",  price: "$39",  packKey: "50"  },
  { credits: "150 Credits", price: "$99",  packKey: "150" },
  { credits: "500 Credits", price: "$249", packKey: "500" },
];

const FAQ = [
  {
    q: "What are credits?",
    a: "Credits are used each time you run an AI generation — making a song, generating a video plan, creating promo clips, or producing music video clips. Each action draws from your monthly credit balance.",
  },
  {
    q: "Are payments live yet?",
    a: "Not yet. Bow Down Visuals is currently in beta. Payments are coming soon. Join the beta list now to lock in your founding rate and get early access when billing goes live.",
  },
  {
    q: "Can I use Bow Down Visuals during beta?",
    a: "Yes. Beta users can test selected tools with a starter credit balance. Sign up, explore the creator tools, and give us feedback. Full access opens with the paid launch.",
  },
  {
    q: "Do music video clips cost credits?",
    a: "Yes — music video clip generation is a premium action and uses more credits than standard text generation. The exact cost per clip will be confirmed at launch.",
  },
  {
    q: "Can I cancel later?",
    a: "Yes. Once billing is live, you can upgrade, downgrade, or cancel any time from your account settings. No contracts. No cancellation fees.",
  },
  {
    q: "Does this make real songs with vocals yet?",
    a: "AI song vocals and full beat generation are planned but not fully launched yet. Right now the platform creates professional lyrics, hooks, verses, AI music prompts, video treatments, and promo content — everything you need to direct and produce your release.",
  },
];

const PRICING_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Bow Down Visuals",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  description:
    "AI-powered creative studio for music creators, offering subscription plans for song lyrics, music video treatments, promo clips, and thumbnails.",
  offers: {
    "@type": "OfferCatalog",
    name: "Bow Down Visuals Plans",
    itemListElement: PLANS.map((plan) => ({
      "@type": "Offer",
      name: plan.name,
      price: String(plan.price),
      priceCurrency: "USD",
      description: plan.features.join(", "),
      category: plan.bestFor,
    })),
  },
};

const PRICING_FAQ_JSON_LD = buildFaqJsonLd(FAQ.map((f) => ({ q: f.q, a: f.a })));

/* ─── credit pack card ─── */

function CreditPackCard({ pack }: { pack: { credits: string; price: string; packKey: string } }) {
  const { user, getAccessToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleBuy() {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ pack: pack.packKey }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setErrorMsg(data.error ?? "Checkout failed. Please try again.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setErrorMsg("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lux-card p-5 flex flex-col items-center text-center gap-4">
      <div className="h-11 w-11 rounded-2xl bg-gradient-to-b from-primary/25 to-primary/10 border border-primary/30 flex items-center justify-center shadow-[0_0_20px_-4px_hsl(45_95%_50%/0.4),inset_0_1px_0_hsl(0_0%_100%/0.15)]">
        <CreditCard className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className="text-lg font-black text-white leading-tight tracking-tight">{pack.credits}</p>
        <p className="text-2xl font-black text-primary mt-1 tracking-tight">{pack.price}</p>
      </div>
      {errorMsg && (
        <p className="text-[11px] text-red-400 leading-snug text-center px-1">{errorMsg}</p>
      )}
      <Button
        size="sm"
        onClick={handleBuy}
        disabled={loading}
        className="w-full font-bold gap-2"
        variant="luxury"
      >
        {loading ? (
          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing…</>
        ) : (
          <><CreditCard className="h-3.5 w-3.5" /> Buy Credits</>
        )}
      </Button>
    </div>
  );
}

/* ─── faq accordion ─── */

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/[0.06] last:border-0">
      <button onClick={() => setOpen(!open)} className="flex items-center justify-between w-full py-5 text-left gap-4">
        <span className="text-base font-bold text-white">{q}</span>
        <ChevronDown className={`h-4 w-4 text-white/40 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <p className="text-white/55 text-sm leading-relaxed pb-5">{a}</p>}
    </div>
  );
}

/* ─── wanted-level star meter ─── */

function WantedMeter({ onSelect }: { onSelect: (stars: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="flex flex-col items-center gap-3 mt-8">
      <div
        className="flex items-center gap-2"
        role="radiogroup"
        aria-label="Preview wanted level"
        onMouseLeave={() => setHovered(null)}
      >
        {([1, 2, 3, 4, 5, 6] as const).map((s) => {
          const lit = (hovered ?? 0) >= s;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={false}
              aria-label={`${s} star${s > 1 ? "s" : ""} — ${PLANS[s - 1]!.name} $${PLANS[s - 1]!.price}/month`}
              onMouseEnter={() => setHovered(s)}
              onFocus={() => setHovered(s)}
              onClick={() => onSelect(s)}
              className="p-1 transition-transform hover:scale-125 active:scale-95"
            >
              <Star
                className={`h-8 w-8 md:h-10 md:w-10 transition-all duration-150 ${
                  lit
                    ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.9)]"
                    : "fill-transparent text-white/20"
                }`}
              />
            </button>
          );
        })}
      </div>
      <p className="text-sm text-white/40 font-medium h-5">
        {hovered
          ? `${hovered} Star${hovered > 1 ? "s" : ""} — ${PLANS[hovered - 1]!.name} · $${PLANS[hovered - 1]!.price}/mo`
          : "Hover the stars, then tap a level to jump to its plan"}
      </p>
    </div>
  );
}

/* ─── page ─── */

export default function Pricing() {
  usePageTitle("Pricing", "Choose your wanted level — six star-rated creator plans.");
  const [showCancelled, setShowCancelled] = useState(false);
  const [highlightedPlan, setHighlightedPlan] = useState<number | null>(null);
  const planRefs = useRef<(HTMLDivElement | null)[]>([]);

  function jumpToPlan(stars: number) {
    setHighlightedPlan(stars);
    planRefs.current[stars - 1]?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setHighlightedPlan(null), 2600);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "cancelled") {
      setShowCancelled(true);
      window.history.replaceState({}, "", "/pricing");
    }
    // Scroll to hash anchor (wouter SPA navigation doesn't trigger native hash scrolling)
    if (window.location.hash) {
      const id = window.location.hash.slice(1);
      setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, []);

  return (
    <div className="min-h-screen bg-black text-white lux-page">
      <JsonLd data={PRICING_JSON_LD} />
      <JsonLd data={PRICING_FAQ_JSON_LD} />
      <MarketingNav />

      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-60px] left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-yellow-600/10 rounded-full blur-[130px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-yellow-900/6 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10">

        {/* ── PAYMENT CANCELLED BANNER ── */}
        {showCancelled && (
          <div className="border-b border-yellow-500/20 bg-yellow-500/[0.06]">
            <div className="max-w-6xl mx-auto px-5 md:px-8 py-3 flex items-center justify-center gap-3">
              <AlertCircle className="h-4 w-4 text-yellow-400 shrink-0" />
              <span className="text-sm text-yellow-200/80">
                Payment cancelled. No credits were added.
              </span>
              <button
                onClick={() => setShowCancelled(false)}
                className="text-white/30 hover:text-white/60 transition-colors text-lg leading-none ml-2"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* ── BETA NOTICE BANNER ── */}
        <div className="border-b border-primary/20 bg-primary/[0.06]">
          <div className="max-w-6xl mx-auto px-5 md:px-8 py-3 flex flex-col sm:flex-row items-center justify-center gap-2 text-center sm:text-left">
            <div className="flex items-center gap-2 shrink-0">
              <AlertCircle className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-bold text-primary">Beta Notice:</span>
            </div>
            <span className="text-sm text-white/55">
              Bow Down Visuals is currently in beta. Payments are not live yet.{" "}
              <Link href="/beta-access" className="text-primary font-semibold hover:underline">
                Join the beta list for early access →
              </Link>
            </span>
          </div>
        </div>

        {/* ── HERO ── */}
        <section className="max-w-3xl mx-auto px-5 md:px-8 pt-16 pb-12 text-center">
          <MarketingBadge variant="kicker" className="mb-5 px-4 py-1.5">
            Pricing
          </MarketingBadge>
          <h1 className="text-5xl md:text-6xl font-black text-white tracking-tight mb-5 leading-[0.92]">
            Choose Your<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-primary to-yellow-300">
              Wanted Level
            </span>
          </h1>
          <p className="text-white/50 text-xl max-w-2xl mx-auto leading-relaxed">
            The higher the heat, the more power, credits, automation, and control you unlock.
          </p>
          <p className="text-white/35 text-sm max-w-xl mx-auto mt-3">
            No free generations. No hidden compute charges. See the credit cost before you create.
          </p>
          <WantedMeter onSelect={jumpToPlan} />
        </section>

        {/* ── PLANS ── */}
        <section className="max-w-7xl mx-auto px-5 md:px-8 pb-20">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 lux-stagger">
            {PLANS.map((plan) => {
              const isExclusive = plan.name === "VIP" || plan.name === "MVP";
              const isHighlighted = highlightedPlan === plan.stars;
              return (
              <div
                key={plan.name}
                ref={(el) => { planRefs.current[plan.stars - 1] = el; }}
                className={`relative rounded-2xl border flex flex-col p-6 transition-all duration-300 ${
                  isHighlighted
                    ? "border-amber-300 bg-amber-400/[0.08] shadow-[0_0_60px_rgba(251,191,36,0.35)] -translate-y-1"
                    : plan.name === "MVP"
                    ? "lux-shine border-amber-400/50 bg-gradient-to-b from-amber-500/[0.12] via-primary/[0.06] to-transparent shadow-[0_0_80px_rgba(251,191,36,0.2)] hover:-translate-y-1"
                    : plan.name === "VIP"
                    ? "border-purple-400/40 bg-gradient-to-b from-purple-500/[0.1] via-primary/[0.04] to-transparent shadow-[0_0_60px_rgba(192,132,252,0.15)] hover:-translate-y-1"
                    : plan.featured
                    ? "lux-shine border-primary/45 bg-gradient-to-b from-primary/[0.09] to-primary/[0.03] shadow-[0_0_60px_rgba(218,165,32,0.15)] hover:-translate-y-1"
                    : "lux-card"
                }`}
              >
                {/* Badge */}
                {plan.badge && (
                  <div className="absolute -top-3 left-0 right-0 flex justify-center">
                    <MarketingBadge variant={isExclusive ? "exclusive" : "popular"}>
                      <Sparkles className="h-2.5 w-2.5" /> {plan.badge}
                    </MarketingBadge>
                  </div>
                )}

                {/* Plan header */}
                <div className="mb-5 mt-1">
                  {/* Wanted stars */}
                  <div className="flex items-center gap-1 mb-3" aria-label={`${plan.stars} out of 6 wanted stars`}>
                    {([1, 2, 3, 4, 5, 6] as const).map((s) => (
                      <Star
                        key={s}
                        className={`h-4 w-4 ${
                          s <= plan.stars
                            ? "fill-amber-400 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.8)]"
                            : "fill-transparent text-white/15"
                        }`}
                      />
                    ))}
                  </div>
                  <h2 className="text-lg font-semibold text-white mb-0.5">
                    {plan.name} <span className="text-primary/90 font-bold">· {plan.streetTitle}</span>
                  </h2>
                  <p className="text-xs text-white/35 font-medium mb-4">Best for: {plan.bestFor}</p>

                  <div className="flex items-baseline gap-1 mb-2">
                    <span className="text-4xl font-black text-white">${plan.price}</span>
                    <span className="text-white/35">/month</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Zap className="h-3 w-3 text-primary" />
                    <span className="text-xs font-bold text-primary">{plan.credits}</span>
                  </div>
                </div>

                {/* CTA */}
                <Link href="/beta-access" className="mb-6">
                  <Button
                    className={`w-full font-bold h-10 gap-2 ${
                      plan.featured
                        ? "gold-glow"
                        : ""
                    }`}
                    variant={plan.featured ? "luxury" : "outline"}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {plan.cta}
                    {plan.featured && <ArrowRight className="h-3.5 w-3.5" />}
                  </Button>
                </Link>

                {/* Features */}
                <div className="space-y-2.5 flex-1">
                  {plan.features.map((f) => (
                    <div key={f} className="flex items-start gap-2.5">
                      <Check className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm text-white/75 leading-snug">{f}</span>
                    </div>
                  ))}
                </div>
              </div>
              );
            })}
          </div>

          {/* Coming soon note */}
          <p className="text-center text-xs text-white/25 font-medium mt-6 flex items-center justify-center gap-1.5">
            <Lock className="h-3 w-3" />
            Billing is not live yet. All plan buttons join the beta list.
          </p>
        </section>

        {/* ── TEST CREDIT PACKS ── */}
        <section id="credit-packs" className="scroll-mt-20 max-w-4xl mx-auto px-5 md:px-8 py-20 md:py-28 border-t border-white/[0.05]">
          <div className="text-center mb-6">
            <h2 className="text-2xl md:text-3xl font-semibold text-white tracking-tight mb-3">Test Credit Packs</h2>
            <p className="text-white/40 text-lg">Need extra credits without a subscription? Top up anytime.</p>
          </div>

          {/* Test mode notice */}
          <div className="flex items-center justify-center gap-2 mb-8 px-4 py-3 rounded-xl border border-yellow-500/20 bg-yellow-500/[0.06] max-w-lg mx-auto">
            <AlertCircle className="h-4 w-4 text-yellow-400 shrink-0" />
            <span className="text-sm text-yellow-200/70">
              Payments are currently in <strong className="text-yellow-300">test mode</strong>. No real money is charged.
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {CREDIT_PACKS.map((pack) => (
              <CreditPackCard key={pack.packKey} pack={pack} />
            ))}
          </div>

          <p className="text-center text-xs text-white/25 font-medium mt-5 flex items-center justify-center gap-1.5">
            <Lock className="h-3 w-3" />
            You must be signed in to purchase credits.
          </p>
        </section>

        {/* ── FAQ ── */}
        <section className="max-w-3xl mx-auto px-5 md:px-8 py-20 md:py-28 border-t border-white/[0.05]">
          <div className="flex items-center gap-3 mb-8 justify-center">
            <HelpCircle className="h-5 w-5 text-primary" />
            <h2 className="text-2xl md:text-3xl font-semibold text-white tracking-tight">Frequently Asked Questions</h2>
          </div>
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-6 md:px-8">
            {FAQ.map((item) => <FaqItem key={item.q} q={item.q} a={item.a} />)}
          </div>
        </section>

        {/* ── BOTTOM CTA ── */}
        <section className="max-w-3xl mx-auto px-5 md:px-8 py-20 md:py-28 text-center border-t border-white/[0.05]">
          <h2 className="text-3xl font-semibold text-white tracking-tight mb-4">Get in early.</h2>
          <p className="text-white/45 text-lg mb-8">
            Beta members lock in the founding rate and get 100 bonus credits on launch day.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link href="/beta-access">
              <Button size="lg" className="gold-glow font-bold px-10 h-12 gap-2">
                <Sparkles className="h-4 w-4" /> Join Beta
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button size="lg" variant="outline" className="border-white/10 text-white/60 hover:text-white h-12 px-8 gap-2">
                <Zap className="h-4 w-4" /> Try the Tools
              </Button>
            </Link>
          </div>
        </section>

      </div>
    </div>
  );
}
