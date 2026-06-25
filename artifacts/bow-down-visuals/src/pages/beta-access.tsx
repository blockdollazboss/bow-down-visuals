import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NavThemePlayer } from "@/components/HomepageThemePlayer";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Zap, CheckCircle2, Music, Video, Film, Image as ImageIcon,
  Mic2, Archive, ArrowRight, Star, Users, Globe, Lock, Menu, X, Headphones,
} from "lucide-react";

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
          <NavThemePlayer />
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

const CREATOR_TYPES = ["Rapper", "Singer", "Producer", "AI Artist", "Content Creator", "Label", "Kids Music Creator", "Other"];

const WANT_TO_MAKE = [
  "Songs",
  "Music Videos",
  "Promo Clips",
  "Full Song + Video Packages",
  "Artist Content",
  "Music Mixing",
  "Thumbnails",
  "Other",
];

const TOOLS = [
  { label: "Make a Song",        icon: Music,      badge: null },
  { label: "Make a Music Video", icon: Video,      badge: null },
  { label: "Make Song + Video",  icon: Mic2,       badge: "Most Popular" },
  { label: "Promo Clip Maker",   icon: Film,       badge: null },
  { label: "Thumbnail Maker",    icon: ImageIcon,  badge: null },
  { label: "Music Mixing",       icon: Headphones, badge: null },
  { label: "Artist Vault",       icon: Archive,    badge: "Free" },
];

const PERKS = [
  { icon: Zap,   title: "Early Access",      body: "Get into the platform before the public launch. Be among the first artists using every tool." },
  { icon: Star,  title: "Founding Rate",     body: "Beta members lock in a discounted founding rate — never pay full price." },
  { icon: Lock,  title: "Bonus Credits",     body: "Join the beta and receive 100 bonus credits on launch day." },
  { icon: Users, title: "Creator Community", body: "Connect with other independent artists building with AI from day one." },
  { icon: Globe, title: "Priority Support",  body: "Beta members get priority responses and direct access to the team." },
  { icon: Music, title: "Feature Voting",    body: "Your feedback shapes what we build. Beta members vote on upcoming tools." },
];

const inputClass = "h-11 bg-white/[0.05] border-white/[0.10] text-white placeholder:text-white/30 focus:border-primary/50 rounded-xl text-sm";
const selectClass = "h-11 w-full bg-white/[0.05] border border-white/[0.10] text-white rounded-xl px-3 text-sm appearance-none cursor-pointer focus:outline-none focus:border-primary/50 transition-colors";

/* ─── types ─── */

interface FormValues {
  name: string;
  email: string;
  creatorName: string;
  artistType: string;
  wantToMake: string;
  socialHandle: string;
  message: string;
}

/* ─── page ─── */

export default function BetaAccess() {
  const [form, setForm] = useState<FormValues>({
    name: "", email: "", creatorName: "", artistType: "", wantToMake: "", socialHandle: "", message: "",
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
          creatorName: form.creatorName,
          artistType: form.artistType,
          wantToCreate: form.wantToMake,
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
      <NavBar />

      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-yellow-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-yellow-900/8 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10">

        {/* ── HERO ── */}
        <section className="max-w-4xl mx-auto px-5 md:px-8 pt-20 pb-10 text-center">
          <Badge className="mb-6 bg-primary/10 text-primary border-primary/25 text-xs font-bold tracking-widest px-4 py-1.5">
            ✦ Beta Access Open — Limited Spots
          </Badge>
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-black text-white tracking-tight mb-6 leading-[0.92]">
            Join the Bow Down<br />
            <span className="text-primary">Visuals Beta</span>
          </h1>
          <p className="text-white/50 text-xl max-w-2xl mx-auto leading-relaxed">
            Get early access to AI song creation, music video tools, promo clips, artist profiles, music mixing, and video editing.
          </p>

          {/* social proof */}
          <div className="flex items-center justify-center gap-2 mt-8">
            <div className="flex -space-x-2">
              {["LN", "YB", "SK", "MK", "DV"].map((initials) => (
                <div key={initials} className="h-7 w-7 rounded-full bg-primary border-2 border-black flex items-center justify-center text-[9px] font-black text-white">
                  {initials}
                </div>
              ))}
            </div>
            <span className="text-sm text-white/40"><span className="text-white font-bold">2,847</span> creators already signed up</span>
          </div>
        </section>

        {/* ── FORM ── */}
        <section className="max-w-2xl mx-auto px-5 md:px-8 pb-20">
          {submitted ? (
            <div className="rounded-2xl border border-primary/25 bg-primary/5 p-10 text-center">
              <CheckCircle2 className="h-14 w-14 text-primary mx-auto mb-5" />
              <h3 className="text-2xl font-black text-white mb-3">You're in.</h3>
              <p className="text-white/55 text-base mb-6 max-w-sm mx-auto leading-relaxed">
                You're on the Bow Down Visuals beta list. We'll contact you when early access opens.
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
                    <Zap className="h-4 w-4" /> Try the Tools Now
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-7 md:p-9">
              <h2 className="text-xl font-black text-white mb-1">Tell us about yourself</h2>
              <p className="text-sm text-white/35 mb-6">We use this to shape early access and build what creators actually need.</p>

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

                {/* Artist / Creator Name */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">Artist / Creator Name</Label>
                  <Input
                    value={form.creatorName}
                    onChange={(e) => update("creatorName", e.target.value)}
                    placeholder="e.g. Lil Fire, DJ Smooth, BeatsByNova"
                    className={inputClass}
                  />
                </div>

                {/* Creator Type + What to Make */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">Creator Type</Label>
                    <select
                      value={form.artistType}
                      onChange={(e) => update("artistType", e.target.value)}
                      className={selectClass}
                    >
                      <option value="" disabled className="bg-zinc-900">Select creator type...</option>
                      {CREATOR_TYPES.map((t) => (
                        <option key={t} value={t} className="bg-zinc-900">{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">What do you want to make?</Label>
                    <select
                      value={form.wantToMake}
                      onChange={(e) => update("wantToMake", e.target.value)}
                      className={selectClass}
                    >
                      <option value="" disabled className="bg-zinc-900">Select what you want to make...</option>
                      {WANT_TO_MAKE.map((t) => (
                        <option key={t} value={t} className="bg-zinc-900">{t}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Social Link */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">Instagram / TikTok / YouTube Link</Label>
                  <Input
                    value={form.socialHandle}
                    onChange={(e) => update("socialHandle", e.target.value)}
                    placeholder="@yourhandle or a link to your profile"
                    className={inputClass}
                  />
                </div>

                {/* Message */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-white/60 uppercase tracking-wider">
                    Message <span className="text-white/30 font-normal normal-case tracking-normal">(optional)</span>
                  </Label>
                  <Textarea
                    value={form.message}
                    onChange={(e) => update("message", e.target.value)}
                    placeholder="Tell us what you're working on, or what you want us to build first..."
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
                  {loading
                    ? "Submitting..."
                    : <><Zap className="h-5 w-5" /> Request Beta Access <ArrowRight className="h-4 w-4" /></>}
                </Button>

                <p className="text-white/25 text-xs text-center">No spam. No credit card required. Early access when we launch.</p>
              </form>
            </div>
          )}
        </section>

        {/* ── TOOLS PREVIEW ── */}
        <section className="max-w-5xl mx-auto px-5 md:px-8 py-16 border-t border-white/[0.05]">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-black text-white mb-3">Everything you need to create and promote</h2>
            <p className="text-white/40 text-lg">Professional tools built specifically for independent artists and creators.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
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

        {/* ── PERKS ── */}
        <section className="max-w-5xl mx-auto px-5 md:px-8 py-16 border-t border-white/[0.05]">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-black text-white mb-3">Why join the beta?</h2>
            <p className="text-white/40 text-lg">Beta members get exclusive perks not available after public launch.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {PERKS.map((p) => (
              <div key={p.title} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 hover:border-primary/20 transition-colors">
                <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center mb-4">
                  <p.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-base font-bold text-white mb-2">{p.title}</h3>
                <p className="text-sm text-white/50 leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
