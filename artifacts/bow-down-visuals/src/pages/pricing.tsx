import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { MarketingBadge } from "@/components/MarketingBadge";
import {
  Check, Zap, HelpCircle, ChevronDown, ArrowRight,
  Sparkles, AlertCircle, CreditCard, Lock, Loader2, Star,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { JsonLd, buildFaqJsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { mediaUrl } from "@/lib/media-cdn";

type Plan = {
  stars: number;
  name: string;
  price: number;
  period: string;
  bestFor: string;
  credits: string;
  featured: boolean;
  badge: string | null;
  cta: string;
  features: string[];
};

type CreditPack = { credits: string; price: string; packKey: string };

/* ─── credit pack card ─── */

function CreditPackCard({ pack }: { pack: CreditPack }) {
  const { t } = useTranslation();
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
        setErrorMsg(data.error ?? t("pricing.creditPacks.checkoutFailed"));
        return;
      }
      window.location.href = data.url;
    } catch {
      setErrorMsg(t("pricing.creditPacks.networkError"));
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
          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("pricing.creditPacks.processing")}</>
        ) : (
          <><CreditCard className="h-3.5 w-3.5" /> {t("pricing.creditPacks.buyButton")}</>
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

/* ─── rank star meter ─── */

function WantedMeter({ onSelect, plans }: { onSelect: (stars: number) => void; plans: Plan[] }) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="flex flex-col items-center gap-3 mt-8">
      <div
        className="flex items-center gap-2"
        role="radiogroup"
        aria-label={t("pricing.wantedMeter.ariaLabel")}
        onMouseLeave={() => setHovered(null)}
      >
        {([1, 2, 3, 4, 5, 6] as const).map((s) => {
          const lit = (hovered ?? 0) >= s;
          const plan = plans[s - 1]!;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={false}
              aria-label={t("pricing.wantedMeter.starOption", { count: s, name: plan.name, price: plan.price })}
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
          ? t("pricing.wantedMeter.hoverLabel", { count: hovered, name: plans[hovered - 1]!.name, price: plans[hovered - 1]!.price })
          : t("pricing.wantedMeter.hint")}
      </p>
    </div>
  );
}

/* ─── page ─── */

export default function Pricing() {
  const { t } = useTranslation();
  usePageTitle(t("pricing.pageTitle"), t("pricing.pageDescription"));

  /* ─── data (inside component so t() re-renders on language change) ─── */

  const PLANS: Plan[] = [
    {
      stars: 1,
      name: t("pricing.plans.streetPunk.name"),
      price: 19,
      period: t("pricing.planCard.perMonth"),
      bestFor: t("pricing.plans.streetPunk.bestFor"),
      credits: t("pricing.plans.streetPunk.credits"),
      featured: false,
      badge: null,
      cta: t("pricing.plans.streetPunk.cta"),
      features: [
        t("pricing.plans.streetPunk.features.f1"),
        t("pricing.plans.streetPunk.features.f2"),
        t("pricing.plans.streetPunk.features.f3"),
        t("pricing.plans.streetPunk.features.f4"),
        t("pricing.plans.streetPunk.features.f5"),
        t("pricing.plans.streetPunk.features.f6"),
      ],
    },
    {
      stars: 2,
      name: t("pricing.plans.hustler.name"),
      price: 49,
      period: t("pricing.planCard.perMonth"),
      bestFor: t("pricing.plans.hustler.bestFor"),
      credits: t("pricing.plans.hustler.credits"),
      featured: true,
      badge: t("pricing.plans.hustler.badge"),
      cta: t("pricing.plans.hustler.cta"),
      features: [
        t("pricing.plans.hustler.features.f1"),
        t("pricing.plans.hustler.features.f2"),
        t("pricing.plans.hustler.features.f3"),
        t("pricing.plans.hustler.features.f4"),
        t("pricing.plans.hustler.features.f5"),
        t("pricing.plans.hustler.features.f6"),
      ],
    },
    {
      stars: 3,
      name: t("pricing.plans.gangster.name"),
      price: 99,
      period: t("pricing.planCard.perMonth"),
      bestFor: t("pricing.plans.gangster.bestFor"),
      credits: t("pricing.plans.gangster.credits"),
      featured: false,
      badge: null,
      cta: t("pricing.plans.gangster.cta"),
      features: [
        t("pricing.plans.gangster.features.f1"),
        t("pricing.plans.gangster.features.f2"),
        t("pricing.plans.gangster.features.f3"),
        t("pricing.plans.gangster.features.f4"),
        t("pricing.plans.gangster.features.f5"),
        t("pricing.plans.gangster.features.f6"),
      ],
    },
    {
      stars: 4,
      name: t("pricing.plans.shotCaller.name"),
      price: 199,
      period: t("pricing.planCard.perMonth"),
      bestFor: t("pricing.plans.shotCaller.bestFor"),
      credits: t("pricing.plans.shotCaller.credits"),
      featured: false,
      badge: null,
      cta: t("pricing.plans.shotCaller.cta"),
      features: [
        t("pricing.plans.shotCaller.features.f1"),
        t("pricing.plans.shotCaller.features.f2"),
        t("pricing.plans.shotCaller.features.f3"),
        t("pricing.plans.shotCaller.features.f4"),
        t("pricing.plans.shotCaller.features.f5"),
        t("pricing.plans.shotCaller.features.f6"),
      ],
    },
    {
      stars: 5,
      name: t("pricing.plans.crimeBoss.name"),
      price: 399,
      period: t("pricing.planCard.perMonth"),
      bestFor: t("pricing.plans.crimeBoss.bestFor"),
      credits: t("pricing.plans.crimeBoss.credits"),
      featured: false,
      badge: t("pricing.plans.crimeBoss.badge"),
      cta: t("pricing.plans.crimeBoss.cta"),
      features: [
        t("pricing.plans.crimeBoss.features.f1"),
        t("pricing.plans.crimeBoss.features.f2"),
        t("pricing.plans.crimeBoss.features.f3"),
        t("pricing.plans.crimeBoss.features.f4"),
        t("pricing.plans.crimeBoss.features.f5"),
        t("pricing.plans.crimeBoss.features.f6"),
      ],
    },
    {
      stars: 6,
      name: t("pricing.plans.kingpin.name"),
      price: 799,
      period: t("pricing.planCard.perMonth"),
      bestFor: t("pricing.plans.kingpin.bestFor"),
      credits: t("pricing.plans.kingpin.credits"),
      featured: false,
      badge: t("pricing.plans.kingpin.badge"),
      cta: t("pricing.plans.kingpin.cta"),
      features: [
        t("pricing.plans.kingpin.features.f1"),
        t("pricing.plans.kingpin.features.f2"),
        t("pricing.plans.kingpin.features.f3"),
        t("pricing.plans.kingpin.features.f4"),
        t("pricing.plans.kingpin.features.f5"),
        t("pricing.plans.kingpin.features.f6"),
      ],
    },
  ];

  const CREDIT_PACKS: CreditPack[] = [
    { credits: t("pricing.creditPacks.packs.10.credits"),  price: t("pricing.creditPacks.packs.10.price"),  packKey: "10"  },
    { credits: t("pricing.creditPacks.packs.50.credits"),  price: t("pricing.creditPacks.packs.50.price"),  packKey: "50"  },
    { credits: t("pricing.creditPacks.packs.150.credits"), price: t("pricing.creditPacks.packs.150.price"), packKey: "150" },
    { credits: t("pricing.creditPacks.packs.500.credits"), price: t("pricing.creditPacks.packs.500.price"), packKey: "500" },
  ];

  const FAQ = [
    { q: t("pricing.faq.q1"), a: t("pricing.faq.a1") },
    { q: t("pricing.faq.q2"), a: t("pricing.faq.a2") },
    { q: t("pricing.faq.q3"), a: t("pricing.faq.a3") },
    { q: t("pricing.faq.q4"), a: t("pricing.faq.a4") },
    { q: t("pricing.faq.q5"), a: t("pricing.faq.a5") },
    { q: t("pricing.faq.q6"), a: t("pricing.faq.a6") },
  ];

  const PRICING_JSON_LD = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Bow Down Visuals",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    description: t("pricing.jsonLd.description"),
    offers: {
      "@type": "OfferCatalog",
      name: t("pricing.jsonLd.offerCatalogName"),
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
    <div className="min-h-screen text-white lux-page">
      <JsonLd data={PRICING_JSON_LD} />
      <JsonLd data={PRICING_FAQ_JSON_LD} />

      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-60px] left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-yellow-600/10 rounded-full blur-[130px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-yellow-900/6 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto my-6 md:my-10 content-panel p-4 md:p-8">

        {/* ── PAYMENT CANCELLED BANNER ── */}
        {showCancelled && (
          <div className="border-b border-yellow-500/20 bg-yellow-500/[0.06]">
            <div className="max-w-6xl mx-auto px-5 md:px-8 py-3 flex items-center justify-center gap-3">
              <AlertCircle className="h-4 w-4 text-yellow-400 shrink-0" />
              <span className="text-sm text-yellow-200/80">
                {t("pricing.cancelledBanner.text")}
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
              <span className="text-sm font-bold text-primary">{t("pricing.betaNotice.label")}</span>
            </div>
            <span className="text-sm text-white/55">
              {t("pricing.betaNotice.text")}{" "}
              <Link href="/beta-access" className="text-primary font-semibold hover:underline">
                {t("pricing.betaNotice.cta")}
              </Link>
            </span>
          </div>
        </div>

        {/* ── HERO ── */}
        <section className="max-w-3xl mx-auto px-5 md:px-8 pt-16 pb-12 text-center">
          <MarketingBadge variant="kicker" className="mb-5 px-4 py-1.5">
            {t("pricing.hero.kicker")}
          </MarketingBadge>
          <div className="mx-auto mb-6 h-28 w-28 overflow-hidden rounded-full border-2 border-[#C9A84C] bg-black shadow-[0_0_32px_rgba(201,168,76,0.3)]">
            <video
              src={mediaUrl("thy-cheat-code-levelup-8bit.mp4")}
              autoPlay
              muted
              loop
              playsInline
              aria-label={t("pricing.hero.videoAriaLabel")}
              className="h-full w-full object-cover"
            />
          </div>
          <h1 className="text-5xl md:text-6xl font-black text-white tracking-tight mb-5 leading-[0.92]">
            {t("pricing.hero.titleLine1")}<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-primary to-yellow-300">
              {t("pricing.hero.titleLine2")}
            </span>
          </h1>
          <p className="text-white/50 text-xl max-w-2xl mx-auto leading-relaxed">
            {t("pricing.hero.subtitle")}
          </p>
          <p className="text-white/35 text-sm max-w-xl mx-auto mt-3">
            {t("pricing.hero.disclaimer")}
          </p>
          <WantedMeter onSelect={jumpToPlan} plans={PLANS} />
        </section>

        {/* ── PLANS ── */}
        <section className="max-w-7xl mx-auto px-5 md:px-8 pb-32">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 gap-y-10 lux-stagger pt-8">
            {PLANS.map((plan) => {
              const isExclusive = plan.name === "Crime Boss" || plan.name === "Kingpin";
              const isHighlighted = highlightedPlan === plan.stars;
              return (
              <div
                key={plan.name}
                ref={(el) => { planRefs.current[plan.stars - 1] = el; }}
                className={`relative rounded-2xl border flex flex-col p-6 transition-all duration-300 ${
                  isHighlighted
                    ? "border-amber-300 bg-amber-400/[0.08] shadow-[0_0_60px_rgba(251,191,36,0.35)] -translate-y-1"
                    : plan.name === "Kingpin"
                    ? "lux-shine border-amber-400/50 bg-gradient-to-b from-[#1a1408] via-[#0d0b06] to-black shadow-[0_0_80px_rgba(251,191,36,0.2)] hover:-translate-y-1"
                    : plan.name === "Crime Boss"
                    ? "border-purple-400/40 bg-gradient-to-b from-[#14101d] via-[#0b0912] to-black shadow-[0_0_60px_rgba(192,132,252,0.15)] hover:-translate-y-1"
                    : plan.featured
                    ? "lux-shine border-primary/45 bg-gradient-to-b from-[#171207] via-[#0d0b05] to-black shadow-[0_0_60px_rgba(218,165,32,0.15)] hover:-translate-y-1"
                    : "lux-card"
                }`}
              >
                {/* Badge */}
                {plan.badge && (
                  <div className="absolute -top-4 left-0 right-0 z-10 flex justify-center">
                    <MarketingBadge variant={isExclusive ? "exclusive" : "popular"}>
                      <Sparkles className="h-2.5 w-2.5" /> {plan.badge}
                    </MarketingBadge>
                  </div>
                )}

                {/* Plan header */}
                <div className="mb-5 mt-1">
                  {/* Wanted stars */}
                  <div className="flex items-center gap-1 mb-3" aria-label={t("pricing.planCard.wantedStarsAria", { stars: plan.stars })}>
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
                  <h2 className="text-lg font-bold text-primary mb-0.5">
                    {plan.name}
                  </h2>
                  <p className="text-xs text-white/35 font-medium mb-4">{t("pricing.planCard.bestFor", { bestFor: plan.bestFor })}</p>

                  <div className="flex items-baseline gap-1 mb-2">
                    <span className="text-4xl font-black text-white">${plan.price}</span>
                    <span className="text-white/35">{plan.period}</span>
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
            {t("pricing.plans.comingSoonNote")}
          </p>
        </section>

        {/* ── TEST CREDIT PACKS ── */}
        <section id="credit-packs" className="scroll-mt-20 max-w-4xl mx-auto px-5 md:px-8 py-20 md:py-28 border-t border-white/[0.05]">
          <div className="text-center mb-6">
            <h2 className="text-2xl md:text-3xl font-semibold text-white tracking-tight mb-3">{t("pricing.creditPacks.title")}</h2>
            <p className="text-white/40 text-lg">{t("pricing.creditPacks.subtitle")}</p>
          </div>

          {/* Test mode notice */}
          <div className="flex items-center justify-center gap-2 mb-8 px-4 py-3 rounded-xl border border-yellow-500/20 bg-yellow-500/[0.06] max-w-lg mx-auto">
            <AlertCircle className="h-4 w-4 text-yellow-400 shrink-0" />
            <span className="text-sm text-yellow-200/70">
              {t("pricing.creditPacks.testModeLead")} <strong className="text-yellow-300">{t("pricing.creditPacks.testModeStrong")}</strong>{t("pricing.creditPacks.testModeTail")}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {CREDIT_PACKS.map((pack) => (
              <CreditPackCard key={pack.packKey} pack={pack} />
            ))}
          </div>

          <p className="text-center text-xs text-white/25 font-medium mt-5 flex items-center justify-center gap-1.5">
            <Lock className="h-3 w-3" />
            {t("pricing.creditPacks.signInNote")}
          </p>
        </section>

        {/* ── FAQ ── */}
        <section className="max-w-3xl mx-auto px-5 md:px-8 py-20 md:py-28 border-t border-white/[0.05]">
          <div className="flex items-center gap-3 mb-8 justify-center">
            <HelpCircle className="h-5 w-5 text-primary" />
            <h2 className="text-2xl md:text-3xl font-semibold text-white tracking-tight">{t("pricing.faq.title")}</h2>
          </div>
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-6 md:px-8">
            {FAQ.map((item) => <FaqItem key={item.q} q={item.q} a={item.a} />)}
          </div>
        </section>

        {/* ── BOTTOM CTA ── */}
        <section className="max-w-3xl mx-auto px-5 md:px-8 py-20 md:py-28 text-center border-t border-white/[0.05]">
          <h2 className="text-3xl font-semibold text-white tracking-tight mb-4">{t("pricing.bottomCta.title")}</h2>
          <p className="text-white/45 text-lg mb-8">
            {t("pricing.bottomCta.text")}
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link href="/beta-access">
              <Button size="lg" className="gold-glow font-bold px-10 h-12 gap-2">
                <Sparkles className="h-4 w-4" /> {t("pricing.bottomCta.joinBeta")}
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button size="lg" variant="outline" className="border-white/10 text-white/60 hover:text-white h-12 px-8 gap-2">
                <Zap className="h-4 w-4" /> {t("pricing.bottomCta.tryTools")}
              </Button>
            </Link>
          </div>
        </section>

      </div>
    </div>
  );
}
