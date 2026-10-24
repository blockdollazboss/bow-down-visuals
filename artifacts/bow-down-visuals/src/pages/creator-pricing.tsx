import { useEffect, useMemo, useState } from "react";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { Link, useSearch } from "wouter";
import {
  Check, Crown, Loader2, ArrowLeft, ArrowRight, Sparkles,
  BadgeCheck, Info, Star,
} from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { PricingSwitcher } from "@/components/PricingSwitcher";
import { useAuth } from "@/contexts/AuthContext";
import TierBadge from "@/components/TierBadge";
import { SocialProofBand } from "@/components/SocialProofBand";
import { loginPathWithNext } from "@/lib/auth-next";

/* ─── Creator pricing — Worker 12 ──────────────────────────────────────────
   The tier upgrade page. Sells the MONEY MATH, not vibes: every tier
     pays the same flat 5% platform fee (the checkout rails' truth);
     paid tiers sell their features — domain, products, analytics, boosts.
   Real USD only — Visual Bucs copy never appears here.

   Link-graph (both ways, never a dead end):
     - ?returnTo=… is THIS page's own param: checkout success/cancel links
       BACK to what the creator was doing, and a "← Back" link is always
       visible. /login does NOT read it — the signed-out checkout bounce
       rides the shared ?next= contract (loginPathWithNext) carrying this
       page and its returnTo, so sign-in lands back here, context intact.
     - Every feature row links to its feature details (detailsUrl).
     - TierBadge / MoneyWidgets / UpgradeNudge all link HERE.             */

interface PlanFeature { label: string; detailsUrl: string }
interface Plan {
  tier: "free" | "pro" | "elite";
  name: string;
  tagline: string;
  priceUsdPerMonth: number | null;
  priceConfigured: boolean;
  feeBps: number;
  feePct: string;
  aiBoostsPerMonth: number;
  features: PlanFeature[];
  breakEvenSalesUsd: number | null;
  savingsAt1kUsd: number;
}

const STAR_RANKS = ["Street Punk", "Hustler", "Gangster", "Shot Caller", "Crime Boss", "Kingpin"];
const STAR_BLURBS = [
  "Turbo. Just create.",
  "AI runs it, you approve.",
  "AI + your tweaks.",
  "Your call, AI assists.",
  "Pro controls unlocked.",
  "Every knob, every setting.",
];

function useQuery() {
  const search = useSearch();
  return useMemo(() => new URLSearchParams(search.startsWith("?") ? search : `?${search}`), [search]);
}

export default function CreatorPricing() {
  const isLight = useIsLightTheme();
  usePageTitle("Creator Plans — Go Pro, Keep More of Your Money", "Creator plans for every level: compare ranks, Visual Buc rates, automation and control — go pro and keep more of your money.");
  const query = useQuery();
  const { user, getAccessToken } = useAuth();
  const returnTo = query.get("returnTo") && query.get("returnTo")!.startsWith("/") ? query.get("returnTo")! : "/dashboard";
  const upgrade = query.get("upgrade");
  const upgradeTier = query.get("tier");

  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(1000); // monthly sales USD for the calculator

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/creator-tiers/plans");
        if (res.ok) {
          const data = await res.json();
          setPlans(data.plans ?? []);
        }
      } catch { /* page shows fallback copy */ } finally { setLoading(false); }
    })();
  }, []);

  async function checkout(tier: "pro" | "elite" | "free") {
    if (tier === "free") return; // free tier has no checkout
    const paidTier: "pro" | "elite" = tier;
    if (!user) {
      window.location.href = loginPathWithNext("/creator-pricing", `returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    setBuying(paidTier);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/creator-tiers/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ tier: paidTier, returnTo }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error ?? "Checkout didn't start. Try again in a minute.");
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBuying(null);
    }
  }

  // Extra kept vs the Free tier's fee. Every tier pays the same flat 5%
  // platform fee (Stack-28 #4), so this is $0 for all tiers — the figure
  // is computed from the server-sent feeBps, never a hardcoded ladder.
  const freeFeeBps = plans.find((pl) => pl.tier === "free")?.feeBps ?? 500;
  const savings = (plan: Plan) => Math.round(volume * ((freeFeeBps - plan.feeBps) / 10_000) * 100) / 100;

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-10">
        {/* back link — a gate is never a dead end */}
        <Link href={returnTo} className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to what I was doing
        </Link>

        {/* upgrade result banners */}
        {upgrade === "success" && (
          <div className="mt-6 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-5">
            <div className="flex items-center gap-2 font-black text-emerald-200">
              <BadgeCheck className="h-5 w-5" /> You're {upgradeTier === "elite" ? "Elite" : "Pro"} now. Let's get this money. 🎉
            </div>
            <p className="mt-1 text-sm text-white/60">
              Your plan applies to every sale from here on — the platform fee stays a flat 5% on every tier. Receipts always show gross → fee → net.
            </p>
            <Link
              href={returnTo}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-amber-200 to-amber-500 px-5 py-2 text-sm font-black text-black hover:brightness-110"
            >
              Back to what I was doing <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
        {upgrade === "cancelled" && (
          <div className={`mt-6 rounded-2xl border p-5 text-sm ${isLight ? "border-[#C9A84C]/40 bg-[#F7ECD2]/80 text-[#6B5B36]" : "border-white/15 bg-gradient-to-b from-[#14100a] to-[#0d0a04] text-white/60"}`}>
            Checkout cancelled — no charge, nothing changed. Your Free tier keeps earning at the standard fee.
            <Link href={returnTo} className={`ml-2 font-bold ${isLight ? "text-[#7A5A12] hover:text-[#2A1E07]" : "text-amber-300 hover:text-amber-200"}`}>
              Back to creating →
            </Link>
          </div>
        )}

        {/* hero */}
        <div className="mt-8 text-center">
          <div className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-bold uppercase tracking-widest ${isLight ? "border-[#C9A84C]/50 bg-[#C9A84C]/10 text-[#7A5A12]" : "border-amber-400/30 bg-amber-400/10 text-amber-300"}`}>
            <Crown className="h-3.5 w-3.5" /> Creator plans
          </div>
          <h1 className="mt-5 text-4xl font-black tracking-tight sm:text-6xl">
            Go pro. <span className={isLight ? "bg-gradient-to-b from-[#A97F1F] to-[#7A5A12] bg-clip-text text-transparent" : "bg-gradient-to-b from-amber-200 to-amber-500 bg-clip-text text-transparent"}>Keep more of your money.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-white/55">
            Free earns from day one at the same flat 5% platform fee every tier pays. Paid tiers add
            your own domain, unlimited products, pro analytics and AI promotion boosts.
          </p>
          <div className="mt-4 flex justify-center"><TierBadge /></div>
        </div>

        {/* Phase 3: cross-link to the other pricing product (credit packs). */}
        <div className="mt-8 flex justify-center">
          <PricingSwitcher active="plans" />
        </div>

        {/* Live social proof — real platform numbers, musicians flavor */}
        <SocialProofBand vertical="music" className="mt-10 rounded-3xl" />

        {/* money math — the cheat code, spelled out */}
        <section id="money-math" className={`mt-12 rounded-3xl border p-6 sm:p-8 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-br from-[#C9A84C]/[0.10] via-[#FBF6E9] to-[#F4E7C3] text-[#2A1E07]" : "border-amber-400/25 bg-gradient-to-br from-amber-400/10 via-black to-black"}`}>
          <h2 className="text-2xl font-black">
            <Sparkles className={`mr-2 inline h-5 w-5 ${isLight ? "text-[#7A5A12]" : "text-amber-300"}`} />
            The money math
          </h2>
          <p className="mt-2 text-sm text-white/55">
            Pick your monthly sales. Every tier — Free, Pro and Elite — pays the same
            <strong className="text-white"> flat 5% platform fee</strong> on every sale. Paid tiers earn their keep with features, not a fee trick.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[250, 500, 1000, 2500].map((v) => (
              <button
                key={v}
                onClick={() => setVolume(v)}
                className={`rounded-full border px-4 py-1.5 text-sm font-bold transition ${
                  volume === v
                    ? isLight
                      ? "border-[#C9A84C] bg-[#C9A84C]/25 text-[#7A5A12]"
                      : "border-amber-300 bg-amber-400/20 text-amber-200"
                    : isLight
                      ? "border-[#C9A84C]/35 text-[#6B5B36] hover:border-[#C9A84C]/60 hover:text-[#2A1E07]"
                      : "border-white/15 text-white/60 hover:border-white/35 hover:text-white"
                }`}
              >
                ${v.toLocaleString()}/mo
              </button>
            ))}
          </div>
          {loading ? (
            <div className="mt-6 flex items-center gap-2 text-white/50"><Loader2 className="h-5 w-5 animate-spin" /> Loading plans…</div>
          ) : plans.length === 0 ? (
            <p className={`mt-6 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
              The plan math is warming up — the tiers are below. Every tier keeps 95% of every sale: the platform fee is a flat 5% on Free, Pro and Elite alike.
            </p>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {plans.map((p) => (
                <div key={p.tier} className={`rounded-2xl border p-5 ${isLight ? "border-[#C9A84C]/35 bg-[#FBF6E9] text-[#2A1E07]" : "border-white/10 bg-black/40"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-black">{p.name}</span>
                    <span className={`text-xs font-bold ${isLight ? "text-[#7A5A12]" : "text-amber-300"}`}>{p.feePct} fee</span>
                  </div>
                  <div className={`mt-3 text-3xl font-black ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>
                    ${savings(p).toLocaleString()}
                    <span className="text-sm font-semibold text-white/40"> extra kept / mo</span>
                  </div>
                  {p.breakEvenSalesUsd != null && (
                    <div className="mt-2 flex items-start gap-1.5 text-xs text-white/50">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Pays for itself at ${p.breakEvenSalesUsd.toLocaleString()}/mo in sales.
                    </div>
                  )}
                  {p.tier === "free" && (
                    <div className="mt-2 text-xs text-white/50">The baseline. Every dollar above this line is the paid tiers working.</div>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="mt-4 text-xs text-white/35">
            Real USD via Stripe (test mode). Prices approved 2026-10-07 — Stripe stays in test mode until launch.
          </p>
        </section>

        {/* tier cards */}
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.tier}
              className={`flex flex-col rounded-3xl border p-6 ${
                p.tier === "pro"
                  ? isLight
                    ? "border-[#C9A84C]/70 bg-gradient-to-b from-[#C9A84C]/25 to-[#F4E7C3] text-[#2A1E07] shadow-[0_0_40px_rgba(201,168,76,0.25)]"
                    : "border-amber-400/60 bg-gradient-to-b from-amber-400/15 to-black shadow-[0_0_40px_rgba(251,191,36,0.15)]"
                  : isLight
                    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] text-[#2A1E07] shadow-[0_10px_30px_rgba(122,90,18,0.12)]"
                    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"
              }`}
            >
              {p.tier === "pro" && (
                <div className="mb-3 inline-flex w-fit items-center gap-1 rounded-full bg-amber-400 px-3 py-0.5 text-xs font-black uppercase tracking-wider text-black">
                  Most creators pick this
                </div>
              )}
              <h3 className="text-xl font-black">{p.name}</h3>
              <p className="mt-1 min-h-10 text-sm text-white/55">{p.tagline}</p>
              <div className="mt-4 flex items-end gap-1">
                {p.priceUsdPerMonth == null ? (
                  <span className="text-4xl font-black">$0</span>
                ) : (
                  <>
                    <span className="text-4xl font-black">${p.priceUsdPerMonth}</span>
                    <span className="pb-1 text-sm text-white/50">/month</span>
                  </>
                )}
              </div>
              <div className={`mt-1 text-sm font-bold ${isLight ? "text-[#7A5A12]" : "text-amber-300"}`}>{p.feePct} platform fee on every sale</div>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                {p.features.map((f) => (
                  <li key={f.label} className="flex items-start gap-2">
                    <Check className={`mt-0.5 h-4 w-4 shrink-0 ${isLight ? "text-emerald-700" : "text-emerald-300"}`} />
                    <span className="text-white/75">
                      {f.label}{" "}
                      <Link href={f.detailsUrl} className={`whitespace-nowrap text-xs font-semibold ${isLight ? "text-[#7A5A12] hover:text-[#2A1E07]" : "text-amber-300/90 hover:text-amber-200"}`}>
                        details →
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                {p.tier === "free" ? (
                  <Link
                    href="/dashboard"
                    className={`block rounded-full border py-2.5 text-center text-sm font-black transition ${isLight ? "border-[#C9A84C]/60 text-[#2A1E07] hover:border-[#C9A84C]" : "border-white/25 text-white hover:border-white/50"}`}
                  >
                    Start free
                  </Link>
                ) : (
                  <button
                    onClick={() => checkout(p.tier)}
                    disabled={buying != null || !p.priceConfigured}
                    className="w-full rounded-full bg-gradient-to-b from-amber-200 to-amber-500 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50"
                  >
                    {buying === p.tier ? (
                      <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Opening checkout…</span>
                    ) : p.priceConfigured ? (
                      `Go ${p.name} — $${p.priceUsdPerMonth}/mo`
                    ) : (
                      `${p.name} — price coming soon`
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {error && (
          <div className="mt-4 rounded-xl border border-red-400/40 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>
        )}

        {/* earned rank — stars come from work, never from a tier */}
        <section id="stars" className={`mt-12 rounded-3xl border p-6 sm:p-8 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] text-[#2A1E07] shadow-[0_10px_30px_rgba(122,90,18,0.12)]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
          <h2 className="text-2xl font-black">Stars are earned — never sold</h2>
          <p className="mt-2 max-w-2xl text-sm text-white/55">
            Creator Level is rank, and rank comes from your work: published tracks and videos,
            completed exports, followers, streams, tips, sales and paid memberships.{" "}
            <strong className="text-white">No plan raises your stars and no plan caps them</strong> — a Free
            creator can earn all six. Deeper controls unlock as you climb, and your earnings
            and payouts are never gated at any rank.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STAR_RANKS.map((rank, i) => {
              const stars = i + 1;
              const cost = ["Starting rank", "25 pts of work", "100 pts of work", "300 pts of work", "700 pts + first sales", "1,400 pts + a real business"][i];
              return (
                <div key={rank} className={`rounded-2xl border p-4 ${isLight ? "border-[#C9A84C]/35 bg-[#FBF6E9] text-[#2A1E07]" : "border-white/10 bg-black/40"}`}>
                  <div className="flex items-center gap-1" aria-label={`${stars} stars`}>
                    {Array.from({ length: 6 }).map((_, s) => (
                      <Star key={s} className={`h-4 w-4 ${s < stars ? "fill-amber-400 text-amber-400" : "text-white/15"}`} />
                    ))}
                  </div>
                  <div className="mt-2 font-black">{stars}★ {rank}</div>
                  <div className="text-sm text-white/50">{STAR_BLURBS[i]}</div>
                  <div className={`mt-2 inline-block rounded-full border px-2.5 py-0.5 text-xs font-black uppercase tracking-wider ${isLight ? "border-[#C9A84C]/40 text-[#6B5B36]" : "border-white/20 text-white/60"}`}>
                    {cost}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* feature detail anchors — link targets for "details →" rows */}
        <section className="mt-12 space-y-8 text-sm text-white/60">
          <div id="feature-site" className={`scroll-mt-24 rounded-2xl border p-5 ${isLight ? "border-[#C9A84C]/30 bg-[#FBF6E9]/70" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
            <h3 className="font-black text-white">Your site</h3>
            <p className="mt-1">Free gets you a subdomain on bowdownvisuals.com. Pro connects your own custom domain with verification — your brand, your URL, same checkout.</p>
          </div>
          <div id="feature-streaming" className={`scroll-mt-24 rounded-2xl border p-5 ${isLight ? "border-[#C9A84C]/30 bg-[#FBF6E9]/70" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
            <h3 className="font-black text-white">Streaming</h3>
            <p className="mt-1">Livestream to your fans on every tier. Tips and paid access split with the same honest fee as everything else.</p>
          </div>
          <div id="feature-themes" className={`scroll-mt-24 rounded-2xl border p-5 ${isLight ? "border-[#C9A84C]/30 bg-[#FBF6E9]/70" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
            <h3 className="font-black text-white">Themes</h3>
            <p className="mt-1">Basic themes are free forever. Premium gold-luxury themes are a Pro move — they make your site look like money because it is.</p>
          </div>
          <div id="feature-boosts" className={`scroll-mt-24 rounded-2xl border p-5 ${isLight ? "border-[#C9A84C]/30 bg-[#FBF6E9]/70" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
            <h3 className="font-black text-white">AI promotion boosts</h3>
            <p className="mt-1">AI-written promo pushes for your releases: 3/month free, 25 on Pro, 100 on Elite. More boosts, more ears, more sales.</p>
          </div>
          <div id="feature-discovery" className={`scroll-mt-24 rounded-2xl border p-5 ${isLight ? "border-[#C9A84C]/30 bg-[#FBF6E9]/70" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
            <h3 className="font-black text-white">Discovery priority</h3>
            <p className="mt-1">Elite creators get priority placement in discovery — first look for new fans scrolling the platform.</p>
          </div>
          <div id="feature-support" className={`scroll-mt-24 rounded-2xl border p-5 ${isLight ? "border-[#C9A84C]/30 bg-[#FBF6E9]/70" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
            <h3 className="font-black text-white">Elite support</h3>
            <p className="mt-1">Dedicated support badge on your profile and priority support when something breaks before a drop.</p>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto mt-12 max-w-3xl space-y-4">
          <h2 className="text-center text-2xl font-black">Quick answers</h2>
          {[
            ["Can I really earn on Free?", "Yes. Free sells with the same flat 5% platform fee as every tier and your full earnings dashboard is always visible. Paid tiers add features — your own domain, unlimited products, pro analytics and more AI promotion boosts."],
            ["Do paid tiers lower my platform fee?", "No — the platform fee is a flat 5% on every tier, Free included. Paid tiers pay for themselves with their features, not a lower fee."],
            ["What if I cancel?", "You keep your tier until the end of the billing period, then glide back to Free. No lock-in, no penalty, manage it yourself from the billing portal."],
            ["Is this Visual Bucs?", "No. Tiers are real USD subscriptions via Stripe (test mode). Visual Bucs are the separate AI-credit system — the two never mix."],
          ].map(([q, a]) => (
            <div key={q} className={`rounded-2xl border p-5 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
              <div className="font-black text-white">{q}</div>
              <div className="mt-1 text-sm text-white/55">{a}</div>
            </div>
          ))}
        </section>

        <div className="mt-12 text-center">
          <Link href={returnTo} className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Back to what I was doing
          </Link>
        </div>
      </main>
    </div>
  );
}
