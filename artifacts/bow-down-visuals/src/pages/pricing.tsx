import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { MarketingBadge } from "@/components/MarketingBadge";
import {
  Check, Zap, HelpCircle, ChevronDown, ArrowRight,
  Sparkles, AlertCircle, CreditCard, Lock, Loader2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ExpressPayButton } from "@/components/ExpressPayButton";
import { JsonLd, buildFaqJsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { PricingSwitcher } from "@/components/PricingSwitcher";
import { mediaUrl } from "@/lib/media-cdn";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { SocialProofBand } from "@/components/SocialProofBand";
import {
  CREATOR_PLANS,
  CREDIT_PACKS,
  PRICING_TEST_MODE_NOTE,
  type CreditPack,
} from "@/lib/pricing-plans";

/* ─── Pricing — payfix pricing-truth ──────────────────────────────────────
   This page and /creator-pricing render the SAME plans from the ONE
   shared source (@/lib/pricing-plans): Free $0 / Pro $12/mo / Elite
   $29/mo, flat 5% platform fee on every tier. The old fake 6-plan ladder
   ($19–$799 rank-named plans that sent every button to the beta list
   under a "Billing is not live yet" note) is gone — plan checkout is
   purchasable in test mode and lives on /creator-pricing, which is
   where these cards send buyers. Credit packs below check out here. */

/* ─── credit pack card ─── */

function CreditPackCard({ pack }: { pack: CreditPack }) {
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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
        <p className="text-lg font-black text-white leading-tight tracking-tight">{pack.creditsLabel}</p>
        <p className="text-2xl font-black text-primary mt-1 tracking-tight">{pack.priceLabel}</p>
      </div>
      {errorMsg && (
        <p className="text-[11px] text-red-400 leading-snug text-center px-1">{errorMsg}</p>
      )}
      {successMsg && (
        <p className="text-[11px] text-green-400 leading-snug text-center px-1">{successMsg}</p>
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
      {user && (
        <div className="w-full">
          <div className="flex items-center gap-3 my-1">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[10px] uppercase tracking-widest text-white/30">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>
          <ExpressPayButton
            packKey={pack.packKey}
            onSuccess={(result) => {
              setSuccessMsg(
                `+${result.added.toLocaleString()} Visual Bucs added!`
              );
            }}
            onError={(msg) => setErrorMsg(msg)}
          />
        </div>
      )}
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

/* Truthful FAQ — the same answers /creator-pricing gives. */
const FAQ = [
  {
    q: "Can I really earn on Free?",
    a: "Yes. Free sells with the same flat 5% platform fee as every tier and your full earnings dashboard is always visible. Paid tiers add features — your own domain, unlimited products, pro analytics and more AI promotion boosts.",
  },
  {
    q: "Do paid tiers lower my platform fee?",
    a: "No — the platform fee is a flat 5% on every tier, Free included. Paid tiers pay for themselves with their features, not a lower fee.",
  },
  {
    q: "Are payments live yet?",
    a: "Checkout is open in test mode: you can subscribe to Pro or Elite and buy Visual Buc packs today, and no real money is charged. Real payments turn on at launch.",
  },
  {
    q: "What if I cancel?",
    a: "You keep your tier until the end of the billing period, then glide back to Free. No lock-in, no penalty, manage it yourself from the billing portal.",
  },
  {
    q: "Is this Visual Bucs?",
    a: "Plans are real USD subscriptions via Stripe (test mode). Visual Bucs are the separate AI-credit system — the packs below top them up, and the two never mix.",
  },
  {
    q: "What are Visual Bucs?",
    a: "Visual Bucs are used each time you run an AI generation — making a song, generating a video plan, creating promo clips, or producing music video clips. Each action draws from your Visual Bucs balance, and you see the cost before you create.",
  },
];

/* ─── page ─── */

export default function Pricing() {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  usePageTitle(t("pricing.pageTitle"), t("pricing.pageDescription"));

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
      itemListElement: CREATOR_PLANS.map((plan) => ({
        "@type": "Offer",
        name: plan.name,
        price: String(plan.priceUsdPerMonth),
        priceCurrency: "USD",
        description: plan.features.map((f) => f.label).join(", "),
        category: plan.tagline,
      })),
    },
  };

  const PRICING_FAQ_JSON_LD = buildFaqJsonLd(FAQ.map((f) => ({ q: f.q, a: f.a })));

  const [showCancelled, setShowCancelled] = useState(false);

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

        {/* ── TEST MODE NOTICE — true today: checkout works, no real money ── */}
        <div className="border-b border-primary/20 bg-primary/[0.06]">
          <div className="max-w-6xl mx-auto px-5 md:px-8 py-3 flex flex-col sm:flex-row items-center justify-center gap-2 text-center sm:text-left">
            <div className="flex items-center gap-2 shrink-0">
              <AlertCircle className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-bold text-primary">Test mode:</span>
            </div>
            <span className="text-sm text-white/55">
              {PRICING_TEST_MODE_NOTE}{" "}
              <Link href="/creator-pricing" className="text-primary font-semibold hover:underline">
                See the Creator Plans →
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
              src={mediaUrl(isLight ? "thy-cheat-code-levelup-8bit-light.mp4" : "thy-cheat-code-levelup-8bit.mp4")}
              autoPlay
              muted
              loop
              playsInline
              aria-label={t("pricing.hero.videoAriaLabel")}
              className="h-full w-full object-cover"
            />
          </div>
          <h1 className="text-5xl md:text-6xl font-black text-white tracking-tight mb-5 leading-[0.92]">
            Plans &amp;<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#E3C566] via-primary to-[#F0D98C]">
              Visual Bucs
            </span>
          </h1>
          <p className="text-white/50 text-xl max-w-2xl mx-auto leading-relaxed">
            Three creator plans — Free, Pro and Elite — every one at the same flat 5% platform fee.
            Paid tiers add your own domain, unlimited products, pro analytics and AI promotion boosts.
          </p>
          <p className="text-white/35 text-sm max-w-xl mx-auto mt-3">
            {t("pricing.hero.disclaimer")}
          </p>
        </section>

        {/* The two pricing products cross-link — Creator Plans here AND on
            /creator-pricing (same shared source), Credit Packs below. */}
        <div className="flex justify-center px-5 pb-4">
          <PricingSwitcher active="plans" />
        </div>

        {/* ── LIVE SOCIAL PROOF ── */}
        <SocialProofBand variant="compact" className={isLight ? "border-y border-primary/20 bg-[#C9A84C]/[0.08]" : "border-y border-primary/10 bg-black/40"} />

        {/* ── PLANS — the same CREATOR_PLANS /creator-pricing renders ── */}
        <section className="max-w-7xl mx-auto px-5 md:px-8 pb-32">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 gap-y-10 lux-stagger pt-8">
            {CREATOR_PLANS.map((plan) => {
              const featured = plan.tier === "pro";
              return (
                <div key={plan.tier} className="relative transition-all duration-300 hover:-translate-y-1">
                  {featured && (
                    <div className="absolute -top-4 left-0 right-0 z-20 flex justify-center pointer-events-none">
                      <MarketingBadge variant="popular">
                        <Sparkles className="h-2.5 w-2.5" /> Most creators pick this
                      </MarketingBadge>
                    </div>
                  )}
                  <div
                    className={`relative rounded-2xl border flex flex-col p-6 h-full ${
                      featured
                        ? isLight
                          ? "lux-shine border-primary/50 bg-gradient-to-b from-[#FCF6E0] via-[#F9EFC9] to-[#F3E3B2] shadow-[0_24px_60px_-24px_rgba(168,135,31,0.4)]"
                          : "lux-shine border-primary/45 bg-gradient-to-b from-[#171207] via-[#0d0b05] to-black shadow-[0_0_60px_rgba(218,165,32,0.15)]"
                        : "lux-card"
                    }`}
                  >
                    <div className="mb-5 mt-1">
                      <h2 className={`text-lg font-bold mb-0.5 ${isLight ? "text-[#7A5A12]" : "text-primary"}`}>
                        {plan.name}
                      </h2>
                      <p className={`text-xs font-medium mb-4 ${isLight ? "text-[#8A7A56]" : "text-white/35"}`}>{plan.tagline}</p>

                      <div className="flex items-baseline gap-1 mb-2">
                        <span className={`text-4xl font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`}>${plan.priceUsdPerMonth}</span>
                        <span className={isLight ? "text-[#8A7A56]" : "text-white/35"}>/month</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Zap className={`h-3 w-3 ${isLight ? "text-[#7A5A12]" : "text-primary"}`} />
                        <span className={`text-xs font-bold ${isLight ? "text-[#7A5A12]" : "text-primary"}`}>
                          {plan.feePct} platform fee on every sale
                        </span>
                      </div>
                    </div>

                    {/* CTA — plan checkout lives on /creator-pricing (test mode) */}
                    {plan.tier === "free" ? (
                      <Link href="/dashboard" className="mb-6">
                        <Button className="w-full font-bold h-10 gap-2" variant="outline">
                          <Sparkles className="h-3.5 w-3.5" /> Start free
                        </Button>
                      </Link>
                    ) : (
                      <Link href="/creator-pricing" className="mb-6">
                        <Button
                          className={`w-full font-bold h-10 gap-2 ${featured ? "gold-glow" : ""}`}
                          variant={featured ? "luxury" : "outline"}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          Go {plan.name} — ${plan.priceUsdPerMonth}/mo
                          {featured && <ArrowRight className="h-3.5 w-3.5" />}
                        </Button>
                      </Link>
                    )}

                    {/* Features — identical claims to /creator-pricing */}
                    <div className="space-y-2.5 flex-1">
                      {plan.features.map((f) => (
                        <div key={f.label} className="flex items-start gap-2.5">
                          <Check className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${isLight ? "text-[#A8871F]" : "text-primary"}`} />
                          <span className={`text-sm leading-snug ${isLight ? "text-[#4A3D24]" : "text-white/75"}`}>{f.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-center text-xs text-white/25 font-medium mt-6 flex items-center justify-center gap-1.5">
            <Lock className="h-3 w-3" />
            {PRICING_TEST_MODE_NOTE} Prices approved 2026-10-07.
          </p>
        </section>

        {/* ── VISUAL BUC PACKS ── */}
        <section id="credit-packs" className="scroll-mt-20 max-w-4xl mx-auto px-5 md:px-8 py-20 md:py-28 border-t border-white/[0.05]">
          <div className="text-center mb-6">
            <h2 className="text-2xl md:text-3xl font-semibold text-white tracking-tight mb-3">{t("pricing.creditPacks.title")}</h2>
            <p className="text-white/40 text-lg">{t("pricing.creditPacks.subtitle")}</p>
          </div>

          {/* Test mode notice */}
          <div className={`flex items-center justify-center gap-2 mb-8 px-4 py-3 rounded-xl border max-w-lg mx-auto ${isLight ? "border-amber-600/30 bg-amber-400/10" : "border-yellow-500/20 bg-yellow-500/[0.06]"}`}>
            <AlertCircle className={`h-4 w-4 shrink-0 ${isLight ? "text-amber-600" : "text-yellow-400"}`} />
            <span className={`text-sm ${isLight ? "text-amber-900/75" : "text-yellow-200/70"}`}>
              {t("pricing.creditPacks.testModeLead")} <strong className={isLight ? "text-amber-900" : "text-yellow-300"}>{t("pricing.creditPacks.testModeStrong")}</strong>{t("pricing.creditPacks.testModeTail")}
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
          <div className={`rounded-2xl border px-6 md:px-8 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
            {FAQ.map((item) => <FaqItem key={item.q} q={item.q} a={item.a} />)}
          </div>
        </section>

        {/* ── BOTTOM CTA ── */}
        <section className="max-w-3xl mx-auto px-5 md:px-8 py-20 md:py-28 text-center border-t border-white/[0.05]">
          <h2 className="text-3xl font-semibold text-white tracking-tight mb-4">Pick your plan.</h2>
          <p className="text-white/45 text-lg mb-8">
            Start free, go Pro or Elite when the features pay for themselves — checkout is open in test mode.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link href="/creator-pricing">
              <Button size="lg" className="gold-glow font-bold px-10 h-12 gap-2">
                <Sparkles className="h-4 w-4" /> See Creator Plans
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
