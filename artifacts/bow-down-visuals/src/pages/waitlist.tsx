import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Zap, CheckCircle2, Music, Video, Film, Image as ImageIcon,
  Mic2, Archive, ArrowRight, Star, Users, Globe, Lock, Mail, Menu, X,
} from "lucide-react";
import { JsonLd } from "@/components/seo/json-ld";

/* ─── nav ─── */

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Tools", href: "/dashboard" },
  { label: "Pricing", href: "/pricing" },
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
            <Link key={l.href} href={l.href} className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-white/45 hover:text-white hover:bg-white/[0.04] transition-colors">{l.label}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login">
            <Button size="sm" variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10 hidden sm:flex gap-2 font-semibold">
              Sign In
            </Button>
          </Link>
          <button className="flex md:hidden items-center justify-center h-8 w-8 text-white/60 hover:text-white" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="md:hidden border-t border-white/[0.06] bg-black/95 backdrop-blur-xl px-5 py-4 space-y-1">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setMenuOpen(false)}
              className="flex items-center px-3 py-2.5 rounded-xl text-sm font-medium text-white/50 hover:text-white hover:bg-white/[0.04] transition-colors">
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}

/* ─── data ─── */

const ARTIST_TYPES = ["Rapper", "Singer", "Producer", "AI Artist", "Content Creator", "Label", "Kids Music Creator", "Other"];
const WANT_TO_CREATE = ["Songs", "Music Videos", "Promo Clips", "Thumbnails", "Full Song + Video Packages", "AI Artist Content", "Other"];

const BENEFITS = [
  { icon: Zap,   title: "First Access",       body: "Get into the platform before the public launch. Be among the first artists to use every tool." },
  { icon: Star,  title: "Founding Rate",      body: "Waitlist members lock in a discounted founding rate — never pay full price." },
  { icon: Lock,  title: "Bonus Credits",      body: "Join the waitlist and get 100 bonus credits added to your account on launch day." },
  { icon: Users, title: "Creator Community",  body: "Connect with other independent artists building their careers with AI from day one." },
  { icon: Globe, title: "Priority Support",   body: "Founding members get priority responses and direct access to the founding team." },
  { icon: Music, title: "Feature Voting",     body: "Your feedback shapes what we build next. Waitlist members vote on upcoming tools and features." },
];

const TOOLS = [
  { label: "Make a Song",        icon: Music,     badge: null },
  { label: "Make a Music Video", icon: Video,     badge: null },
  { label: "Make Song + Video",  icon: Mic2,      badge: "Most Popular" },
  { label: "Promo Clip Maker",   icon: Film,      badge: null },
  { label: "Thumbnail Maker",    icon: ImageIcon, badge: null },
  { label: "Artist Profiles",       icon: Archive,   badge: "Free" },
];

const WAITLIST_CONTACT_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Bow Down Visuals",
  url: "https://bowdownvisuals.com",
  email: "support@bowdownvisuals.com",
  contactPoint: {
    "@type": "ContactPoint",
    email: "support@bowdownvisuals.com",
    contactType: "customer support",
  },
};

const inputClass = "h-11 bg-white/[0.05] border-white/[0.10] text-white placeholder:text-white/30 focus:border-primary/50 rounded-xl text-sm";
const selectClass = "h-11 w-full bg-white/[0.05] border border-white/[0.10] text-white rounded-xl px-3 text-sm appearance-none cursor-pointer focus:outline-none focus:border-primary/50 transition-colors";

/* ─── form state ─── */

interface FormValues {
  name: string;
  email: string;
  artistType: string;
  wantToCreate: string;
  socialHandle: string;
  message: string;
}

/* ─── page ─── */

export default function Waitlist() {
  const [form, setForm] = useState<FormValues>({
    name: "", email: "", artistType: "", wantToCreate: "", socialHandle: "", message: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function update(field: keyof FormValues, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Please enter your name."); return; }
    if (!form.email.trim() || !form.email.includes("@")) { setError("Please enter a valid email address."); return; }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          artistType: form.artistType,
          wantToCreate: form.wantToCreate,
          socialHandle: form.socialHandle,
          message: form.message,
        }),
      });
      const data = await res.json() as { error?: string; message?: string };
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
    <div className="min-h-screen bg-black text-white">
      <JsonLd data={WAITLIST_CONTACT_JSON_LD} />
      <NavBar />

      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-yellow-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-yellow-900/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10">

        {/* ── HERO ── */}
        <section className="max-w-4xl mx-auto px-5 md:px-8 pt-20 pb-10 text-center">
          <Badge className="mb-6 bg-primary/10 text-primary border-primary/25 text-xs font-bold tracking-widest px-4 py-1.5">
            🔥 Early Access — Limited Spots
          </Badge>
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-black text-white tracking-tight mb-6 leading-[0.92]">
            Join the Bow Down<br />
            <span className="text-primary">Visuals Waitlist</span>
          </h1>
          <p className="text-white/50 text-xl max-w-2xl mx-auto leading-relaxed">
            Get early access to AI song creation, music video generation, promo clips, thumbnails, and creator tools.
          </p>

          {/* social proof counter */}
          <div className="flex items-center justify-center gap-2 mt-8">
            <div className="flex -space-x-2">
              {["LN", "YB", "SK", "MK", "DV"].map((initials) => (
                <div key={initials} className="h-7 w-7 rounded-full bg-primary border-2 border-black flex items-center justify-center text-[9px] font-black text-white">
                  {initials}
                </div>
              ))}
            </div>
            <span className="text-sm text-white/40">Join the waitlist for early access</span>
          </div>
        </section>

        {/* ── FORM ── */}
        <section className="max-w-2xl mx-auto px-5 md:px-8 pb-20">
          {submitted ? (
            <div className="rounded-2xl border border-primary/25 bg-primary/5 p-10 text-center">
              <CheckCircle2 className="h-14 w-14 text-primary mx-auto mb-5" />
              <h3 className="text-2xl font-black text-white mb-3">You're on the list.</h3>
              <p className="text-white/55 text-base mb-6 max-w-sm mx-auto leading-relaxed">
                You're on the Bow Down Visuals waitlist. We'll notify you when early access opens.
              </p>
              <div className="flex flex-col gap-2 text-sm text-white/40 mb-8">
                <p>🎁 100 bonus credits reserved for you</p>
                <p>⚡ Early access before public launch</p>
                <p>🔒 Founding member rate locked in</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link href="/">
                  <Button variant="outline" className="border-white/10 text-white/60 hover:text-white hover:bg-white/5">
                    Back to Home
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button className="gold-glow font-semibold gap-2">
                    <Zap className="h-4 w-4" /> Try the Tools
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-7 md:p-9">
              <h2 className="text-xl font-black text-white mb-6">Tell us about yourself</h2>

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Name + Email */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">Name *</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => update("name", e.target.value)}
                      placeholder="Your name"
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">Email *</Label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => update("email", e.target.value)}
                      placeholder="you@example.com"
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* Artist Type + What to Create */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">Artist Type</Label>
                    <select
                      value={form.artistType}
                      onChange={(e) => update("artistType", e.target.value)}
                      className={selectClass}
                    >
                      <option value="" disabled className="bg-zinc-900">Select artist type...</option>
                      {ARTIST_TYPES.map((t) => (
                        <option key={t} value={t} className="bg-zinc-900">{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">What do you want to create?</Label>
                    <select
                      value={form.wantToCreate}
                      onChange={(e) => update("wantToCreate", e.target.value)}
                      className={selectClass}
                    >
                      <option value="" disabled className="bg-zinc-900">Select focus area...</option>
                      {WANT_TO_CREATE.map((t) => (
                        <option key={t} value={t} className="bg-zinc-900">{t}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Social Handle */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">Instagram or TikTok Handle</Label>
                  <Input
                    value={form.socialHandle}
                    onChange={(e) => update("socialHandle", e.target.value)}
                    placeholder="@yourhandle"
                    className={inputClass}
                  />
                </div>

                {/* Message */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">Message <span className="text-white/30 font-normal normal-case tracking-normal">(optional)</span></Label>
                  <Textarea
                    value={form.message}
                    onChange={(e) => update("message", e.target.value)}
                    placeholder="Tell us what you're working on, or any questions you have..."
                    rows={3}
                    className="bg-white/[0.05] border-white/[0.10] text-white placeholder:text-white/30 focus:border-primary/50 rounded-xl text-sm resize-none"
                  />
                </div>

                {error && (
                  <div className="p-3 rounded-xl border border-red-500/20 bg-red-500/5">
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  disabled={loading}
                  className="w-full gold-glow font-bold text-base rounded-xl gap-3"
                  style={{ height: "52px" }}
                >
                  {loading ? "Joining the waitlist..." : <><Zap className="h-5 w-5" /> Join the Waitlist <ArrowRight className="h-4 w-4" /></>}
                </Button>

                <p className="text-white/25 text-xs text-center">No spam. No credit card. Early access when we launch.</p>
              </form>
            </div>
          )}
        </section>

        {/* ── TOOLS PREVIEW ── */}
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

        {/* ── BENEFITS ── */}
        <section className="max-w-5xl mx-auto px-5 md:px-8 py-16 border-t border-white/[0.05]">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-black text-white mb-3">Why join early?</h2>
            <p className="text-white/40 text-lg">Waitlist members get exclusive perks not available after launch.</p>
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

        {/* ── CONTACT ── */}
        <section className="max-w-3xl mx-auto px-5 md:px-8 py-16 border-t border-white/[0.05]">
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-8 md:p-10">
            <div className="flex items-center gap-3 mb-5">
              <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs font-bold tracking-widest text-primary/70 uppercase mb-0.5">Contact</p>
                <h2 className="text-xl font-black text-white">Get in Touch</h2>
              </div>
            </div>
            <p className="text-white/50 text-base leading-relaxed mb-5">
              For partnerships, creator access, or support, contact the Bow Down Visuals team.
            </p>
            <a
              href="mailto:support@bowdownvisuals.com"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-primary/25 bg-primary/5 text-primary font-semibold text-sm hover:bg-primary/10 transition-colors"
            >
              <Mail className="h-4 w-4" />
              support@bowdownvisuals.com
            </a>
          </div>
        </section>


      </div>
    </div>
  );
}
