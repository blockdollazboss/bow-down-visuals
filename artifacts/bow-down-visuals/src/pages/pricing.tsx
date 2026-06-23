import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Check, Zap, HelpCircle, ChevronDown, ArrowRight,
  Sparkles, AlertCircle, CreditCard, Lock, Menu, X, Loader2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/* ─── nav ─── */

const NAV_LINKS = [
  { label: "Home",        href: "/" },
  { label: "Tools",       href: "/dashboard" },
  { label: "Beta Access", href: "/beta-access" },
];

function NavBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/90 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="cursor-pointer shrink-0">
          <img src={`${import.meta.env.BASE_URL}logo-static.png`} alt="Bow Down Visuals" className="h-14 w-auto" />
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-white/45 hover:text-white hover:bg-white/[0.04] transition-colors">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/beta-access">
            <Button size="sm" className="gold-glow hidden sm:flex gap-2 font-semibold">
              <Sparkles className="h-3.5 w-3.5" /> Join Beta
            </Button>
          </Link>
          <button onClick={() => setMenuOpen(!menuOpen)} className="flex md:hidden items-center justify-center h-8 w-8 text-white/60 hover:text-white">
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="md:hidden border-t border-white/[0.06] bg-black/95 px-5 py-4 space-y-1">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setMenuOpen(false)}
              className="flex items-center px-3 py-2.5 rounded-xl text-sm font-medium text-white/50 hover:text-white hover:bg-white/[0.04] transition-colors">
              {l.label}
            </Link>
          ))}
          <div className="pt-2">
            <Link href="/beta-access"><Button className="gold-glow w-full gap-2 mt-1"><Sparkles className="h-3.5 w-3.5" /> Join Beta</Button></Link>
          </div>
        </div>
      )}
    </header>
  );
}

/* ─── data ─── */

const PLANS = [
  {
    name: "Starter",
    price: 19,
    period: "/month",
    bestFor: "New creators",
    credits: "25 credits monthly",
    featured: false,
    badge: null,
    features: [
      "25 credits monthly",
      "Make songs",
      "Make music video plans",
      "Promo clip packs",
      "Thumbnail prompts",
      "Save projects",
    ],
  },
  {
    name: "Creator",
    price: 49,
    period: "/month",
    bestFor: "Active artists",
    credits: "100 credits monthly",
    featured: true,
    badge: "Most Popular",
    features: [
      "100 credits monthly",
      "Everything in Starter",
      "Runway video clip generation",
      "Artist Profiles",
      "Music Mixer beta",
      "Video Editor beta",
      "Download TXT / PDF",
    ],
  },
  {
    name: "Pro Artist",
    price: 99,
    period: "/month",
    bestFor: "Serious music creators",
    credits: "250 credits monthly",
    featured: false,
    badge: null,
    features: [
      "250 credits monthly",
      "Everything in Creator",
      "More video clip generations",
      "Advanced promo packs",
      "Music Studio tools",
      "Priority beta access",
    ],
  },
  {
    name: "Studio",
    price: 199,
    period: "/month",
    bestFor: "Teams and labels",
    credits: "600 credits monthly",
    featured: false,
    badge: null,
    features: [
      "600 credits monthly",
      "Everything in Pro Artist",
      "More saved projects",
      "Higher usage limits",
      "Team features coming soon",
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
    a: "Credits are used each time you run an AI generation — making a song, generating a video plan, creating promo clips, or producing Runway clips. Each action draws from your monthly credit balance.",
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
    q: "Do Runway clips cost credits?",
    a: "Yes — Runway video clip generation is a premium action and uses more credits than standard text generation. The exact cost per clip will be confirmed at launch.",
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
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 flex flex-col items-center text-center gap-4">
      <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center">
        <CreditCard className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className="text-lg font-black text-white leading-tight">{pack.credits}</p>
        <p className="text-2xl font-black text-primary mt-1">{pack.price}</p>
      </div>
      {errorMsg && (
        <p className="text-[11px] text-red-400 leading-snug text-center px-1">{errorMsg}</p>
      )}
      <Button
        size="sm"
        onClick={handleBuy}
        disabled={loading}
        className="w-full font-bold gap-2 bg-white/[0.06] border border-white/[0.12] text-white hover:bg-white/[0.12] hover:border-primary/40 hover:text-primary transition-all"
        variant="outline"
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

/* ─── page ─── */

export default function Pricing() {
  return (
    <div className="min-h-screen bg-black text-white">
      <NavBar />

      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-60px] left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-yellow-600/10 rounded-full blur-[130px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-yellow-900/6 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10">

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
          <Badge className="mb-5 bg-primary/10 text-primary border-primary/25 text-xs font-bold tracking-widest px-4 py-1.5">
            Pricing
          </Badge>
          <h1 className="text-5xl md:text-6xl font-black text-white tracking-tight mb-5 leading-[0.92]">
            Choose Your<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-primary to-yellow-300">
              Creator Plan
            </span>
          </h1>
          <p className="text-white/50 text-xl max-w-2xl mx-auto leading-relaxed">
            Start with AI songs, video plans, promo clips, artist profiles, and editing tools. Full paid access is coming soon.
          </p>
        </section>

        {/* ── PLANS ── */}
        <section className="max-w-7xl mx-auto px-5 md:px-8 pb-20">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl border flex flex-col p-6 transition-all ${
                  plan.featured
                    ? "border-primary/45 bg-gradient-to-b from-primary/[0.09] to-primary/[0.03] shadow-[0_0_60px_rgba(218,165,32,0.15)]"
                    : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.14]"
                }`}
              >
                {/* Badge */}
                {plan.badge && (
                  <div className="absolute -top-3 left-0 right-0 flex justify-center">
                    <span className="inline-flex items-center gap-1 bg-primary text-white text-[10px] font-black tracking-widest uppercase px-3 py-1 rounded-full shadow-lg">
                      <Sparkles className="h-2.5 w-2.5" /> {plan.badge}
                    </span>
                  </div>
                )}

                {/* Plan header */}
                <div className="mb-5 mt-1">
                  <h2 className="text-lg font-black text-white mb-0.5">{plan.name}</h2>
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
                        : "border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] text-white hover:border-white/20"
                    }`}
                    variant={plan.featured ? "default" : "outline"}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Join Beta
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
            ))}
          </div>

          {/* Coming soon note */}
          <p className="text-center text-xs text-white/25 font-medium mt-6 flex items-center justify-center gap-1.5">
            <Lock className="h-3 w-3" />
            Billing is not live yet. All plan buttons join the beta list.
          </p>
        </section>

        {/* ── TEST CREDIT PACKS ── */}
        <section className="max-w-4xl mx-auto px-5 md:px-8 py-16 border-t border-white/[0.05]">
          <div className="text-center mb-6">
            <h2 className="text-3xl md:text-4xl font-black text-white mb-3">Test Credit Packs</h2>
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
        <section className="max-w-3xl mx-auto px-5 md:px-8 py-16 border-t border-white/[0.05]">
          <div className="flex items-center gap-3 mb-8 justify-center">
            <HelpCircle className="h-5 w-5 text-primary" />
            <h2 className="text-3xl md:text-4xl font-black text-white">Frequently Asked Questions</h2>
          </div>
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-6 md:px-8">
            {FAQ.map((item) => <FaqItem key={item.q} q={item.q} a={item.a} />)}
          </div>
        </section>

        {/* ── BOTTOM CTA ── */}
        <section className="max-w-3xl mx-auto px-5 md:px-8 py-16 text-center border-t border-white/[0.05]">
          <h2 className="text-4xl font-black text-white mb-4">Get in early.</h2>
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
