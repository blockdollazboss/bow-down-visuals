import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Zap, CheckCircle2, Music, Video, Film, Image as ImageIcon, Mic2, Archive, ArrowRight, Star, Users, Globe, Lock } from "lucide-react";

const NAV_LINKS = [
  { label: "Home",    href: "/" },
  { label: "Tools",   href: "/dashboard" },
  { label: "Pricing", href: "/pricing" },
];

function NavBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/90 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex flex-col leading-none cursor-pointer shrink-0">
          <span className="text-white font-black text-base tracking-tight">BOW DOWN</span>
          <span className="text-primary font-black text-sm tracking-widest -mt-0.5">VISUALS</span>
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-white/45 hover:text-white hover:bg-white/[0.04] transition-colors">{l.label}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button size="sm" className="purple-glow hidden sm:flex gap-2 font-semibold">
              <Zap className="h-3.5 w-3.5" /> Get Early Access
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

const BENEFITS = [
  { icon: Zap,       title: "First Access",     body: "Get into the platform before the public launch. Be among the first artists to use every tool." },
  { icon: Star,      title: "Founding Rate",    body: "Waitlist members lock in a discounted founding rate — never pay full price." },
  { icon: Lock,      title: "Bonus Credits",    body: "Join the waitlist and get 100 bonus credits added to your account on launch day." },
  { icon: Users,     title: "Founding Community", body: "Connect with other independent artists building their careers with AI from day one." },
  { icon: Globe,     title: "Priority Support", body: "Founding members get priority responses and direct access to the founding team." },
  { icon: Music,     title: "Feature Voting",   body: "Your feedback shapes what we build next. Waitlist members vote on upcoming tools and features." },
];

const TOOLS = [
  { label: "Make a Song",        icon: Music,      badge: null },
  { label: "Make a Music Video", icon: Video,      badge: null },
  { label: "Make Song + Video",  icon: Mic2,       badge: "Most Popular" },
  { label: "Promo Clip Maker",   icon: Film,       badge: null },
  { label: "Thumbnail Maker",    icon: ImageIcon,  badge: null },
  { label: "Artist Vault",       icon: Archive,    badge: "Free" },
];

const SOCIAL_PROOF = [
  { name: "Lil Nova",    handle: "@lilnova_music",    quote: "Generated my entire debut EP concept in one session. The lyrics, video treatment, and promo pack — all done. This is what independent artists needed." },
  { name: "Yara B",      handle: "@yarab_rnb",        quote: "The Promo Clip Maker alone saved me 3 hours. I got 10 TikTok concepts, captions, hashtags, and a full posting schedule. In two minutes." },
  { name: "Street King", handle: "@streetkingofficial", quote: "Finally a tool built for real artists. Not generic AI content — this actually sounds like drill. The scene breakdown for my video was perfect." },
];

export default function Waitlist() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !email.includes("@")) { setError("Enter a valid email address."); return; }
    setError(""); setLoading(true);
    setTimeout(() => { setSubmitted(true); setLoading(false); }, 1200);
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <NavBar />
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-purple-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-purple-900/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10">

        {/* HERO */}
        <section className="max-w-4xl mx-auto px-5 md:px-8 pt-20 pb-16 text-center">
          <Badge className="mb-6 bg-primary/10 text-primary border-primary/25 text-xs font-bold tracking-widest px-4 py-1.5">
            🔥 Early Access — Limited Spots
          </Badge>
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-black text-white tracking-tight mb-6 leading-[0.92]">
            Be First.<br />
            <span className="text-primary">Get Access.</span>
          </h1>
          <p className="text-white/50 text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Bow Down Visuals is the AI music creation studio built for independent artists. Join the waitlist and get early access, bonus credits, and a locked-in founding rate.
          </p>

          {/* Waitlist form */}
          {submitted ? (
            <div className="max-w-md mx-auto">
              <div className="rounded-2xl border border-primary/25 bg-primary/5 p-8 text-center">
                <CheckCircle2 className="h-12 w-12 text-primary mx-auto mb-4" />
                <h3 className="text-xl font-black text-white mb-2">You're on the list.</h3>
                <p className="text-white/50 text-sm mb-6">We'll email you the moment early access opens. Keep an eye on {email}.</p>
                <div className="flex flex-col gap-2 text-sm text-white/40">
                  <p>🎁 100 bonus credits reserved for you</p>
                  <p>⚡ Early access before public launch</p>
                  <p>🔒 Founding member rate locked in</p>
                </div>
                <Link href="/">
                  <Button variant="outline" className="mt-6 border-white/10 text-white/60 hover:text-white">
                    Back to Home
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="max-w-md mx-auto">
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  placeholder="Enter your email address"
                  className="h-12 flex-1 bg-white/[0.05] border-white/[0.10] text-white placeholder:text-white/30 focus:border-primary/50 rounded-xl text-base"
                />
                <Button type="submit" size="lg" disabled={loading} className="purple-glow font-bold px-8 rounded-xl h-12 shrink-0">
                  {loading ? "Joining..." : "Join Waitlist"}
                </Button>
              </div>
              {error && <p className="text-red-400 text-sm mt-2 text-left">{error}</p>}
              <p className="text-white/25 text-xs mt-3">No spam. No credit card. Early access when we launch.</p>
            </form>
          )}

          {/* Counter */}
          <div className="flex items-center justify-center gap-2 mt-8">
            <div className="flex -space-x-2">
              {["LN","YB","SK","MK","DV"].map((initials) => (
                <div key={initials} className="h-7 w-7 rounded-full bg-primary border-2 border-black flex items-center justify-center text-[9px] font-black text-white">
                  {initials}
                </div>
              ))}
            </div>
            <span className="text-sm text-white/40"><span className="text-white font-bold">2,847</span> artists on the waitlist</span>
          </div>
        </section>

        {/* TOOLS PREVIEW */}
        <section className="max-w-5xl mx-auto px-5 md:px-8 py-16 border-t border-white/[0.05]">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-black text-white mb-3">Everything you need to create and promote</h2>
            <p className="text-white/40 text-lg">6 professional tools built specifically for independent artists.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {TOOLS.map((tool) => (
              <div key={tool.label} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 flex items-start gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                  <tool.icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white leading-snug">{tool.label}</p>
                  {tool.badge && <Badge className="mt-1 bg-primary/10 text-primary border-primary/20 text-[10px]">{tool.badge}</Badge>}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* BENEFITS */}
        <section className="max-w-5xl mx-auto px-5 md:px-8 py-16 border-t border-white/[0.05]">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-black text-white mb-3">Why join early?</h2>
            <p className="text-white/40 text-lg">Waitlist members get exclusive perks that won't be available after launch.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {BENEFITS.map((b) => (
              <div key={b.title} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 hover:border-primary/20 transition-colors">
                <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center mb-4">
                  <b.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-base font-bold text-white mb-2">{b.title}</h3>
                <p className="text-sm text-white/50 leading-relaxed">{b.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* SOCIAL PROOF */}
        <section className="max-w-5xl mx-auto px-5 md:px-8 py-16 border-t border-white/[0.05]">
          <h2 className="text-3xl md:text-4xl font-black text-white text-center mb-10">What artists are saying</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {SOCIAL_PROOF.map((s) => (
              <div key={s.handle} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
                <div className="flex items-center gap-1 mb-3">
                  {[1,2,3,4,5].map((n) => <Star key={n} className="h-3.5 w-3.5 fill-primary text-primary" />)}
                </div>
                <p className="text-sm text-white/65 leading-relaxed mb-4">"{s.quote}"</p>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                    <span className="text-[11px] font-black text-white">{s.name[0]}</span>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{s.name}</p>
                    <p className="text-xs text-white/30">{s.handle}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* BOTTOM CTA */}
        <section className="max-w-3xl mx-auto px-5 md:px-8 py-20 text-center border-t border-white/[0.05]">
          <h2 className="text-4xl md:text-5xl font-black text-white mb-4">Ready to create?</h2>
          <p className="text-white/45 text-xl mb-10">Don't wait until launch. Get on the list now and be the first artist in.</p>
          {!submitted ? (
            <form onSubmit={handleSubmit} className="max-w-md mx-auto">
              <div className="flex flex-col sm:flex-row gap-3">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" className="h-12 flex-1 bg-white/[0.05] border-white/[0.10] text-white placeholder:text-white/30 focus:border-primary/50 rounded-xl text-base" />
                <Button type="submit" size="lg" disabled={loading} className="purple-glow font-bold px-8 rounded-xl h-12">
                  {loading ? "Joining..." : <>Join Now <ArrowRight className="h-4 w-4 ml-1" /></>}
                </Button>
              </div>
            </form>
          ) : (
            <div className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary/10 border border-primary/20 text-primary font-bold">
              <CheckCircle2 className="h-5 w-5" /> You're on the list — we'll be in touch!
            </div>
          )}
        </section>

        {/* Footer */}
        <div className="border-t border-white/[0.05] py-8 text-center px-5">
          <div className="flex items-center justify-center gap-6 mb-4 flex-wrap">
            {[{ label: "Home", href: "/" }, { label: "Tools", href: "/dashboard" }, { label: "Pricing", href: "/pricing" }].map((l) => (
              <Link key={l.href} href={l.href} className="text-sm text-white/30 hover:text-white transition-colors">{l.label}</Link>
            ))}
          </div>
          <p className="text-white/20 text-sm">© 2026 Bow Down Visuals. Create the Song. Create the Video. Promote the Release.</p>
        </div>
      </div>
    </div>
  );
}
