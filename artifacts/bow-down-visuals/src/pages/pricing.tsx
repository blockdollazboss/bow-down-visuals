import { useState } from "react";
import { Link } from "wouter";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Zap, Music, Video, Film, Image as ImageIcon, Mic2, Archive, HelpCircle, ChevronDown, ArrowRight } from "lucide-react";

const NAV_LINKS = [
  { label: "Home",     href: "/" },
  { label: "Tools",    href: "/dashboard" },
  { label: "Waitlist", href: "/waitlist" },
];

function NavBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/90 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="cursor-pointer shrink-0">
          <AnimatedLogo className="h-14 w-auto" />
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-white/45 hover:text-white hover:bg-white/[0.04] transition-colors">{l.label}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button size="sm" className="gold-glow hidden sm:flex gap-2 font-semibold">
              <Zap className="h-3.5 w-3.5" /> Start Free
            </Button>
          </Link>
          <button onClick={() => setMenuOpen(!menuOpen)} className="flex md:hidden items-center justify-center h-8 w-8 rounded-lg text-white/60 hover:text-white transition-colors">
            <ChevronDown className={`h-5 w-5 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="md:hidden border-t border-white/[0.06] bg-black/95 px-5 py-4 space-y-1">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setMenuOpen(false)} className="flex items-center px-3 py-2.5 rounded-xl text-sm font-medium text-white/50 hover:text-white hover:bg-white/[0.04] transition-colors">{l.label}</Link>
          ))}
          <div className="pt-2">
            <Link href="/dashboard"><Button className="gold-glow w-full gap-2 mt-1">Start Free</Button></Link>
          </div>
        </div>
      )}
    </header>
  );
}

const PLANS = [
  {
    name: "Starter",
    price: 0,
    desc: "For independent artists just starting out.",
    credits: "50 credits / month",
    featured: false,
    cta: "Start Free",
    href: "/dashboard",
    features: [
      "50 credits per month",
      "Make a Song",
      "Make a Music Video",
      "Promo Clip Maker",
      "Artist Vault",
      "Watermarked outputs",
      "Community support",
    ],
    locked: ["Make Song + Video", "Thumbnail Maker", "Download exports", "Priority generation"],
  },
  {
    name: "Creator",
    price: 19,
    desc: "For active artists dropping consistently.",
    credits: "300 credits / month",
    featured: true,
    badge: "Most Popular",
    cta: "Start Creating",
    href: "/waitlist",
    features: [
      "300 credits per month",
      "All 6 tools unlocked",
      "No watermarks",
      "Priority generation",
      "Download all outputs",
      "Make Song + Video",
      "Thumbnail Maker",
    ],
    locked: ["Custom brand kit", "Team seats", "API access"],
  },
  {
    name: "Pro Studio",
    price: 49,
    desc: "For labels, managers, and power users.",
    credits: "Unlimited credits",
    featured: false,
    cta: "Go Pro",
    href: "/waitlist",
    features: [
      "Unlimited credits",
      "All Creator features",
      "Custom brand kit",
      "Team seats (up to 5)",
      "API access",
      "Dedicated support",
      "Early feature access",
    ],
    locked: [],
  },
];

const TOOLS_INCLUDED = [
  { name: "Make a Song",        icon: Music,     starter: true,  creator: true,  pro: true  },
  { name: "Make a Music Video", icon: Video,     starter: true,  creator: true,  pro: true  },
  { name: "Make Song + Video",  icon: Mic2,      starter: false, creator: true,  pro: true  },
  { name: "Promo Clip Maker",   icon: Film,      starter: true,  creator: true,  pro: true  },
  { name: "Thumbnail Maker",    icon: ImageIcon, starter: false, creator: true,  pro: true  },
  { name: "Artist Vault",       icon: Archive,   starter: true,  creator: true,  pro: true  },
];

const FAQ = [
  { q: "What are credits?", a: "Credits are used each time you generate content. Making a Song costs 1 credit, Make Song + Video costs 2 credits. Credits refresh monthly based on your plan. Unused credits don't roll over." },
  { q: "Can I cancel anytime?", a: "Yes. You can upgrade, downgrade, or cancel your subscription at any time from your account settings. There are no long-term contracts or cancellation fees." },
  { q: "What do I actually get from each generation?", a: "Every tool returns a complete package. Make a Song gives you the full lyrics, hook, verses, bridge, outro, AI music prompt, beat direction, and vocal style notes — not just a title idea." },
  { q: "Is my content private?", a: "Absolutely. We do not use your generated content, lyrics, or personal details to train AI models. Your projects belong to you. You own everything you create." },
  { q: "What's the difference between Starter and Creator?", a: "Starter gives you 3 of the 6 tools and watermarked output — great for testing. Creator unlocks all 6 tools, removes watermarks, and gives you 6× more credits with priority generation." },
  { q: "Do you offer refunds?", a: "We offer a 7-day money-back guarantee on your first month if you are not satisfied. Contact our support team within 7 days of your first payment." },
];

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

export default function Pricing() {
  return (
    <div className="min-h-screen bg-black text-white">
      <NavBar />
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-60px] left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-yellow-600/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10">

        {/* HERO */}
        <section className="max-w-3xl mx-auto px-5 md:px-8 pt-16 pb-12 text-center">
          <Badge className="mb-5 bg-primary/10 text-primary border-primary/25 text-xs font-bold tracking-widest px-4 py-1.5">Pricing</Badge>
          <h1 className="text-5xl md:text-6xl font-black text-white tracking-tight mb-4">
            Plans for every artist
          </h1>
          <p className="text-white/50 text-xl max-w-2xl mx-auto">
            Start free. Upgrade when you're ready to go all in. Cancel any time.
          </p>
        </section>

        {/* PLANS */}
        <section className="max-w-6xl mx-auto px-5 md:px-8 pb-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6 items-end">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl border p-6 md:p-8 flex flex-col relative ${
                  plan.featured
                    ? "border-primary/40 bg-primary/[0.04] shadow-[0_0_50px_rgba(124,58,237,0.15)] md:-translate-y-4"
                    : "border-white/[0.08] bg-white/[0.02]"
                }`}
              >
                {plan.badge && (
                  <div className="absolute top-0 inset-x-0 -translate-y-1/2 flex justify-center">
                    <span className="bg-primary text-white text-xs font-black px-4 py-1 rounded-full uppercase tracking-wider">
                      {plan.badge}
                    </span>
                  </div>
                )}
                <div className="mb-6">
                  <h2 className="text-xl font-black text-white mb-1">{plan.name}</h2>
                  <p className="text-sm text-white/40 mb-4">{plan.desc}</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-5xl font-black text-white">${plan.price}</span>
                    <span className="text-white/35 text-lg">/month</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Zap className="h-3.5 w-3.5 text-primary" />
                    <span className="text-sm font-semibold text-primary">{plan.credits}</span>
                  </div>
                </div>

                <Link href={plan.href} className="mb-6">
                  <Button className={`w-full font-bold h-11 ${plan.featured ? "gold-glow" : "border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] text-white"}`}
                    variant={plan.featured ? "default" : "outline"}>
                    {plan.cta} {plan.featured && <ArrowRight className="h-4 w-4 ml-1" />}
                  </Button>
                </Link>

                <div className="space-y-3 flex-1">
                  {plan.features.map((f) => (
                    <div key={f} className="flex items-center gap-3">
                      <Check className="h-4 w-4 text-primary shrink-0" />
                      <span className="text-sm text-white/80">{f}</span>
                    </div>
                  ))}
                  {plan.locked.map((f) => (
                    <div key={f} className="flex items-center gap-3 opacity-30">
                      <div className="h-4 w-4 rounded border border-white/20 shrink-0" />
                      <span className="text-sm text-white/50 line-through">{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* TOOLS COMPARISON */}
        <section className="max-w-4xl mx-auto px-5 md:px-8 py-16 border-t border-white/[0.05]">
          <h2 className="text-3xl md:text-4xl font-black text-white text-center mb-10">What's included in each plan</h2>
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
            <div className="grid grid-cols-4 gap-0 border-b border-white/[0.07] px-6 py-4">
              <div className="text-xs font-bold text-white/40 uppercase tracking-wider">Tool</div>
              {["Starter","Creator","Pro"].map((p) => (
                <div key={p} className="text-xs font-bold text-white/40 uppercase tracking-wider text-center">{p}</div>
              ))}
            </div>
            {TOOLS_INCLUDED.map((tool, i) => (
              <div key={tool.name} className={`grid grid-cols-4 gap-0 px-6 py-4 ${i !== TOOLS_INCLUDED.length - 1 ? "border-b border-white/[0.04]" : ""}`}>
                <div className="flex items-center gap-2.5">
                  <tool.icon className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm font-medium text-white">{tool.name}</span>
                </div>
                {([tool.starter, tool.creator, tool.pro] as boolean[]).map((included, j) => (
                  <div key={j} className="flex justify-center">
                    {included
                      ? <Check className="h-4 w-4 text-primary" />
                      : <div className="h-4 w-4 rounded border border-white/10" />}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="max-w-3xl mx-auto px-5 md:px-8 py-16 border-t border-white/[0.05]">
          <div className="flex items-center gap-3 mb-8 justify-center">
            <HelpCircle className="h-5 w-5 text-primary" />
            <h2 className="text-3xl md:text-4xl font-black text-white">Frequently asked questions</h2>
          </div>
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-6 md:px-8">
            {FAQ.map((item) => <FaqItem key={item.q} q={item.q} a={item.a} />)}
          </div>
        </section>

        {/* BOTTOM CTA */}
        <section className="max-w-3xl mx-auto px-5 md:px-8 py-16 text-center border-t border-white/[0.05]">
          <h2 className="text-4xl font-black text-white mb-4">Start building your sound today.</h2>
          <p className="text-white/45 text-lg mb-8">Free to start. No credit card required. Upgrade when you're ready.</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link href="/dashboard">
              <Button size="lg" className="gold-glow font-bold px-10 h-12 gap-2">
                <Zap className="h-4 w-4" /> Start Free
              </Button>
            </Link>
            <Link href="/waitlist">
              <Button size="lg" variant="outline" className="border-white/10 text-white/60 hover:text-white h-12 px-8">
                Join Waitlist
              </Button>
            </Link>
          </div>
        </section>

      </div>
    </div>
  );
}
